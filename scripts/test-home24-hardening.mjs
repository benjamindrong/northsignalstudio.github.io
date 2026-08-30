import assert from 'node:assert/strict';
import {
  compareBenchmarkRegistryParity,
  parseCanonicalResultSummary,
  projectBenchmarkRegistry
} from './benchmark-registry.mjs';
import { projectBenchmarkRegistry as projectLegacyBenchmarkRegistry } from './benchmark-registry-legacy.mjs';

const POINTER_SUMMARY = 'Benchmark Registry Next Pointer';

function text(value) {
  return { type: 'text', text: value };
}

function heading(level, value) {
  return { type: 'heading', attrs: { level }, content: [text(value)] };
}

function paragraph(value) {
  return { type: 'paragraph', content: [text(value)] };
}

function bullet(value) {
  return { type: 'listItem', content: [paragraph(value)] };
}

function canonicalSummary(extra = []) {
  return {
    type: 'doc',
    version: 1,
    content: [
      heading(3, 'Completion Artifact'),
      heading(4, 'Registry Result Summary'),
      {
        type: 'bulletList',
        content: [
          bullet('Outcome: Response B won.'),
          bullet('Scores: RA 8 / RB 9.'),
          bullet('Signal: State boundaries were preserved.')
        ]
      },
      ...extra
    ]
  };
}

const valid = parseCanonicalResultSummary(canonicalSummary());
assert.equal(valid.ok, true, valid.error);

