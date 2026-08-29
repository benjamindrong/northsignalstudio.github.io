import assert from 'node:assert/strict';
import {
  compareBenchmarkRegistryParity,
  parseCanonicalResultSummary,
  projectBenchmarkRegistry
} from './benchmark-registry.mjs';
import { projectBenchmarkRegistry as projectLegacyBenchmarkRegistry } from './benchmark-registry-legacy.mjs';

const POINTER_SUMMARY = 'Benchmark Registry Next Pointer';

function issue(key, labels, category, {
  summary = `${key} summary`,
  description = '',
  links = [],
  updated = '2026-08-27T12:00:00.000Z'
} = {}) {
  return {
    key,
    fields: {
      summary,
      labels,
      status: { statusCategory: { key: category } },
      project: { key: 'BEN' },
      updated,
      description,
      issuelinks: links
    }
  };
}

function relates(key, summary = `${key} source`) {
  return {
    type: { name: 'Relates' },
    outwardIssue: { key, fields: { summary, project: { key: key.split('-')[0] } } }
  };
}

function pointer(parentKey = 'BEN-17') {
  return {
    key: 'BEN-21',
    fields: {
      summary: POINTER_SUMMARY,
      parent: { key: parentKey },
      updated: '2026-08-27T12:01:00.000Z'
    }
  };
}

const summaryDescription = `
## Notes

### Completion Artifact

#### Registry Result Summary
- Outcome: Response B won.
- Scores: RA 8.0 / RB 9.0.
- Signal: Response B preserved the required state boundary.
`;

const records = [
  issue('BEN-17', ['candidate-evaluation'], 'new', { summary: 'Runline Event Board PRD Candidate Evaluation', links: [relates('RUN-5')] }),
  issue('BEN-40', ['candidate-evaluation', 'registry-blocked'], 'indeterminate'),
  issue('BEN-41', ['candidate-evaluation'], 'indeterminate'),
  issue('BEN-14', ['benchmark-testing'], 'done', { summary: 'Crossmark Physical Signal Hunt Field Benchmark', links: [relates('CROS-1')] }),
  issue('BEN-9', ['candidate-evaluation', 'registry-result-summary'], 'done', { description: summaryDescription }),
  issue('BEN-10', ['candidate-evaluation', 'registry-result-unknown'], 'done', { links: [relates('HOME-12')] }),
  issue('BEN-13', ['candidate-evaluation', 'registry-idea'], 'new', { summary: 'Crossmark X Handoff Benchmark', links: [relates('CROS-1')] }),
  issue('BEN-22', ['registry-idea', 'registry-idea-considered'], 'new', { summary: 'MyRAM Markdown Preview' }),
  issue('BEN-25', ['registry-idea', 'registry-idea-fresh'], 'new', { summary: 'Runline Needs Anchoring' })
];

const registry = projectBenchmarkRegistry(records, {
  pointerIssue: pointer(),
  pointerMatches: [pointer()]
});

assert.equal(registry.state, 'ready');
assert.equal(registry.authority, 'jira-native');
assert.equal(registry.sourceLabel, 'Jira-native BEN registry');
assert.deepEqual(registry.invalidRecords, []);
assert.equal(registry.selectedNext?.key, 'BEN-17');
assert.equal(registry.selectedNext?.status, 'Preparing');
assert.equal(registry.runs.find(run => run.key === 'BEN-40')?.status, 'Blocked');
assert.equal(registry.runs.find(run => run.key === 'BEN-41')?.status, 'Running');
assert.equal(registry.runs.find(run => run.key === 'BEN-14')?.type, 'Benchmark Testing');
assert.equal(registry.runs.find(run => run.key === 'BEN-14')?.resultState, 'none');
assert.deepEqual(registry.runs.find(run => run.key === 'BEN-9')?.resultLines, [
  'Outcome: Response B won.',
  'Scores: RA 8.0 / RB 9.0.',
  'Signal: Response B preserved the required state boundary.'
]);
assert.equal(registry.runs.find(run => run.key === 'BEN-10')?.resultState, 'backfill');
assert.equal(registry.runs.find(run => run.key === 'BEN-10')?.sourceKey, 'HOME-12');
assert.equal(registry.runs.find(run => run.key === 'BEN-13')?.status, 'Unused');
assert.equal(registry.previouslyConsidered[0]?.key, 'BEN-22');
assert.equal(registry.freshBacklog[0]?.ideas[0]?.key, 'BEN-25');

