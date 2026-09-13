import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { completedRunsForDisplay, resultLinesForDisplay } = require('../dashboard/benchmark-review.js');
const presentationSource = readFileSync(new URL('../dashboard/benchmark-review.js', import.meta.url), 'utf8');

const nextRenderIndex = presentationSource.indexOf("appendRunGroup(columns, 'Next', nextRuns)");
const rightColumnIndex = presentationSource.indexOf("const rightColumn = create('div', 'benchmark-column-stack')");
const blockedRenderIndex = presentationSource.indexOf("appendRunGroup(rightColumn, 'Blocked', blockedRuns)");
const completedRenderIndex = presentationSource.indexOf("appendRunGroup(rightColumn, 'Completed', completedRuns.runs");
const rightColumnAppendIndex = presentationSource.indexOf('columns.appendChild(rightColumn)');
const rightColumnStyleIndex = presentationSource.indexOf('.benchmark-column-stack { min-width: 0; display: grid; gap: 10px; align-content: start; }');
assert.ok(nextRenderIndex >= 0, 'Benchmark Review must render the Next group when next runs exist.');
assert.ok(rightColumnIndex >= 0, 'Benchmark Review must create a dedicated right-column stack.');
assert.ok(blockedRenderIndex >= 0, 'Benchmark Review must render a Blocked group when blocked runs exist.');
assert.ok(completedRenderIndex >= 0, 'Benchmark Review must render the Completed group.');
assert.ok(rightColumnAppendIndex >= 0, 'Benchmark Review must append the right-column stack to the two-column layout.');
assert.ok(rightColumnStyleIndex >= 0, 'Benchmark Review right-column stack must use a vertical grid layout.');
assert.ok(nextRenderIndex < rightColumnIndex, 'Next benchmarks must remain in the left column before the right-column stack.');
assert.ok(rightColumnIndex < blockedRenderIndex, 'Blocked benchmarks must render inside the right-column stack.');
assert.ok(blockedRenderIndex < completedRenderIndex, 'Blocked benchmarks must render before Completed benchmarks in the right column.');
assert.ok(completedRenderIndex < rightColumnAppendIndex, 'The completed right-column stack must be assembled before it is appended to the layout.');

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

console.log('Benchmark Review completed presentation tests passed.');