const nestedDuplicateResult = parseCanonicalResultSummary(canonicalSummary([
  {
    type: 'panel',
    attrs: { panelType: 'info' },
    content: [heading(4, 'Registry Result Summary'), paragraph('Hidden competing result authority.')]
  }
]));
assert.equal(nestedDuplicateResult.ok, false);
assert.match(nestedDuplicateResult.error, /exactly one #### Registry Result Summary/i);

const nestedDuplicateArtifact = parseCanonicalResultSummary(canonicalSummary([
  {
    type: 'expand',
    attrs: { title: 'Older completion evidence' },
    content: [heading(3, 'Completion Artifact'), paragraph('Hidden competing artifact authority.')]
  }
]));
assert.equal(nestedDuplicateArtifact.ok, false);
assert.match(nestedDuplicateArtifact.error, /exactly one ### Completion Artifact/i);

const nestedCanonicalOnly = parseCanonicalResultSummary({
  type: 'doc',
  version: 1,
  content: [{
    type: 'panel',
    attrs: { panelType: 'info' },
    content: [
      heading(3, 'Completion Artifact'),
      heading(4, 'Registry Result Summary'),
      { type: 'bulletList', content: [bullet('Outcome: B'), bullet('Scores: 9/8'), bullet('Signal: X')] }
    ]
  }]
});
assert.equal(nestedCanonicalOnly.ok, false);
assert.match(nestedCanonicalOnly.error, /top-level Description sections/i);

const panelWrappedBullets = parseCanonicalResultSummary({
  type: 'doc',
  version: 1,
  content: [
    heading(3, 'Completion Artifact'),
    heading(4, 'Registry Result Summary'),
    {
      type: 'panel',
      attrs: { panelType: 'info' },
      content: [{ type: 'bulletList', content: [bullet('Outcome: B'), bullet('Scores: 9/8'), bullet('Signal: X')] }]
    }
  ]
});
assert.equal(panelWrappedBullets.ok, false);
assert.match(panelWrappedBullets.error, /top-level bullet-list items|only the three required bullets/i);

const unknownWithNestedSummary = projectBenchmarkRegistry([{
  key: 'BEN-90',
  fields: {
    summary: 'Unknown result fixture',
    labels: ['candidate-evaluation', 'registry-result-unknown'],
    status: { statusCategory: { key: 'done' } },
    project: { key: 'BEN' },
    updated: '2026-08-29T12:00:00.000Z',
    issuelinks: [],
    description: {
      type: 'doc',
      version: 1,
      content: [{
        type: 'panel',
        attrs: { panelType: 'warning' },
        content: [heading(4, 'Registry Result Summary'), paragraph('Competing result text.')]
      }]
    }
  }
}], {
  pointerIssue: null,
  pointerMatches: []
});
assert.equal(unknownWithNestedSummary.runs.length, 0);
assert.match(unknownWithNestedSummary.invalidRecords[0]?.reasons.join('\n') || '', /cannot contain a Registry Result Summary/i);

const pointerTarget = {
  key: 'BEN-91',
  fields: {
    summary: 'Pointer target',
    labels: ['candidate-evaluation'],
    status: { statusCategory: { key: 'new' } },
    project: { key: 'BEN' },
    updated: '2026-08-29T12:00:00.000Z',
    issuelinks: []
  }
};
const pointerIssue = {
  key: 'BEN-21',
  fields: {
    summary: POINTER_SUMMARY,
    labels: [],
    issuetype: { name: 'Subtask', subtask: true },
    parent: { key: 'BEN-91' },
    updated: '2026-08-29T12:01:00.000Z'
  }
};
const duplicateCasePointer = projectBenchmarkRegistry([pointerTarget], {
  pointerIssue,
  pointerMatches: [
    { key: 'BEN-21', fields: { summary: POINTER_SUMMARY } },
    { key: 'BEN-92', fields: { summary: 'benchmark   registry next pointer' } }
  ]
});
assert.equal(duplicateCasePointer.selectedNext, null);
assert.match(duplicateCasePointer.pointerError, /not the unique/i);

const legacy = projectLegacyBenchmarkRegistry(`
## Benchmark Run Ledger
### BEN-6 — Benchmark idea discovery
- Status: Completed
### BEN-14 — Crossmark Physical Signal Hunt Field Benchmark
- Status: Completed
- Type: Benchmark Testing — production field benchmark
### BEN-17 — Runline Event Board PRD Candidate Evaluation
- Status: Selected — next
- Type: Candidate Evaluation — comparative model documentation exercise
`);
assert.equal(legacy.state, 'ready');
assert.equal(legacy.runs.some(run => run.key === 'BEN-6'), false, 'BEN-6 must stay excluded during rollback');
const legacyTesting = legacy.runs.find(run => run.key === 'BEN-14');
assert.equal(legacyTesting?.activityKind, 'benchmark-testing');
assert.equal(legacyTesting?.resultState, 'none');
assert.match(legacyTesting?.type || '', /^Benchmark Testing\b/);
const legacySelected = legacy.runs.find(run => run.key === 'BEN-17');
assert.equal(legacySelected?.activityKind, 'candidate-evaluation');
assert.equal(legacySelected?.resultState, 'none');
assert.equal(legacy.selectedNext?.key, 'BEN-17');

const sourceParityBase = {
  state: 'ready',
  selectedNext: null,
  pointerUpdatedAt: '2026-08-27T12:00:00.000Z',
  previouslyConsidered: [],
  freshBacklog: []
};
const exactSourceParity = compareBenchmarkRegistryParity({
  ...sourceParityBase,
  runs: [{ key: 'BEN-91', status: 'Completed', resultState: 'none', sourceKey: 'RUN-5', updatedAt: '2026-08-27T12:00:00.000Z' }]
}, {
  ...sourceParityBase,
  runs: [{ key: 'BEN-91', status: 'Completed', resultState: 'none', source: 'RUN-5 source' }]
}, { runKeys: ['BEN-91'], consideredKeys: [], freshKeys: [] });
assert.equal(exactSourceParity.ok, true, exactSourceParity.errors.join('\n'));

const substringSourceParity = compareBenchmarkRegistryParity({
  ...sourceParityBase,
  runs: [{ key: 'BEN-91', status: 'Completed', resultState: 'none', sourceKey: 'RUN-5', updatedAt: '2026-08-27T12:00:00.000Z' }]
}, {
  ...sourceParityBase,
  runs: [{ key: 'BEN-91', status: 'Completed', resultState: 'none', source: 'RUN-50 source' }]
}, { runKeys: ['BEN-91'], consideredKeys: [], freshKeys: [] });
assert.equal(substringSourceParity.ok, false, 'RUN-5 must not match RUN-50 by substring');
assert.match(substringSourceParity.errors.join('\n'), /exact BEN-8 source key/i);

console.log('HOME-24 adversarial registry hardening tests passed');
