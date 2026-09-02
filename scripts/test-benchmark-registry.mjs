import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseCanonicalResultSummary, projectBenchmarkRegistry } from './benchmark-registry.mjs';

const require = createRequire(import.meta.url);
const { orderedNextRuns, pointerErrorMessage } = require('../dashboard/benchmark-review.js');
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

function pointer(parentKey = 'BEN-17', updated = '2026-08-27T12:01:00.000Z', labels = [], issuetype = { name: 'Subtask', subtask: true }) {
  return {
    key: 'BEN-21',
    fields: { summary: POINTER_SUMMARY, parent: { key: parentKey }, updated, labels, issuetype }
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
  issue('BEN-25', ['registry-idea', 'registry-idea-fresh'], 'new', { summary: 'Runline Needs Anchoring' }),
  issue('BEN-6', ['candidate-evaluation'], 'new', { summary: 'Legacy support history must stay excluded' }),
  issue('BEN-21', ['candidate-evaluation'], 'new', { summary: POINTER_SUMMARY }),
  issue('BEN-33', ['registry-idea', 'registry-idea-fresh'], 'new', { summary: 'VOID duplicate must stay excluded' })
];

const registry = projectBenchmarkRegistry(records, { pointerIssue: pointer(), pointerMatches: [pointer()] });
assert.equal(registry.state, 'ready');
assert.equal(registry.authority, 'jira-native');
assert.equal(registry.sourceKey, 'BEN');
assert.equal(registry.sourceLabel, 'Jira-native BEN registry');
assert.equal(registry.pointerUpdatedAt, '2026-08-27T12:01:00.000Z');
assert.deepEqual(registry.invalidRecords, []);
assert.equal(registry.selectedNext?.key, 'BEN-17');
assert.equal(registry.selectedNext?.status, 'Preparing');
assert.equal(registry.runs.find(run => run.key === 'BEN-40')?.status, 'Blocked');
assert.equal(registry.runs.find(run => run.key === 'BEN-41')?.status, 'Running');
assert.equal(registry.runs.find(run => run.key === 'BEN-14')?.activityKind, 'benchmark-testing');
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
assert.equal(registry.previouslyConsidered[0]?.updatedAt, '2026-08-27T12:00:00.000Z');
assert.equal(registry.freshBacklog[0]?.ideas[0]?.key, 'BEN-25');
assert.equal(registry.freshBacklog[0]?.ideas[0]?.updatedAt, '2026-08-27T12:00:00.000Z');

const uiPreparingRuns = [
  { key: 'BEN-42', status: 'Preparing' },
  { key: 'BEN-17', status: 'Preparing' }
];
assert.deepEqual(
  orderedNextRuns({ runs: uiPreparingRuns, selectedNext: { key: 'BEN-17', status: 'Preparing' }, pointerError: '' }).map(run => run.key),
  ['BEN-17', 'BEN-42']
);
const missingPointerUi = { runs: uiPreparingRuns, selectedNext: null, pointerError: 'BEN-21 Parent is missing.' };
assert.deepEqual(orderedNextRuns(missingPointerUi), []);
assert.match(pointerErrorMessage(missingPointerUi), /Parent is missing/i);
const missingPointerErrorUi = { runs: uiPreparingRuns, selectedNext: null, pointerError: '' };
assert.deepEqual(orderedNextRuns(missingPointerErrorUi), []);
assert.match(pointerErrorMessage(missingPointerErrorUi), /selected Preparing/i);
assert.deepEqual(
  orderedNextRuns({ runs: uiPreparingRuns, selectedNext: { key: 'BEN-17', status: 'Running' }, pointerError: '' }),
  []
);
const missingSelectedRunUi = {
  runs: [{ key: 'BEN-42', status: 'Preparing' }],
  selectedNext: { key: 'BEN-17', status: 'Preparing' },
  pointerError: ''
};
assert.deepEqual(orderedNextRuns(missingSelectedRunUi), []);
assert.match(pointerErrorMessage(missingSelectedRunUi), /unavailable from the Preparing registry projection/i);

const allProjectedKeys = new Set([
  ...registry.runs.map(record => record.key),
  ...registry.previouslyConsidered.map(record => record.key),
  ...registry.freshBacklog.flatMap(group => (group.ideas || []).map(record => record.key)),
  ...registry.invalidRecords.map(record => record.key)
]);
for (const excluded of ['BEN-6', 'BEN-21', 'BEN-33']) assert.equal(allProjectedKeys.has(excluded), false, `${excluded} must remain excluded`);

const parsedSummary = parseCanonicalResultSummary(summaryDescription);
assert.equal(parsedSummary.ok, true);
assert.equal(parsedSummary.values.outcome, 'Response B won.');

for (const bad of [
  `### Completion Artifact\n#### Registry Result Summary\n- Outcome: B\n- Scores: 9/8\n- Signal: X\n### Completion Artifact`,
  `### Completion Artifact\n#### Registry Result Summary\n- Scores: 9/8\n- Outcome: B\n- Signal: X`,
  `### Completion Artifact\n#### Registry Result Summary\n- Outcome: B\n- Scores: 9/8`
]) assert.equal(parseCanonicalResultSummary(bad).ok, false);

const nestedSummaryAdf = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Completion Artifact' }] },
    { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Registry Result Summary' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Outcome: B' }] },
            {
              type: 'bulletList',
              content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Extra: nested evidence' }] }] }
              ]
            }
          ]
        },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Scores: 9/8' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Signal: X' }] }] }
      ]
    }
  ]
};
const nestedSummary = parseCanonicalResultSummary(nestedSummaryAdf);
assert.equal(nestedSummary.ok, false);
assert.match(nestedSummary.error, /three top-level bullet-list items/i);

