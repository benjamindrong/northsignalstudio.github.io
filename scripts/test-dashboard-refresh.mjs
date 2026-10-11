import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const health = require('../dashboard/refresh-health.js');
const NOW = Date.parse('2026-08-15T12:00:00Z');
const recentPayload = { generatedAt: new Date(NOW - 10 * 60 * 1000).toISOString() };
const oldPayload = { generatedAt: new Date(NOW - 31 * 60 * 1000).toISOString() };

function success(payload, now = NOW) {
  return health.markSourceSuccess(health.emptySourceState(), payload, now);
}

function verifyInlineScripts(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  assert.ok(scripts.length > 0, `${filePath} should contain inline JavaScript`);
  scripts.forEach((script, index) => new vm.Script(script, { filename: `${filePath}#inline-${index + 1}` }));
}

function captureNativeOnlyBenchmarkRendering() {
  const source = fs.readFileSync(new URL('../dashboard/refresh-health.js', import.meta.url), 'utf8');
  let rendered = null;
  const context = {
    console,
    Promise,
    Date,
    setTimeout,
    clearTimeout,
    document: {},
    DashboardBenchmarkReview: {
      render(registry) { rendered = registry; },
      locked() {}
    },
    DashboardWorkRelationships: {
      render() {},
      clear() {}
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'dashboard/refresh-health.js' });
  const isolated = context.DashboardRefreshHealth;
  isolated.markSourceSuccess(isolated.emptySourceState(), {
    generatedAt: new Date(NOW).toISOString(),
    issues: [],
    benchmarkReview: { state: 'ready', authority: 'jira-native' }
  }, NOW);
  const afterJira = rendered;
  isolated.renderBenchmarkReview({
    state: 'unavailable', sourceLabel: 'Dashboard-native Benchmark Review · unavailable'
  });
  return { afterJira, afterNative: rendered };
}

function assertSafeDashboardDataPublisher({ label, workflow, ownedPath, siblingPath, verifyCommand }) {
  assert.match(workflow, /concurrency:\n\s+group: dashboard-data-publish\n\s+cancel-in-progress: false/, `${label} publisher should join the shared dashboard-data publication lock`);
  assert.ok(workflow.includes(`owned_path=${ownedPath}`), `${label} publisher should identify only its owned encrypted artifact`);
  assert.ok(workflow.includes(`sibling_path=${siblingPath}`), `${label} publisher should preserve the sibling encrypted artifact`);
  assert.match(workflow, /baseline_owned_blob="\$\(git rev-parse "HEAD:\$owned_path" 2>\/dev\/null \|\| printf '<missing>'\)"/, `${label} publisher should freeze its owned-path baseline before publication`);
  assert.match(workflow, /git fetch --no-tags origin dashboard-data/, `${label} publisher should fetch the latest dashboard-data tip before reconciliation`);
  assert.match(workflow, /remote_owned_blob="\$\(git rev-parse "FETCH_HEAD:\$owned_path" 2>\/dev\/null \|\| printf '<missing>'\)"/, `${label} publisher should inspect the latest remote owned-path identity`);
  assert.match(workflow, /if \[ "\$remote_owned_blob" != "\$baseline_owned_blob" \]; then[\s\S]*refusing to replay stale[\s\S]*exit 1[\s\S]*fi/, `${label} publisher should fail closed when its owned path moved`);
  assert.match(workflow, /git rebase FETCH_HEAD/, `${label} publisher should rebase only after the owned-path identity guard passes`);
  assert.ok(workflow.includes('test -f "$owned_path"'), `${label} publisher should require its owned artifact after reconciliation`);
  assert.ok(workflow.includes('test -f "$sibling_path"'), `${label} publisher should require the sibling artifact after reconciliation`);
  assert.ok(workflow.includes(verifyCommand), `${label} publisher should reverify its owned artifact after reconciliation`);
  assert.match(workflow, /git push origin HEAD:dashboard-data/, `${label} publisher should use a normal non-forced push`);
  assert.doesNotMatch(workflow, /git pull --rebase origin dashboard-data/, `${label} publisher should not fetch again between the owned-path guard and rebase`);
  assert.doesNotMatch(workflow, /git push[^\n]*--force|git reset --hard[^\n]*dashboard-data/i, `${label} publisher must never rewrite dashboard-data history`);
}

assert.equal(health.STALE_AFTER_MS, 30 * 60 * 1000, 'material staleness threshold should be 30 minutes');
assert.equal(health.sourceState(success(recentPayload), NOW), 'current', 'recent producer snapshot should be current even when business data is unchanged');
assert.equal(health.sourceState(success(oldPayload), NOW), 'stale', 'old producer snapshot should be stale');

const oldRefetched = health.markSourceSuccess(success(oldPayload, NOW - 60_000), oldPayload, NOW);
assert.equal(health.sourceState(oldRefetched, NOW), 'stale', 're-fetching an old snapshot should remain stale');

assert.equal(health.overallState({ jira: 'stale', github: 'current' }), 'stale', 'one stale source should make dashboard stale');
assert.equal(health.overallState({ jira: 'failed', github: 'stale' }), 'failed', 'failure should take precedence over staleness');

const validState = success(recentPayload, NOW - 10_000);
const failedState = health.markSourceFailure(validState, new Error('network failure'), NOW - 10_000);
assert.equal(health.sourceState(failedState, NOW), 'failed', 'latest refresh failure should win over prior success');

const recoveredState = health.markSourceSuccess(failedState, recentPayload, NOW);
assert.equal(health.sourceState(recoveredState, NOW), 'current', 'new recent snapshot should recover from failure');

