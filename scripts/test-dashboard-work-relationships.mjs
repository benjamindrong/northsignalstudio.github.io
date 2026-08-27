import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const relationships = require('../dashboard/work-relationships.js');

const jira = (key, url = `https://example.atlassian.net/browse/${key}`) => ({
  key,
  summary: `${key} summary`,
  url,
});

const pull = (number, title, overrides = {}) => ({
  repository: 'benjamindrong/HomepageDashboard',
  number,
  title,
  url: `https://github.com/benjamindrong/HomepageDashboard/pull/${number}`,
  state: 'OPEN',
  ...overrides,
});

function resolve(jiraIssues, pullRequests) {
  return relationships.resolve({ issues: jiraIssues }, { pullRequests });
}

{
  const result = resolve([jira('HOME-19')], [pull(5, 'HOME-19 Guarantee GitHub PR visibility')]);
  assert.deepEqual(result.jiraRelations, [{
    primaryUrl: 'https://example.atlassian.net/browse/HOME-19',
    primaryIdentity: 'HOME-19',
    counterpartUrl: 'https://github.com/benjamindrong/HomepageDashboard/pull/5',
    counterpartIdentity: 'PR #5',
  }]);
  assert.deepEqual(result.githubRelations, [{
    primaryUrl: 'https://github.com/benjamindrong/HomepageDashboard/pull/5',
    primaryIdentity: 'HomepageDashboard #5',
    counterpartUrl: 'https://example.atlassian.net/browse/HOME-19',
    counterpartIdentity: 'HOME-19',
  }]);
}

{
  const result = resolve([jira('HOME-19')], [pull(5, 'HOME-19 follows HOME-19')]);
  assert.equal(result.jiraRelations.length, 1, 'repeated copies of the same key remain one distinct key');
  assert.equal(result.githubRelations.length, 1);
}

for (const title of ['No Jira key here', 'HOME-19 and HOME-20 together', 'UNKNOWN-8 not in Jira feed']) {
  const result = resolve([jira('HOME-19'), jira('HOME-20')], [pull(5, title)]);
  assert.deepEqual(result, { jiraRelations: [], githubRelations: [] }, `must fail closed for: ${title}`);
}

{
  const duplicateJira = resolve([jira('HOME-19'), jira('HOME-19', 'https://example.atlassian.net/browse/HOME-19-copy')], [pull(5, 'HOME-19 work')]);
  assert.deepEqual(duplicateJira, { jiraRelations: [], githubRelations: [] }, 'duplicate Jira identity must fail closed');
}

{
  const duplicatePrIdentity = resolve(
    [jira('HOME-19')],
    [pull(5, 'HOME-19 first'), pull(5, 'HOME-19 duplicate identity', { url: 'https://github.com/benjamindrong/HomepageDashboard/pull/5?duplicate=1' })],
  );
  assert.deepEqual(duplicatePrIdentity, { jiraRelations: [], githubRelations: [] }, 'duplicate PR identity must fail closed');
}

{
  const result = resolve([jira('HOME-19')], [pull(5, 'HOME-19 first'), pull(6, 'HOME-19 second')]);
  assert.equal(result.jiraRelations.length, 0, 'Jira row must not choose arbitrarily among multiple PRs');
  assert.equal(result.githubRelations.length, 2, 'each uniquely identified PR may still point back to Jira');
  assert.deepEqual(result.githubRelations.map(item => item.primaryIdentity), ['HomepageDashboard #5', 'HomepageDashboard #6']);
}

{
  const jiraPayload = { issues: [jira('HOME-19'), jira('HOME-20')] };
  const githubPayload = { pullRequests: [pull(5, 'HOME-19 work'), pull(6, 'No key')] };
  const before = JSON.stringify({ jiraPayload, githubPayload });
  relationships.resolve(jiraPayload, githubPayload);
  assert.equal(JSON.stringify({ jiraPayload, githubPayload }), before, 'relationship resolution must not mutate or reorder source payloads');
}

assert.equal(relationships.compactCounterpartLabel('PR #5'), '↔ #5');
assert.equal(relationships.compactCounterpartLabel('HOME-19'), '↔ HOME-19');
assert.deepEqual(relationships.distinctTitleKeys('HOME-19 HOME-19 HOME-20'), ['HOME-19', 'HOME-20']);
assert.equal(relationships.pullIdentity(pull(5, 'HOME-19')), 'benjamindrong/HomepageDashboard#5');
assert.equal(relationships.pullIdentity({ repository: 'repo', number: 0 }), '');

const healthSource = fs.readFileSync(new URL('../dashboard/refresh-health.js', import.meta.url), 'utf8');
for (const marker of [
  "script.src = './work-relationships.js'",
  'pendingWorkSources.jira = payload',
  'pendingWorkSources.github = {',
  "toUpperCase() !== 'DRAFT'",
  'DashboardWorkRelationships.render',
  'Promise.resolve().then(flushWorkRelationships)',
]) {
  assert.ok(healthSource.includes(marker), `refresh bridge missing marker: ${marker}`);
}

console.log('dashboard Jira↔PR relationship regressions passed');
