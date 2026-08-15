import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const health = require('../dashboard/refresh-health.js');
const NOW = Date.parse('2026-08-15T12:00:00Z');
const recentPayload = { generatedAt: new Date(NOW - 10 * 60 * 1000).toISOString() };
const oldPayload = { generatedAt: new Date(NOW - 31 * 60 * 1000).toISOString() };

function success(payload, now = NOW) {
  return health.markSourceSuccess(health.emptySourceState(), payload, now);
}

assert.equal(health.sourceState(success(recentPayload), NOW), 'current', 'recent snapshot should be current');
assert.equal(health.sourceState(success(oldPayload), NOW), 'stale', 'old snapshot should be stale');

const oldRefetched = health.markSourceSuccess(success(oldPayload, NOW - 60_000), oldPayload, NOW);
assert.equal(health.sourceState(oldRefetched, NOW), 'stale', 're-fetched old snapshot should remain stale');

assert.equal(health.overallState({ jira: 'stale', github: 'current' }), 'stale', 'one stale source should make dashboard stale');

const validState = success(recentPayload, NOW - 10_000);
const failedState = health.markSourceFailure(validState, new Error('network failure'), NOW - 10_000);
assert.equal(health.sourceState(failedState, NOW), 'failed', 'latest refresh failure should win over prior success');

const recoveredState = health.markSourceSuccess(failedState, recentPayload, NOW);
assert.equal(health.sourceState(recoveredState, NOW), 'current', 'new recent success should recover from failure');

assert.equal(health.sourceState(health.emptySourceState(), NOW), 'waiting', 'source should wait before first success');
assert.equal(health.sourceState(success({ generatedAt: 'not-a-date' }), NOW), 'stale', 'invalid generatedAt should be stale');

console.log('dashboard refresh-health regression tests passed');