const orderedSummaryAdf = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Completion Artifact' }] },
    { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Registry Result Summary' }] },
    {
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Outcome: B' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Scores: 9/8' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Signal: X' }] }] }
      ]
    }
  ]
};
const orderedSummary = parseCanonicalResultSummary(orderedSummaryAdf);
assert.equal(orderedSummary.ok, false);
assert.match(orderedSummary.error, /three top-level bullet-list items/i);

const invalidRecords = [
  issue('BEN-50', ['candidate-evaluation', 'benchmark-testing'], 'new'),
  issue('BEN-51', ['registry-idea', 'registry-blocked'], 'new'),
  issue('BEN-52', ['registry-idea-fresh'], 'new'),
  issue('BEN-53', ['candidate-evaluation'], 'done'),
  issue('BEN-54', ['candidate-evaluation', 'registry-result-summary'], 'done', { description: '### Completion Artifact\n- Missing result subsection' }),
  issue('BEN-55', ['candidate-evaluation', 'registry-result-unknown'], 'done', { description: summaryDescription }),
  issue('BEN-56', ['candidate-evaluation'], 'new', { links: [relates('HOME-1'), relates('RUN-1')] }),
  issue('BEN-57', ['candidate-evaluation', 'registry-retired'], 'new'),
  issue('BEN-58', ['candidate-evaluation', 'registry-blocked'], 'done'),
  issue('BEN-59', ['registry-idea', 'registry-idea-considered', 'registry-idea-fresh'], 'new')
];
const invalidProjection = projectBenchmarkRegistry(invalidRecords, { pointerIssue: pointer('BEN-50'), pointerMatches: [pointer('BEN-50')] });
assert.equal(invalidProjection.state, 'ready');
assert.equal(invalidProjection.invalidRecords.length, invalidRecords.length);
assert.equal(invalidProjection.runs.length, 0);
assert.equal(invalidProjection.selectedNext, null);
assert.match(invalidProjection.pointerError, /eligible/i);

const duplicatePointer = projectBenchmarkRegistry([records[0]], {
  pointerIssue: pointer(),
  pointerMatches: [pointer(), { key: 'BEN-99', fields: { summary: POINTER_SUMMARY } }]
});
assert.equal(duplicatePointer.selectedNext, null);
assert.match(duplicatePointer.pointerError, /unique/i);

