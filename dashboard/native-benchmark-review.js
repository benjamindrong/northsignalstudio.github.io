(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardNativeBenchmarkReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SHA256 = /^[0-9a-f]{64}$/;
  const BEN = /^BEN-[1-9][0-9]*$/;
  const ISSUE = /^[A-Z][A-Z0-9]+-[1-9][0-9]*$/;
  const VALID_LIFECYCLES = new Set(['Unused', 'Preparing', 'Running', 'Blocked', 'Completed', 'Retired']);
  const ACTIVITY_KINDS = new Set(['candidate-evaluation', 'failure-evaluation', 'benchmark-testing', 'uiux-discovery']);
  const IDEA_CATEGORIES = new Set(['fresh', 'considered']);
  const MAX_AGE_MS = 30 * 60 * 1000;
  const MAX_FUTURE_MS = 2 * 60 * 1000;

  function requireValid(ok, message) {
    if (!ok) throw new Error('Invalid native Benchmark Review: ' + message);
  }

  function exactKeys(value, keys, label) {
    requireValid(value && typeof value === 'object' && !Array.isArray(value), label);
    requireValid(Object.keys(value).sort().join(',') === keys.slice().sort().join(','), label + ' fields');
  }

  function optionalString(value) {
    return value === null || (typeof value === 'string' && value.length > 0);
  }

  function epoch(value) {
    requireValid(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'completion time');
    const number = Number(value);
    requireValid(Number.isSafeInteger(number) && number >= 0, 'completion range');
    return new Date(number).toISOString();
  }

  function projectNativeReview(publication, { expectedProjectId, now = Date.now() } = {}) {
    exactKeys(publication,
      ['version', 'authority', 'generatedAt', 'nativeProjectionSha256', 'registry', 'records', 'completedOrder'],
      'publication');
    requireValid(publication.version === 1 && publication.authority === 'dashboard-native-benchmark-review', 'authority');
    requireValid(SHA256.test(publication.nativeProjectionSha256), 'projection digest');
    requireValid(typeof publication.generatedAt === 'string' &&
      publication.generatedAt === new Date(publication.generatedAt).toISOString(), 'generatedAt');
    requireValid(Number.isFinite(now), 'local clock');
    const sourceTime = Date.parse(publication.generatedAt);
    requireValid(now - sourceTime <= MAX_AGE_MS && sourceTime - now <= MAX_FUTURE_MS,
      'publication is stale or future-dated');
    exactKeys(publication.registry, ['projectId', 'selectedNextTicketId', 'selectedNextLegacyDisplayKey'], 'registry');
    requireValid(typeof expectedProjectId === 'string' && UUID.test(expectedProjectId), 'missing approved project binding');
    requireValid(publication.registry.projectId === expectedProjectId, 'registry project mismatch');
    requireValid(publication.registry.selectedNextTicketId === null ||
      UUID.test(publication.registry.selectedNextTicketId), 'selected-next identity');
    requireValid(publication.registry.selectedNextLegacyDisplayKey === null ||
      BEN.test(publication.registry.selectedNextLegacyDisplayKey), 'selected-next historical key');
    requireValid(Array.isArray(publication.records) && Array.isArray(publication.completedOrder), 'lists');

    const recordsById = new Map();
    const runs = [];
    const previous = [], fresh = [];
    const completedSet = new Set();
    for (const record of publication.records) {
      exactKeys(record, ['ticketId', 'summary', 'lifecycle', 'activityKind', 'ideaCategory',
        'legacyDisplayKey', 'legacySourceKey', 'sourceTicketId', 'result', 'notableFinding',
        'completedAtEpochMillis'], 'record');
      requireValid(UUID.test(record.ticketId) && !recordsById.has(record.ticketId), 'record identity');
      requireValid(typeof record.summary === 'string' && record.summary.trim().length > 0, 'summary');
      requireValid(VALID_LIFECYCLES.has(record.lifecycle), 'lifecycle');
      requireValid(record.activityKind === null || ACTIVITY_KINDS.has(record.activityKind), 'activity kind');
      requireValid(record.ideaCategory === null || IDEA_CATEGORIES.has(record.ideaCategory), 'idea category');
      requireValid(record.legacyDisplayKey === null || BEN.test(record.legacyDisplayKey), 'historical review reference');
      requireValid(record.legacySourceKey === null || (ISSUE.test(record.legacySourceKey) &&
        !BEN.test(record.legacySourceKey)), 'historical source reference');
      requireValid(record.sourceTicketId === null || UUID.test(record.sourceTicketId), 'native source identity');
      requireValid(!record.sourceTicketId || !record.legacySourceKey, 'ambiguous source provenance');
      requireValid(optionalString(record.notableFinding), 'finding');
      const unused = record.lifecycle === 'Unused';
      requireValid(unused ?
        (record.activityKind === null) !== (record.ideaCategory === null) :
        record.activityKind !== null && record.ideaCategory === null, 'review category/lifecycle');
      requireValid(record.lifecycle === 'Completed' ?
        record.completedAtEpochMillis !== null :
        record.completedAtEpochMillis === null && record.result === null && record.notableFinding === null,
        'result/completion lifecycle');
      requireValid(record.lifecycle === 'Completed' &&
        record.activityKind === 'candidate-evaluation' ? record.result !== null : record.result === null,
        'candidate result');
      let resultLines = [], resultState = 'none';
      if (record.result !== null) {
        if (record.result.kind === 'unknown') {
          exactKeys(record.result, ['kind'], 'unknown result');
          resultState = 'backfill';
        } else {
          exactKeys(record.result, ['kind', 'outcome', 'scores', 'signal'], 'summary result');
          requireValid(record.result.kind === 'summary' &&
            ['outcome', 'scores', 'signal'].every(k =>
              typeof record.result[k] === 'string' && record.result[k].length > 0), 'result summary');
          resultLines = ['Outcome: ' + record.result.outcome,
            'Scores: ' + record.result.scores, 'Signal: ' + record.result.signal];
          resultState = 'recorded';
        }
      }
      const run = {
        nativeTicketId: record.ticketId,
        legacyDisplayKey: record.legacyDisplayKey,
        key: record.legacyDisplayKey || 'Native ticket: ' + record.ticketId,
        title: record.summary,
        status: record.lifecycle,
        statusRaw: record.lifecycle,
        activityKind: record.activityKind,
        activityTaxonomyVersion: 2,
        source: record.legacySourceKey || (record.sourceTicketId ? 'Native ticket: ' + record.sourceTicketId : ''),
        resultState,
        resultLines,
        notableFinding: record.notableFinding || '',
        completedAt: record.completedAtEpochMillis === null ? '' : epoch(record.completedAtEpochMillis),
      };
      recordsById.set(record.ticketId, run);
      if (record.lifecycle === 'Completed') completedSet.add(record.ticketId);
      if (record.lifecycle === 'Unused' && record.ideaCategory === 'considered') previous.push(run);
      else if (record.lifecycle === 'Unused' && record.ideaCategory === 'fresh') fresh.push(run);
      else runs.push(run);
    }

    const selectedId = publication.registry.selectedNextTicketId;
    const selected = selectedId === null ? null : recordsById.get(selectedId);
    requireValid(selectedId === null || (selected && ['Preparing', 'Running', 'Blocked'].includes(selected.status)),
      'selected-next record');
    requireValid((selected?.legacyDisplayKey || null) === publication.registry.selectedNextLegacyDisplayKey,
      'selected-next historical reference');

    const ordered = new Set();
    const completedRuns = [];
    for (const ticketId of publication.completedOrder) {
      requireValid(typeof ticketId === 'string' && completedSet.has(ticketId) && !ordered.has(ticketId),
        'duplicate or unknown completed reference');
      ordered.add(ticketId);
      completedRuns.push(recordsById.get(ticketId));
    }
    requireValid(ordered.size === completedSet.size, 'incomplete completion order');
    const sorted = completedRuns.filter(run => run.completedAt);
    requireValid(sorted.every((run, index) =>
      index === 0 || Date.parse(sorted[index - 1].completedAt) >= Date.parse(run.completedAt)),
      'completion order disagrees with native timestamps');

    return {
      state: 'ready', authority: 'dashboard-native-benchmark-review',
      generatedAt: publication.generatedAt,
      sourceKey: 'Native', sourceLabel: 'Dashboard-native Benchmark Review',
      selectedNext: selected || null, pointerError: '',
      runs, completedOrder: completedRuns.map(run => run.key),
      previouslyConsidered: previous.map(run => ({key: run.key, title: run.title, detail: ''})),
      freshBacklog: fresh.length ? [{group: 'Fresh ideas', ideas: fresh.map(run => ({
        key: run.key, title: run.title, detail: '',
      }))}] : [],
      invalidRecords: [],
    };
  }

  return { projectNativeReview, MAX_AGE_MS, MAX_FUTURE_MS };
});
