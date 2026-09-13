import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { completedRunsForDisplay, resultLinesForDisplay, createPersistedDetails } = require('../dashboard/benchmark-review.js');

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
