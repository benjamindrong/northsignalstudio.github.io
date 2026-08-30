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

verifyInlineScripts(new URL('../dashboard/index.html', import.meta.url));
verifyInlineScripts(new URL('../dashboard/display.html', import.meta.url));

console.log('dashboard refresh-health regression and inline syntax tests passed');
