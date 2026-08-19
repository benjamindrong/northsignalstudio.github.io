import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const health = require('../dashboard/refresh-health.js');
const githubActivity = require('../dashboard/github-activity.js');
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

assert.deepEqual(
  githubActivity.configuredRepositoryLabels({ repositories: ['benjamindrong/MyRAM-iOS', 'benjamindrong/Runline', 'benjamindrong/Runline'] }),
  ['MyRAM-iOS', 'Runline'],
  'configured repository labels should remain compact while preserving each configured repo'
);

const recentWithDraft = githubActivity.recentActivityItems(
  {
    issues: [{ key: 'HOME-13', summary: 'Dashboard work', updatedAt: '2026-08-15T11:58:00Z', url: 'https://example.test/HOME-13' }]
  },
  {
    pullRequests: [
      { repository: 'benjamindrong/Runline', number: 4, title: 'Draft authority UI', updatedAt: '2026-08-15T11:59:00Z', url: 'https://github.com/benjamindrong/Runline/pull/4', state: 'DRAFT' },
      { repository: 'benjamindrong/MyRAM-iOS', number: 133, title: 'Ready work', updatedAt: '2026-08-15T11:57:00Z', url: 'https://github.com/benjamindrong/MyRAM-iOS/pull/133', state: 'OPEN' }
    ]
  }
);
assert.equal(recentWithDraft[0].identity, 'Runline #4', 'a genuinely recent draft should participate in recent activity ordering');
assert.equal(recentWithDraft[0].draft, true, 'recent activity should retain explicit draft identity');

const crowdedJira = Array.from({ length: 12 }, (_, index) => ({
  key: `HOME-${index + 20}`,
  summary: `Jira item ${index + 1}`,
  updatedAt: new Date(NOW - index * 1_000).toISOString(),
  url: `https://example.test/HOME-${index + 20}`
}));
const balancedRecent = githubActivity.recentActivityItems(
  { issues: crowdedJira },
  { pullRequests: [{ repository: 'benjamindrong/Runline', number: 5, title: 'Draft work', updatedAt: new Date(NOW - 60_000).toISOString(), url: 'https://github.com/benjamindrong/Runline/pull/5', state: 'DRAFT' }] }
);
assert.equal(balancedRecent.length, 12, 'recent activity should retain its existing row cap');
assert.ok(balancedRecent.some(item => item.source === 'GITHUB' && item.draft), 'source balancing should not crowd a draft GitHub activity item out of the mixed feed');

verifyInlineScripts(new URL('../dashboard/index.html', import.meta.url));
verifyInlineScripts(new URL('../dashboard/display.html', import.meta.url));

console.log('dashboard refresh-health regression, GitHub activity, and inline syntax tests passed');
