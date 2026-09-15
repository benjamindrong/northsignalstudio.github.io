import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const relationships = require('../dashboard/work-relationships.js');
const workItems = require('../dashboard/work-items.js');

const jira = (key, url = `https://example.atlassian.net/browse/${key}`) => ({
  key,
  summary: `${key} summary`,
  url,
});

const pull = (number, title, overrides = {}) => ({
  repository: 'benjamindrong/HomepageDashboard',
  number,
  title,
  sourceBranch: '',
  url: `https://github.com/benjamindrong/HomepageDashboard/pull/${number}`,
  state: 'OPEN',
  ...overrides,
});

function resolve(jiraIssues, pullRequests) {
  return relationships.resolve({ issues: jiraIssues }, { pullRequests });
}

{
  const result = resolve(
    [jira('MYR-220')],
    [pull(155, 'Expose multiple pins in note lists and improve widget pinned-text readability', {
      repository: 'benjamindrong/MyRAM-iOS',
      sourceBranch: 'MYR-220-Expose-multiple-pins-in-note-lists-and-improve-widget-pinned-text-readability',
      url: 'https://github.com/benjamindrong/MyRAM-iOS/pull/155',
    })],
  );
  assert.deepEqual(result.jiraRelations, [{
    primaryUrl: 'https://example.atlassian.net/browse/MYR-220',
    primaryIdentity: 'MYR-220',
    counterpartUrl: 'https://github.com/benjamindrong/MyRAM-iOS/pull/155',
    counterpartIdentity: 'PR #155',
  }]);
  assert.deepEqual(result.githubRelations, [{
    primaryUrl: 'https://github.com/benjamindrong/MyRAM-iOS/pull/155',
    primaryIdentity: 'MyRAM-iOS #155',
    counterpartUrl: 'https://example.atlassian.net/browse/MYR-220',
    counterpartIdentity: 'MYR-220',
  }]);
}

{
  const result = resolve(
    [jira('HOME-19')],
    [pull(5, 'HOME-19 appears in the title but this PR has no ticket branch', {
      sourceBranch: 'Fix-dashboard-Dock-icon',
    })],
  );
  assert.deepEqual(
    result,
    { jiraRelations: [], githubRelations: [] },
    'a title key alone must not invent a Jira relationship when the PR branch is unticketed',
  );
}

{
  const result = resolve(
    [jira('HOME-19')],
    [pull(5, 'Human-readable title', { sourceBranch: 'HOME-19-work-UNKNOWN-8' })],
  );
  assert.equal(result.jiraRelations.length, 1, 'only Jira tickets actually present on the dashboard participate in branch matching');
  assert.equal(result.githubRelations.length, 1);
  assert.equal(result.githubRelations[0].counterpartIdentity, 'HOME-19');
}

{
  const result = resolve(
    [jira('HOME-19'), jira('HOME-20')],
    [pull(5, 'Human-readable title', { sourceBranch: 'HOME-19-and-HOME-20' })],
  );
  assert.deepEqual(
    result,
    { jiraRelations: [], githubRelations: [] },
    'a branch matching multiple displayed Jira tickets must fail closed',
  );
}

for (const sourceBranch of ['', 'Fix-dashboard-Dock-icon', 'UNKNOWN-8-work']) {
  const result = resolve(
    [jira('HOME-19'), jira('HOME-20')],
    [pull(5, 'No relationship required', { sourceBranch })],
  );
  assert.deepEqual(
    result,
    { jiraRelations: [], githubRelations: [] },
    `PRs without a displayed Jira ticket match remain standalone: ${sourceBranch || '<empty>'}`,
  );
}

{
  const duplicateJira = resolve(
    [jira('HOME-19'), jira('HOME-19', 'https://example.atlassian.net/browse/HOME-19-copy')],
    [pull(5, 'Human-readable title', { sourceBranch: 'HOME-19-work' })],
  );
  assert.deepEqual(duplicateJira, { jiraRelations: [], githubRelations: [] }, 'duplicate Jira identity must fail closed');
}

{
  const duplicatePrIdentity = resolve(
    [jira('HOME-19')],
    [
      pull(5, 'First copy', { sourceBranch: 'HOME-19-first' }),
      pull(5, 'Duplicate identity', {
        sourceBranch: 'HOME-19-second',
        url: 'https://github.com/benjamindrong/HomepageDashboard/pull/5?duplicate=1',
      }),
    ],
  );
  assert.deepEqual(duplicatePrIdentity, { jiraRelations: [], githubRelations: [] }, 'duplicate PR identity must fail closed');
}

