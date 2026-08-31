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

function captureMissingBenchmarkFallback() {
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
    issues: []
  }, NOW);
  return rendered;
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

const missingBenchmarkFallback = captureMissingBenchmarkFallback();
assert.equal(missingBenchmarkFallback?.state, 'unavailable', 'missing benchmarkReview should degrade only the Benchmark Review panel');
assert.equal('authority' in missingBenchmarkFallback, false, 'missing benchmarkReview must not invent a registry authority');
assert.equal('sourceKey' in missingBenchmarkFallback, false, 'missing benchmarkReview must not attribute the failure to BEN-8 or another source');
assert.equal('sourceLabel' in missingBenchmarkFallback, false, 'missing benchmarkReview must keep source metadata authority-neutral');

const indexSource = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
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
for (const [label, workflow] of [['Jira', jiraWorkflow], ['GitHub PR', githubWorkflow]]) {
  assert.match(workflow, /concurrency:\n\s+group: dashboard-data-publish\n\s+cancel-in-progress: false/, `${label} publisher should join the shared dashboard-data publication lock`);
}
assert.match(
  jiraWorkflow,
  /git pull --rebase origin dashboard-data[\s\S]*node \.\.\/scripts\/refresh-jira-flight-control\.mjs --verify-output dashboard\/jira-flight-control\.enc\.json[\s\S]*git push origin HEAD:dashboard-data/,
  'Jira publisher should reconcile the remote data branch and reverify its owned artifact before normal push'
);
assert.match(
  githubWorkflow,
  /git pull --rebase origin dashboard-data[\s\S]*node \.\.\/scripts\/refresh-github-prs\.mjs --verify-output dashboard\/github-prs\.enc\.json[\s\S]*git push origin HEAD:dashboard-data/,
  'GitHub PR publisher should reconcile the remote data branch and reverify its owned artifact before normal push'
);
assert.doesNotMatch(jiraWorkflow, /git push[^\n]*--force|git reset --hard[^\n]*dashboard-data/i, 'Jira publisher must never rewrite dashboard-data history');
assert.doesNotMatch(githubWorkflow, /git push[^\n]*--force|git reset --hard[^\n]*dashboard-data/i, 'GitHub PR publisher must never rewrite dashboard-data history');

verifyInlineScripts(new URL('../dashboard/index.html', import.meta.url));
verifyInlineScripts(new URL('../dashboard/display.html', import.meta.url));

console.log('dashboard refresh-health, 15-second polling, producer cadence, shared publication, and inline syntax tests passed');