const parsedSummary = parseCanonicalResultSummary(summaryDescription);
assert.equal(parsedSummary.ok, true);
assert.equal(parsedSummary.values.outcome, 'Response B won.');

const malformedSummary = parseCanonicalResultSummary(`
### Completion Artifact
#### Registry Result Summary
- Outcome: B
- Scores: 9/8
- Signal: X
### Completion Artifact
`);
assert.equal(malformedSummary.ok, false);

const invalidRecords = [
  issue('BEN-50', ['candidate-evaluation', 'benchmark-testing'], 'new'),
  issue('BEN-51', ['registry-idea', 'registry-blocked'], 'new'),
  issue('BEN-52', ['registry-idea-fresh'], 'new'),
  issue('BEN-53', ['candidate-evaluation'], 'done'),
  issue('BEN-54', ['candidate-evaluation', 'registry-result-summary'], 'done', { description: '### Completion Artifact\n- Missing result subsection' }),
  issue('BEN-55', ['candidate-evaluation', 'registry-result-unknown'], 'done', { description: summaryDescription }),
  issue('BEN-56', ['candidate-evaluation'], 'new', { links: [relates('HOME-1'), relates('RUN-1')] })
];
const invalidProjection = projectBenchmarkRegistry(invalidRecords, {
  pointerIssue: pointer('BEN-50'),
  pointerMatches: [pointer('BEN-50')]
});
assert.equal(invalidProjection.state, 'ready');
assert.equal(invalidProjection.invalidRecords.length, invalidRecords.length);
assert.equal(invalidProjection.runs.length, 0);
assert.equal(invalidProjection.selectedNext, null);
assert.match(invalidProjection.pointerError, /eligible/i);

const duplicatePointer = projectBenchmarkRegistry([records[0]], {
  pointerIssue: pointer(),
  pointerMatches: [pointer(), { key: 'BEN-99', fields: { summary: POINTER_SUMMARY, parent: { key: 'BEN-17' } } }]
});
assert.equal(duplicatePointer.state, 'ready');
assert.equal(duplicatePointer.selectedNext, null);
assert.match(duplicatePointer.pointerError, /unique/i);

const ideaPointer = projectBenchmarkRegistry([records[0], records[6]], {
  pointerIssue: pointer('BEN-13'),
  pointerMatches: [pointer('BEN-13')]
});
assert.equal(ideaPointer.selectedNext, null);
assert.match(ideaPointer.pointerError, /eligible/i);

const legacy = projectLegacyBenchmarkRegistry(`
## Benchmark Run Ledger
### BEN-17 — Runline Event Board PRD Candidate Evaluation
- Status: Selected — next
- Source: RUN-5 large-format Runline Event Board
### BEN-14 — Crossmark Physical Signal Hunt Field Benchmark
- Status: Completed
- Source: CROS-1 production field benchmark
### BEN-9 — Runline Authority Handoff Console
- Status: Completed
- Candidate results: Response B won.
### BEN-10 — Homepage Dashboard PR Health Panel Benchmark
- Status: Completed
- Source: HOME-12 shared Compose PR Health panel
- Exact scores/winners: Backfill from original review records.
## Previously Considered / Unused Ideas
- MyRAM Markdown Preview
## Fresh Idea Backlog
### Runline
- Runline Needs Anchoring
`);
assert.equal(legacy.authority, 'ben-8');
assert.equal(legacy.sourceLabel, 'BEN-8 temporary rollback authority');

const nativeParity = projectBenchmarkRegistry([
  records[0], records[3], records[4], records[5], records[7], records[8]
], {
  pointerIssue: pointer(),
  pointerMatches: [pointer()]
});
const parity = compareBenchmarkRegistryParity(nativeParity, legacy, {
  runKeys: ['BEN-17', 'BEN-14', 'BEN-9', 'BEN-10'],
  consideredKeys: ['BEN-22'],
  freshKeys: ['BEN-25']
});
assert.equal(parity.ok, true, parity.errors.join('\n'));

console.log('benchmark Jira-native registry contract tests passed');
