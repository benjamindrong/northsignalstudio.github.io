(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardRefreshHealth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, root => {
  'use strict';

  const STALE_AFTER_MS = 30 * 60 * 1000;
  let pendingBenchmarkRegistry = null;
  let latestJiraPayload = null;
  let latestGithubPayload = null;

  function loadBenchmarkReview() {
    if (!root || typeof document === 'undefined') return;
    if (root.DashboardBenchmarkReview) return;
    if (document.getElementById('benchmark-review-script')) return;

    const script = document.createElement('script');
    script.id = 'benchmark-review-script';
    script.src = './benchmark-review.js';
    script.addEventListener('load', () => {
      if (pendingBenchmarkRegistry) {
        root.DashboardBenchmarkReview?.render(pendingBenchmarkRegistry);
        pendingBenchmarkRegistry = null;
      }
    });
    document.head.appendChild(script);
  }

  function renderBenchmarkReview(registry) {
    if (!root || typeof document === 'undefined') return;
    if (root.DashboardBenchmarkReview?.render) {
      root.DashboardBenchmarkReview.render(registry);
      return;
    }
    pendingBenchmarkRegistry = registry;
    loadBenchmarkReview();
  }

  function lockBenchmarkReview() {
    if (!root || typeof document === 'undefined') return;
    pendingBenchmarkRegistry = null;
    if (root.DashboardBenchmarkReview?.locked) root.DashboardBenchmarkReview.locked();
    else loadBenchmarkReview();
  }

  function loadGithubActivity() {
    if (!root || typeof document === 'undefined') return;
    if (root.DashboardGithubActivity) return;
    if (document.getElementById('github-activity-script')) return;

    const script = document.createElement('script');
    script.id = 'github-activity-script';
    script.src = './github-activity.js';
    script.addEventListener('load', () => {
      root.DashboardGithubActivity?.render(latestJiraPayload, latestGithubPayload);
    });
    document.head.appendChild(script);
  }

  function renderGithubActivity() {
    if (!root || typeof document === 'undefined' || !latestGithubPayload) return;
    if (root.DashboardGithubActivity?.render) {
      queueMicrotask(() => root.DashboardGithubActivity?.render(latestJiraPayload, latestGithubPayload));
      return;
    }
    loadGithubActivity();
  }

  function lockGithubActivity() {
    latestJiraPayload = null;
    latestGithubPayload = null;
    if (!root || typeof document === 'undefined') return;
    root.DashboardGithubActivity?.locked?.();
  }

  function emptySourceState() {
    lockBenchmarkReview();
    lockGithubActivity();
    return { lastSuccessAt: 0, lastFailureAt: 0, generatedAt: 0, error: '' };
  }

  function generatedAtTimestamp(payload) {
    const timestamp = Date.parse(payload?.generatedAt || '');
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function markSourceSuccess(state, payload, now = Date.now()) {
    if (Array.isArray(payload?.issues)) {
      latestJiraPayload = payload;
      renderBenchmarkReview(payload.benchmarkReview || {
        state: 'unavailable',
        sourceKey: 'BEN-8',
        message: 'Benchmark registry is unavailable in the current Jira snapshot.'
      });
      renderGithubActivity();
    }
    if (Array.isArray(payload?.pullRequests)) {
      latestGithubPayload = payload;
      renderGithubActivity();
    }
    return {
      ...state,
      lastSuccessAt: now,
      generatedAt: generatedAtTimestamp(payload),
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
    if (!state.generatedAt || now - state.generatedAt > STALE_AFTER_MS) return 'stale';
    return 'current';
  }

  function overallState(sources) {
    const values = Object.values(sources);
    if (values.includes('failed')) return 'failed';
    if (values.some(value => value === 'stale' || value === 'waiting')) return 'stale';
    return 'current';
  }

  loadBenchmarkReview();
  return { STALE_AFTER_MS, emptySourceState, markSourceSuccess, markSourceFailure, sourceState, overallState };
});
