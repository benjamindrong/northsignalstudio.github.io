(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardRefreshHealth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const STALE_AFTER_MS = 30 * 60 * 1000;

  function emptySourceState() {
    return { lastSuccessAt: 0, lastFailureAt: 0, refreshedAt: 0, error: '' };
  }

  function refreshedAtTimestamp(value) {
    const timestamp = Date.parse(value || '');
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function markSourceSuccess(state, refreshedAt, now = Date.now()) {
    return {
      ...state,
      lastSuccessAt: now,
      refreshedAt: refreshedAtTimestamp(refreshedAt),
      error: ''
    };
  }

  function markSourceFailure(state, failure, now = Date.now()) {
    return {
      ...state,
      lastFailureAt: now,
      error: failure instanceof Error ? failure.message : String(failure || 'Refresh failed')
    };
  }

  function sourceState(state, now = Date.now()) {
    if (state.error) return 'failed';
    if (!state.lastSuccessAt) return 'waiting';
    if (!state.refreshedAt || now - state.refreshedAt > STALE_AFTER_MS) return 'stale';
    return 'current';
  }

  function overallState(sources) {
    const values = Object.values(sources);
    if (values.includes('failed')) return 'failed';
    if (values.some(value => value === 'stale' || value === 'waiting')) return 'stale';
    return 'current';
  }

  return { STALE_AFTER_MS, emptySourceState, markSourceSuccess, markSourceFailure, sourceState, overallState };
});
