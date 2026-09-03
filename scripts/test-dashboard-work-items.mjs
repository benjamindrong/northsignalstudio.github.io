import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const workItems = require('../dashboard/work-items.js');

assert.deepEqual(workItems.statusInfo('Blocked'), { className: 'blocked', rank: 0 });
assert.deepEqual(workItems.statusInfo('In Review'), { className: 'review', rank: 1 });
assert.deepEqual(workItems.statusInfo('In Progress'), { className: 'progress', rank: 2 });
assert.deepEqual(workItems.statusInfo('To Do'), { className: 'todo', rank: 3 });
assert.deepEqual(workItems.statusInfo('Unknown State'), { className: 'unknown', rank: 4 });
assert.deepEqual(workItems.statusInfo('Done'), { className: 'done', rank: 9 });

assert.equal(workItems.pullIdentity({ repository: '  Ben/Repo  ', number: 7 }), 'ben/repo#7');
assert.equal(workItems.pullIdentity({ repository: 'Ben/Repo', number: '7' }), 'ben/repo#7');
assert.equal(workItems.pullIdentity({ repository: '', number: 7 }), '');
assert.equal(workItems.pullIdentity({ repository: 'Ben/Repo', number: 0 }), '');
assert.equal(workItems.pullIdentity({ repository: 'Ben/Repo', number: 1.5 }), '');

const flight = workItems.flightDescriptors({
  projects: ['HOME', 'LAN'],
  issues: [
    { key: 'HOME-3', projectKey: 'HOME', projectName: 'Homepage', status: 'To Do', statusCategory: 'new', lastMove: '2026-09-03T10:00:00Z' },
    { key: 'HOME-2', projectKey: 'HOME', projectName: 'Homepage', status: 'In Progress', statusCategory: 'indeterminate', lastMove: '2026-09-03T09:00:00Z' },
    { key: 'HOME-1', projectKey: 'HOME', projectName: 'Homepage', status: 'Done', statusCategory: 'done', lastMove: '2026-09-03T11:00:00Z' },
    { key: 'LAN-4', projectKey: 'LAN', projectName: 'Lantern', status: 'To Do', statusCategory: 'new', lastMove: '2026-09-03T12:00:00Z' },
  ]
});
assert.deepEqual(flight.map(item => [item.type, item.id]), [
  ['header', 'HOME:active'],
  ['row', 'HOME-2'],
  ['row', 'HOME-3'],
  ['header', 'LAN:active'],
  ['row', 'LAN-4'],
  ['header', 'HOME:recently-done'],
  ['row', 'HOME-1'],
]);

const github = workItems.githubDescriptors({ pullRequests: [
  { repository: 'b/z', number: 3, title: 'three', state: 'OPEN', attentionRank: 1, updatedAt: '2026-09-03T09:00:00Z' },
  { repository: 'a/a', number: 2, title: 'two', state: 'OPEN', attentionRank: 0, updatedAt: '2026-09-03T08:00:00Z' },
  { repository: 'a/a', number: 1, title: 'draft', state: 'DRAFT', attentionRank: 0, updatedAt: '2026-09-03T12:00:00Z' },
  { repository: 'a/a', number: 4, title: 'four', state: 'OPEN', attentionRank: 1, updatedAt: '2026-09-03T10:00:00Z' },
]});
assert.deepEqual(github.map(item => item.id), ['a/a#2', 'a/a#4', 'b/z#3']);

const jiraItems = Array.from({ length: 12 }, (_, index) => ({
  key: `HOME-${index + 1}`,
  summary: `Issue ${index + 1}`,
  updatedAt: new Date(Date.UTC(2026, 8, 3, 12, 0, 0) - index * 60_000).toISOString(),
  url: `https://jira.example/HOME-${index + 1}`,
}));
const recent = workItems.recentActivityItems(
  { issues: jiraItems },
  { pullRequests: [{ repository: 'Ben/Repo', number: 7, title: 'PR 7', state: 'OPEN', updatedAt: '2026-09-03T00:00:00Z', url: 'https://github.example/pr/7' }] },
);
assert.equal(recent.length, 12);
assert.ok(recent.some(item => item.source === 'GITHUB'), 'top-12 source representation rule must retain a GitHub representative');
assert.ok(recent.every(item => item.stableId.startsWith(`${item.source}:`)));
assert.deepEqual([...recent].sort(workItems.recentActivityCompare), recent);

const recentDescriptors = workItems.recentDescriptors(
  { issues: [{ key: 'HOME-29', summary: 'Expandable', updatedAt: '2026-09-03T12:00:00Z', url: 'https://jira/HOME-29' }] },
  { pullRequests: [{ repository: 'Ben/Repo', number: 7, title: 'Linked', state: 'OPEN', updatedAt: '2026-09-03T11:00:00Z', url: 'https://github/pr/7' }] },
);
assert.deepEqual(recentDescriptors.map(item => item.id), ['JIRA:HOME-29', 'GITHUB:ben/repo#7']);

console.log('dashboard work-item projection regressions passed');