{
  const caseVariantDuplicatePrIdentity = resolve(
    [jira('HOME-19')],
    [
      pull(5, 'Canonical casing', { sourceBranch: 'HOME-19-first' }),
      pull(5, 'Alternate repository casing', {
        repository: 'BENJAMINDRONG/homepagedashboard',
        sourceBranch: 'HOME-19-second',
        url: 'https://github.com/benjamindrong/HomepageDashboard/pull/5?case-duplicate=1',
      }),
    ],
  );
  assert.deepEqual(
    caseVariantDuplicatePrIdentity,
    { jiraRelations: [], githubRelations: [] },
    'GitHub repository casing must not bypass duplicate PR identity detection',
  );
}

{
  const result = resolve(
    [jira('HOME-19')],
    [
      pull(5, 'First PR', { sourceBranch: 'HOME-19-first' }),
      pull(6, 'Second PR', { sourceBranch: 'HOME-19-second' }),
    ],
  );
  assert.equal(result.jiraRelations.length, 0, 'Jira row must not choose arbitrarily among multiple PRs');
  assert.equal(result.githubRelations.length, 2, 'each uniquely identified PR may still point back to Jira');
  assert.deepEqual(result.githubRelations.map(item => item.primaryIdentity), ['HomepageDashboard #5', 'HomepageDashboard #6']);
}

{
  const jiraPayload = { issues: [jira('HOME-19'), jira('HOME-20')] };
  const githubPayload = {
    pullRequests: [
      pull(5, 'Ticketed work', { sourceBranch: 'HOME-19-work' }),
      pull(6, 'Unticketed work', { sourceBranch: 'Fix-dashboard-Dock-icon' }),
    ],
  };
  const before = JSON.stringify({ jiraPayload, githubPayload });
  relationships.resolve(jiraPayload, githubPayload);
  assert.equal(JSON.stringify({ jiraPayload, githubPayload }), before, 'relationship resolution must not mutate or reorder source payloads');
}

assert.equal(relationships.compactCounterpartLabel('PR #5'), '↔ #5');
assert.equal(relationships.compactCounterpartLabel('HOME-19'), '↔ HOME-19');
assert.deepEqual(relationships.distinctKeys('HOME-19 HOME-19 HOME-20'), ['HOME-19', 'HOME-20']);
assert.equal(
  relationships.jiraKeyForPull(
    pull(5, 'No key in title', { sourceBranch: 'HOME-19-work' }),
    new Set(['HOME-19']),
  ),
  'HOME-19',
);
assert.equal(
  relationships.jiraKeyForPull(
    pull(5, 'HOME-19 only in title', { sourceBranch: 'Fix-dashboard-Dock-icon' }),
    new Set(['HOME-19']),
  ),
  '',
);
assert.equal(workItems.pullIdentity(pull(5, 'HOME-19')), 'benjamindrong/homepagedashboard#5');
assert.equal(
  workItems.pullIdentity(pull(5, 'HOME-19', { repository: '  BENJAMINDRONG/HomepageDashboard  ' })),
  'benjamindrong/homepagedashboard#5',
);
assert.equal(workItems.pullIdentity({ repository: 'repo', number: 0 }), '');
assert.equal('pullIdentity' in relationships, false, 'DashboardWorkItems must be the sole PR identity implementation');

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

const relationshipSource = fs.readFileSync(new URL('../dashboard/work-relationships.js', import.meta.url), 'utf8');
for (const marker of [
  "const slot = row.querySelector('[data-work-counterpart-slot]')",
  "slot?.querySelectorAll('.work-counterpart-link').forEach(link => link.remove())",
  'let counterpart = slot.querySelector(\'.work-counterpart-link\')',
  'counterpart.remove()',
  'slot.appendChild(counterpart)',
]) {
  assert.ok(relationshipSource.includes(marker), `in-place relationship decoration missing marker: ${marker}`);
}
assert.ok(relationshipSource.includes('WorkItems.pullIdentity'), 'relationship resolution must consume DashboardWorkItems identity');
assert.doesNotMatch(relationshipSource, /function\s+pullIdentity\s*\(|restoreRows\s*\(|convertRow\s*\(/, 'relationships must not duplicate identity or reconstruct row shells');

console.log('dashboard Jira↔PR relationship regressions passed');