const normalizedDuplicatePointer = projectBenchmarkRegistry([records[0]], {
  pointerIssue: pointer(),
  pointerMatches: [pointer(), { key: 'BEN-99', fields: { summary: '  benchmark   registry NEXT pointer  ' } }]
});
assert.equal(normalizedDuplicatePointer.selectedNext, null);
assert.match(normalizedDuplicatePointer.pointerError, /unique/i);

const wrongIdentityPointer = projectBenchmarkRegistry([records[0]], {
  pointerIssue: { ...pointer(), key: 'BEN-99' },
  pointerMatches: [pointer()]
});
assert.equal(wrongIdentityPointer.selectedNext, null);
assert.match(wrongIdentityPointer.pointerError, /identity/i);

const contaminatedPointer = projectBenchmarkRegistry([records[0]], {
  pointerIssue: pointer('BEN-17', '2026-08-27T12:01:00.000Z', ['candidate-evaluation']),
  pointerMatches: [pointer()]
});
assert.equal(contaminatedPointer.selectedNext, null);
assert.match(contaminatedPointer.pointerError, /must not carry registry labels/i);

const wrongTypePointer = projectBenchmarkRegistry([records[0]], {
  pointerIssue: pointer('BEN-17', '2026-08-27T12:01:00.000Z', [], { name: 'Task', subtask: false }),
  pointerMatches: [pointer()]
});
assert.equal(wrongTypePointer.selectedNext, null);
assert.match(wrongTypePointer.pointerError, /permanent Subtask pointer/i);

const missingParentPointer = projectBenchmarkRegistry([records[0]], {
  pointerIssue: { ...pointer(), fields: { ...pointer().fields, parent: null } },
  pointerMatches: [pointer()]
});
assert.equal(missingParentPointer.selectedNext, null);
assert.match(missingParentPointer.pointerError, /Parent is missing/i);

const ideaPointer = projectBenchmarkRegistry([records[0], records[6]], {
  pointerIssue: pointer('BEN-13'),
  pointerMatches: [pointer('BEN-13')]
});
assert.equal(ideaPointer.selectedNext, null);
assert.match(ideaPointer.pointerError, /eligible/i);

const blockedPointer = projectBenchmarkRegistry([records[1]], {
  pointerIssue: pointer('BEN-40'),
  pointerMatches: [pointer('BEN-40')]
});
assert.equal(blockedPointer.selectedNext, null);
assert.match(blockedPointer.pointerError, /Preparing/i);

const runningPointer = projectBenchmarkRegistry([records[2]], {
  pointerIssue: pointer('BEN-41'),
  pointerMatches: [pointer('BEN-41')]
});
assert.equal(runningPointer.selectedNext, null);
assert.match(runningPointer.pointerError, /Preparing/i);

const exactSource = projectBenchmarkRegistry([
  issue('BEN-70', ['benchmark-testing'], 'done', { links: [relates('RUN-5')] })
], { pointerIssue: null, pointerMatches: [] });
assert.equal(exactSource.runs[0]?.sourceKey, 'RUN-5');
assert.equal(exactSource.runs[0]?.source, 'RUN-5');

const sameProjectRelates = projectBenchmarkRegistry([
  issue('BEN-71', ['benchmark-testing'], 'done', { links: [relates('BEN-999')] })
], { pointerIssue: null, pointerMatches: [] });
assert.equal(sameProjectRelates.runs[0]?.sourceKey, '');
assert.equal(sameProjectRelates.runs[0]?.source, 'Unknown');

const nonArray = projectBenchmarkRegistry(null);
assert.equal(nonArray.state, 'unavailable');
assert.equal(nonArray.authority, 'jira-native');
assert.equal(nonArray.sourceKey, 'BEN');

console.log('benchmark Jira-native registry contract tests passed');
