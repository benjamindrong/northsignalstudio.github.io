import assert from 'node:assert/strict';
import { projectBenchmarkRegistry } from './benchmark-registry.mjs';

function issue(key, links) {
  return {
    key,
    fields: {
      summary: `${key} source relation test`,
      labels: ['failure-evaluation'],
      status: { statusCategory: { key: 'done' } },
      project: { key: 'BEN' },
      updated: '2026-09-17T12:00:00.000Z',
      description: '',
      issuelinks: links
    }
  };
}

function outwardRelates(key) {
  return {
    type: { name: 'Relates' },
    outwardIssue: { key, fields: { project: { key: key.split('-')[0] } } }
  };
}

function inboundRelates(key) {
  return {
    type: { name: 'Relates' },
    inwardIssue: { key, fields: { project: { key: key.split('-')[0] } } }
  };
}

const ben63Shape = projectBenchmarkRegistry([
  issue('BEN-63', [outwardRelates('MYR-221'), inboundRelates('LAN-38')])
]);
assert.equal(ben63Shape.invalidRecords.length, 0);
assert.equal(ben63Shape.runs[0]?.sourceKey, 'MYR-221');
assert.equal(ben63Shape.runs[0]?.source, 'MYR-221');

const inboundOnly = projectBenchmarkRegistry([
  issue('BEN-64', [inboundRelates('LAN-38')])
]);
assert.equal(inboundOnly.invalidRecords.length, 0);
assert.equal(inboundOnly.runs[0]?.sourceKey, '');
assert.equal(inboundOnly.runs[0]?.source, 'Unknown');

const ambiguousSources = projectBenchmarkRegistry([
  issue('BEN-65', [outwardRelates('MYR-221'), outwardRelates('HOME-23')])
]);
assert.equal(ambiguousSources.runs.length, 0);
assert.equal(ambiguousSources.invalidRecords.length, 1);
assert.match(
  ambiguousSources.invalidRecords[0]?.reasons.join('\n') || '',
  /More than one outward cross-project Relates source link is present\./
);

console.log('benchmark registry source relation tests passed');