assert.equal(health.sourceState(health.emptySourceState(), NOW), 'waiting', 'source should wait before first success');
assert.equal(health.sourceState(success({ generatedAt: 'not-a-date' }), NOW), 'stale', 'invalid generatedAt should be stale');

const nativePresentation = captureNativeOnlyBenchmarkRendering();
assert.equal(nativePresentation.afterJira, null,
  'Jira benchmarkReview fields, even if present, cannot render the native Benchmark Review panel');
assert.equal(nativePresentation.afterNative.state, 'unavailable',
  'Only explicit native-feed rendering can change Benchmark Review presentation');
assert.match(nativePresentation.afterNative.sourceLabel, /Dashboard-native/);

const indexSource = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const workItemsScript = '<script src="./work-items.js"></script>';
const nativeScript = '<script src="./native-benchmark-review.js"></script>';
const refreshHealthScript = '<script src="./refresh-health.js"></script>';
assert.ok(indexSource.includes(workItemsScript), 'dashboard must load the shared work-item renderer');
assert.ok(indexSource.indexOf(workItemsScript) < indexSource.indexOf(nativeScript), 'work-items.js must load before native Benchmark adapter');
assert.ok(indexSource.indexOf(nativeScript) < indexSource.indexOf(refreshHealthScript), 'native adapter must load before refresh-health.js');
assert.match(indexSource, /WorkItems\.renderFlight\(rowsEl, payload\)/, 'Flight Control must delegate to DashboardWorkItems');
assert.match(indexSource, /WorkItems\.renderGithub\(githubRowsEl, payload\)/, 'Code Review must delegate to DashboardWorkItems');
assert.match(indexSource, /WorkItems\.renderRecent\(recentRowsEl, jiraPayloadValue, githubPayloadValue\)/, 'Recently Active must delegate to DashboardWorkItems');
for (const renderer of ['renderJira', 'renderGithub', 'renderRecent']) {
  const body = indexSource.match(new RegExp(`function ${renderer}\\([^)]*\\) \\{([\\s\\S]*?)\\n      \\}`))?.[1] || '';
  assert.doesNotMatch(body, /replaceChildren\s*\(|\.innerHTML\s*=/, `${renderer} must not clear its panel during ordinary successful refresh`);
}
assert.match(indexSource, /function lockDashboard\(\)[\s\S]*renderUnlock\(\)/, 'explicit lock must retain destructive teardown through the locked renderer');
assert.match(indexSource, /const AUTO_REFRESH_MS = 15_000;/, 'unlocked visible dashboard should poll published feeds every 15 seconds');
assert.match(indexSource, /if \(!sessionStorage\.getItem\('flight-control-passphrase'\) \|\| document\.hidden\) return;/, 'auto-refresh must stop while locked or hidden');
assert.match(indexSource, /if \(refreshPromise\) return refreshPromise;/, 'overlapping browser refresh attempts must coalesce');
assert.match(indexSource, /fetch\(`\$\{config\.dataUrl\}\?v=\$\{Date\.now\(\)\}`/, 'browser refresh must fetch the published encrypted feed URL');
assert.doesNotMatch(indexSource, /\/rest\/api\/3\/|actions\/workflows|workflow_dispatch/i, 'browser polling must not call Jira or dispatch GitHub Actions');

const jiraWorkflow = fs.readFileSync(new URL('../.github/workflows/refresh-jira-flight-control.yml', import.meta.url), 'utf8');
const githubWorkflow = fs.readFileSync(new URL('../.github/workflows/refresh-github-prs.yml', import.meta.url), 'utf8');
assert.match(jiraWorkflow, /cron: "3-58\/5 \* \* \* \*"/, 'Jira producer should attempt refresh every five minutes on the offset cadence');
assert.match(jiraWorkflow, /trigger_kind:[\s\S]*default: "manual"[\s\S]*- "manual"[\s\S]*- "jira"/, 'workflow dispatch should expose only manual and Jira trigger kinds');
assert.match(jiraWorkflow, /REFRESH_TRIGGER_KIND: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.trigger_kind \|\| github\.event_name \}\}/, 'publish job should pass the resolved trigger kind to the Jira refresh script');
assertSafeDashboardDataPublisher({
  label: 'Jira',
  workflow: jiraWorkflow,
  ownedPath: 'dashboard/jira-flight-control.enc.json',
  siblingPath: 'dashboard/github-prs.enc.json',
  verifyCommand: 'node ../scripts/refresh-jira-flight-control.mjs --verify-output "$owned_path"'
});
assertSafeDashboardDataPublisher({
  label: 'GitHub PR',
  workflow: githubWorkflow,
  ownedPath: 'dashboard/github-prs.enc.json',
  siblingPath: 'dashboard/jira-flight-control.enc.json',
  verifyCommand: 'node ../scripts/refresh-github-prs.mjs --verify-output "$owned_path"'
});

verifyInlineScripts(new URL('../dashboard/index.html', import.meta.url));
verifyInlineScripts(new URL('../dashboard/display.html', import.meta.url));

assert.match(indexSource, /fetchNativeBenchmark\(passphrase\)/,
  'Native Benchmark Review needs a separate encrypted publication fetch');
assert.doesNotMatch(fs.readFileSync(new URL('../dashboard/refresh-health.js', import.meta.url), 'utf8'),
  /payload\.benchmarkReview/,
  'Jira refresh health must not read Benchmark Review from the Jira payload');
console.log('dashboard native Benchmark Review isolation, refresh-health, fail-closed publication, and inline syntax checks passed');
