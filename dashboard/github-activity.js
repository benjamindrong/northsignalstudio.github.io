(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardGithubActivity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, root => {
  'use strict';

  const RECENT_ACTIVITY_LIMIT = 12;

  function recentTimestamp(value) {
    const timestamp = Date.parse(value || '');
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function recentActivityCompare(a, b) {
    return recentTimestamp(b.updatedAt) - recentTimestamp(a.updatedAt)
      || a.source.localeCompare(b.source)
      || a.identity.localeCompare(b.identity);
  }

  function recentActivityItems(jiraPayloadValue, githubPayloadValue, limit = RECENT_ACTIVITY_LIMIT) {
    const jiraItems = (jiraPayloadValue?.issues || []).map(issue => ({
      source: 'JIRA',
      identity: issue.key || 'Issue',
      title: issue.summary || 'Untitled issue',
      updatedAt: issue.updatedAt || issue.lastMove || '',
      url: issue.url || '',
      draft: false
    }));
    const githubItems = (githubPayloadValue?.pullRequests || []).map(pull => {
      const repository = String(pull.repository || 'Repository').split('/').pop() || 'Repository';
      return {
        source: 'GITHUB',
        identity: `${repository} #${pull.number}`,
        title: pull.title || 'Untitled pull request',
        updatedAt: pull.updatedAt || '',
        url: pull.url || '',
        draft: String(pull.state || '').toUpperCase() === 'DRAFT'
      };
    });
    const ordered = [...jiraItems, ...githubItems]
      .filter(item => item.url && recentTimestamp(item.updatedAt) > 0)
      .sort(recentActivityCompare);
    const selected = ordered.slice(0, limit);
    const availableSources = new Set(ordered.map(item => item.source));

    if (availableSources.size > 1 && selected.length === limit) {
      for (const source of availableSources) {
        if (selected.some(item => item.source === source)) continue;
        const representative = ordered.find(item => item.source === source);
        if (representative) selected[selected.length - 1] = representative;
      }
      selected.sort(recentActivityCompare);
    }
    return selected;
  }

  function configuredRepositoryLabels(githubPayloadValue) {
    return [...new Set((githubPayloadValue?.repositories || []).filter(Boolean))]
      .map(repository => String(repository).split('/').pop() || String(repository));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const day = new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(date);
    const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    return `${day} ${month} ${time}`;
  }

  function renderConfiguredRepositories(githubPayloadValue) {
    if (!root || typeof document === 'undefined') return;
    const source = document.getElementById('githubSource');
    if (!source) return;
    const labels = configuredRepositoryLabels(githubPayloadValue);
    if (!labels.length) return;
    const generatedAt = githubPayloadValue?.generatedAt;
    const generated = recentTimestamp(generatedAt) ? `data updated ${formatDateTime(generatedAt)}` : 'live feed';
    source.textContent = `GitHub · ${generated} · Watching ${labels.join(' · ')}`;
    source.title = (githubPayloadValue?.repositories || []).join('\n');
    source.style.whiteSpace = 'normal';
    source.style.overflow = 'visible';
    source.style.textOverflow = 'clip';
    source.style.lineHeight = '1.35';
  }

  function appendRecentRow(rows, item) {
    const row = document.createElement('a');
    row.className = 'recent-row';
    row.href = item.url;
    row.target = '_blank';
    row.rel = 'noopener noreferrer';
    const draftLabel = item.draft ? ' DRAFT' : '';
    row.setAttribute('aria-label', `${item.source}${draftLabel} ${item.identity}: ${item.title}; updated ${formatDateTime(item.updatedAt)}`);

    const identity = document.createElement('div');
    identity.className = 'recent-identity';
    const badge = document.createElement('span');
    badge.className = `recent-source-badge ${item.source.toLowerCase()}`;
    badge.textContent = item.source;
    identity.appendChild(badge);
    identity.append(document.createTextNode(` ${item.identity}${item.draft ? ' · DRAFT' : ''}`));
    identity.title = `${item.source}${item.draft ? ' · DRAFT' : ''} · ${item.identity}`;
    row.appendChild(identity);

    const title = document.createElement('div');
    title.className = 'recent-title';
    title.textContent = item.title;
    title.title = item.title;
    row.appendChild(title);

    const updated = document.createElement('div');
    updated.className = 'recent-updated';
    updated.textContent = formatDateTime(item.updatedAt);
    updated.title = item.updatedAt;
    row.appendChild(updated);
    rows.appendChild(row);
  }

  function renderRecentWithDrafts(jiraPayloadValue, githubPayloadValue) {
    if (!root || typeof document === 'undefined' || !jiraPayloadValue) return;
    const hasDrafts = (githubPayloadValue?.pullRequests || []).some(pull => String(pull.state || '').toUpperCase() === 'DRAFT');
    if (!hasDrafts) return;
    const rows = document.getElementById('recentRows');
    if (!rows) return;

    rows.replaceChildren();
    const items = recentActivityItems(jiraPayloadValue, githubPayloadValue);
    for (const item of items) appendRecentRow(rows, item);
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent = 'No recent Jira or GitHub activity is available.';
      rows.appendChild(empty);
    }
  }

  function render(jiraPayloadValue, githubPayloadValue) {
    if (!githubPayloadValue) return;
    renderConfiguredRepositories(githubPayloadValue);
    renderRecentWithDrafts(jiraPayloadValue, githubPayloadValue);
  }

  function locked() {
    if (!root || typeof document === 'undefined') return;
    const source = document.getElementById('githubSource');
    if (!source) return;
    source.style.whiteSpace = '';
    source.style.overflow = '';
    source.style.textOverflow = '';
    source.style.lineHeight = '';
  }

  return { RECENT_ACTIVITY_LIMIT, recentActivityItems, configuredRepositoryLabels, render, locked };
});
