import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  orderedNextRuns,
  orderedOnDeckRuns,
  completedRunsForDisplay,
  resultLinesForDisplay,
  createPersistedDetails
} = require('../dashboard/benchmark-review.js');
const presentationSource = readFileSync(new URL('../dashboard/benchmark-review.js', import.meta.url), 'utf8');

const leftColumnIndex = presentationSource.indexOf("const leftColumn = create('div', 'benchmark-column-stack')");
const nextRenderIndex = presentationSource.indexOf("appendRunGroup(leftColumn, 'Next', nextRuns)");
const onDeckRenderIndex = presentationSource.indexOf("appendRunGroup(leftColumn, 'On Deck', onDeckRuns)");
const rightColumnIndex = presentationSource.indexOf("const rightColumn = create('div', 'benchmark-column-stack')");
const blockedRenderIndex = presentationSource.indexOf("appendRunGroup(rightColumn, 'Blocked', blockedRuns)");
const completedRenderIndex = presentationSource.indexOf("appendRunGroup(rightColumn, 'Completed', completedRuns.runs");
const rightColumnAppendIndex = presentationSource.indexOf('columns.appendChild(rightColumn)');
const rightColumnStyleIndex = presentationSource.indexOf('.benchmark-column-stack { min-width: 0; display: grid; gap: 10px; align-content: start; }');
assert.ok(leftColumnIndex >= 0, 'Benchmark Review must create a dedicated left-column stack.');
assert.ok(nextRenderIndex >= 0, 'Benchmark Review must render the selected Next item in the left column.');
assert.ok(onDeckRenderIndex >= 0, 'Benchmark Review must render remaining Preparing items as On Deck.');
assert.ok(rightColumnIndex >= 0, 'Benchmark Review must create a dedicated right-column stack.');
assert.ok(blockedRenderIndex >= 0, 'Benchmark Review must render a Blocked group when blocked runs exist.');
assert.ok(completedRenderIndex >= 0, 'Benchmark Review must render the Completed group.');
assert.ok(rightColumnAppendIndex >= 0, 'Benchmark Review must append the right-column stack to the two-column layout.');
assert.ok(rightColumnStyleIndex >= 0, 'Benchmark Review column stacks must use a vertical grid layout.');
assert.ok(leftColumnIndex < nextRenderIndex, 'The left column must exist before the Next group is rendered.');
assert.ok(nextRenderIndex < onDeckRenderIndex, 'Next must render before On Deck in the left column.');
assert.ok(onDeckRenderIndex < rightColumnIndex, 'On Deck must remain in the left column before the right-column stack.');
assert.ok(rightColumnIndex < blockedRenderIndex, 'Blocked benchmarks must render inside the right-column stack.');
assert.ok(blockedRenderIndex < completedRenderIndex, 'Blocked benchmarks must render before Completed benchmarks in the right column.');
assert.ok(completedRenderIndex < rightColumnAppendIndex, 'The completed right-column stack must be assembled before it is appended to the layout.');

const queueRegistry = {
  selectedNext: { key: 'BEN-64', status: 'Preparing' },
  pointerError: '',
  runs: [
    { key: 'BEN-52', status: 'Preparing' },
    { key: 'BEN-53', status: 'Preparing' },
    { key: 'BEN-62', status: 'Running' },
    { key: 'BEN-64', status: 'Preparing' }
  ]
};
assert.deepEqual(
  orderedNextRuns(queueRegistry).map(run => run.key),
  ['BEN-64'],
  'Next must contain only the BEN-21 selected target.'
);
assert.deepEqual(
  orderedOnDeckRuns(queueRegistry).map(run => run.key),
  ['BEN-52', 'BEN-53'],
  'Preparing items that are not selected by BEN-21 must be On Deck.'
);

const runningPointerRegistry = {
  selectedNext: { key: 'BEN-62', status: 'Running' },
  pointerError: '',
  runs: queueRegistry.runs
};
assert.deepEqual(
  orderedNextRuns(runningPointerRegistry).map(run => run.key),
  ['BEN-62'],
  'The BEN-21 target remains the single Next item even when its lifecycle is Running.'
);
assert.deepEqual(
  orderedOnDeckRuns(runningPointerRegistry).map(run => run.key),
  ['BEN-52', 'BEN-53', 'BEN-64'],
  'All non-selected Preparing items remain On Deck when BEN-21 points to Running work.'
);

const registry = {
  runs: [
    { key: 'BEN-5', status: 'Completed' },
    { key: 'BEN-50', status: 'Completed' },
    { key: 'BEN-11', status: 'Completed' },
    { key: 'BEN-39', status: 'Completed' },
    { key: 'BEN-20', status: 'Completed' },
    { key: 'BEN-14', status: 'Completed' },
    { key: 'BEN-7', status: 'Completed' },
    { key: 'BEN-99', status: 'Running' }
  ]
};

const completed = completedRunsForDisplay(registry);
assert.equal(completed.total, 7, 'Completed heading count must retain the full completed total.');
assert.deepEqual(
  completed.runs.map(run => run.key),
  ['BEN-50', 'BEN-39', 'BEN-20', 'BEN-14', 'BEN-11', 'BEN-7'],
  'Completed display must preserve existing newest-BEN-key-first ordering before applying the six-item limit.'
);

const resultLines = [
  'Outcome: Response B won.',
  'Scores: RA 8 / RB 9.',
  'Signal: Better grounding.'
];
assert.deepEqual(
  resultLinesForDisplay({ resultLines }, true),
  ['Outcome: Response B won.'],
  'Compact Completed presentation must retain only the first existing result line.'
);
assert.deepEqual(
  resultLinesForDisplay({ resultLines }, false),
  resultLines,
  'Non-compact presentation must retain all existing result lines.'
);
assert.deepEqual(resultLinesForDisplay({ resultLines: null }, true), [], 'Missing result lines must remain missing.');
assert.deepEqual(resultLines, [
  'Outcome: Response B won.',
  'Scores: RA 8 / RB 9.',
  'Signal: Better grounding.'
], 'Presentation projection must not mutate registry result data.');

const originalDocument = globalThis.document;
try {
  globalThis.document = {
    createElement(tagName) {
      const listeners = new Map();
      return {
        tagName,
        className: '',
        open: false,
        addEventListener(type, listener) { listeners.set(type, listener); },
        dispatch(type) { listeners.get(type)?.(); }
      };
    }
  };

  const firstIdeaBacklog = createPersistedDetails('benchmark-ideas', 'ideas');
  assert.equal(firstIdeaBacklog.open, false, 'Idea backlog starts collapsed.');
  firstIdeaBacklog.open = true;
  firstIdeaBacklog.dispatch('toggle');

  const refreshedIdeaBacklog = createPersistedDetails('benchmark-ideas', 'ideas');
  assert.equal(refreshedIdeaBacklog.open, true, 'Idea backlog stays open when the Benchmark Review DOM is recreated during refresh.');
  refreshedIdeaBacklog.open = false;
  refreshedIdeaBacklog.dispatch('toggle');

  const nextIdeaBacklog = createPersistedDetails('benchmark-ideas', 'ideas');
  assert.equal(nextIdeaBacklog.open, false, 'Closing the idea backlog is also preserved across refresh.');
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}

console.log('Benchmark Review completed presentation tests passed.');
