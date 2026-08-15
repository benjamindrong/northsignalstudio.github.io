import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const health = require('../dashboard/refresh-health.js');
const NOW = Date.parse('2026-08-15T12:00:00Z');
const recentRefresh = new Date(NOW - 10 * 60 * 1000).toISOString();
const oldRefresh = new Date(NOW - 31 * 60 * 1000).toISOString();

function success(refreshedAt, now = NOW) {
  return health.markSourceSuccess(health.emptySourceState(), refreshedAt, now);
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
assert.equal(health.sourceState(success(recentRefresh), NOW), 'current', 'recent producer heartbeat should be current even when content is unchanged');
assert.equal(health.sourceState(success(oldRefresh), NOW), 'stale', 'old producer heartbeat should be stale');

const oldRefetched = health.markSourceSuccess(success(oldRefresh, NOW - 60_000), oldRefresh, NOW);
assert.equal(health.sourceState(oldRefetched, NOW), 'stale', 're-fetching an old heartbeat should remain stale');

assert.equal(health.overallState({ jira: 'stale', github: 'current' }), 'stale', 'one stale source should make dashboard stale');
assert.equal(health.overallState({ jira: 'failed', github: 'stale' }), 'failed', 'failure should take precedence over staleness');

const validState = success(recentRefresh, NOW - 10_000);
const failedState = health.markSourceFailure(validState, new Error('network failure'), NOW - 10_000);
assert.equal(health.sourceState(failedState, NOW), 'failed', 'latest refresh failure should win over prior success');

const recoveredState = health.markSourceSuccess(failedState, recentRefresh, NOW);
assert.equal(health.sourceState(recoveredState, NOW), 'current', 'new recent producer heartbeat should recover from failure');

assert.equal(health.sourceState(health.emptySourceState(), NOW), 'waiting', 'source should wait before first success');
assert.equal(health.sourceState(success('not-a-date'), NOW), 'stale', 'invalid producer heartbeat should be stale');

verifyInlineScripts(new URL('../dashboard/index.html', import.meta.url));
verifyInlineScripts(new URL('../dashboard/display.html', import.meta.url));

console.log('dashboard refresh-health regression and inline syntax tests passed');
