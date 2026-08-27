(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardWorkRelationships = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, root => {
  'use strict';

  const JIRA_KEY_PATTERN = /\b[A-Z][A-Z0-9_]*-[1-9][0-9]*\b/g;
  const STYLE_ID = 'dashboard-work-relationships-style';

  function pullIdentity(pull) {
    const repository = String(pull?.repository || '');
    const number = Number(pull?.number);
    if (!repository || !Number.isInteger(number) || number <= 0) return '';
    return `${repository}#${number}`;
  }

  function distinctTitleKeys(title) {
    return [...new Set(String(title || '').match(JIRA_KEY_PATTERN) || [])];
  }

  function groupBy(items, keyForItem) {
    const groups = new Map();
    for (const item of items) {
      const key = keyForItem(item);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return groups;
  }

  function resolve(jiraPayload, githubPayload) {
    const jiraIssues = Array.isArray(jiraPayload?.issues) ? jiraPayload.issues : [];
    const pullRequests = Array.isArray(githubPayload?.pullRequests) ? githubPayload.pullRequests : [];

    const uniqueJiraByKey = new Map();
    for (const [key, matches] of groupBy(jiraIssues, issue => String(issue?.key || '')).entries()) {
      if (matches.length === 1 && matches[0]?.url) uniqueJiraByKey.set(key, matches[0]);
    }

    const uniquePulls = [];
    for (const [identity, matches] of groupBy(pullRequests, pullIdentity).entries()) {
      if (matches.length === 1) uniquePulls.push({ pull: matches[0], identity });
    }

    const uniqueMatches = [];
    for (const { pull, identity } of uniquePulls) {
      const keys = distinctTitleKeys(pull?.title);
      if (keys.length !== 1) continue;
      const jira = uniqueJiraByKey.get(keys[0]);
      if (!jira || !pull?.url) continue;
      uniqueMatches.push({ jira, pull, identity });
    }

    const githubRelations = uniqueMatches.map(match => ({
      primaryUrl: String(match.pull.url),
      primaryIdentity: `${String(match.pull.repository || '').split('/').pop() || 'Repository'} #${match.pull.number}`,
      counterpartUrl: String(match.jira.url),
      counterpartIdentity: String(match.jira.key),
    }));

    const jiraRelations = [];
    for (const matches of groupBy(uniqueMatches, match => String(match.jira.key)).values()) {
      if (matches.length !== 1) continue;
      const match = matches[0];
      jiraRelations.push({
        primaryUrl: String(match.jira.url),
        primaryIdentity: String(match.jira.key),
        counterpartUrl: String(match.pull.url),
        counterpartIdentity: `PR #${match.pull.number}`,
      });
    }

    return { jiraRelations, githubRelations };
  }

  function ensureStyle() {
    if (!root || typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .work-primary-link {
        display: block;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: inherit;
        text-decoration: none;
      }
      .work-primary-link:hover,
      .work-primary-link:focus-visible,
      .work-counterpart-link:hover,
      .work-counterpart-link:focus-visible {
        text-decoration: underline;
        outline: none;
      }
      .flight-summary.work-linked-cell,
      .github-pr-repo.work-linked-cell,
      .recent-title.work-linked-cell {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        overflow: hidden;
      }
      .work-linked-cell > .work-primary-link { flex: 1 1 auto; }
      .work-counterpart-link {
        flex: 0 0 auto;
        max-width: 44%;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--accent);
        text-decoration: none;
        font-size: .82em;
        font-weight: 950;
      }
      .github-pr-repo .work-counterpart-link { color: var(--review); }
      @media (max-width: 470px) {
        .work-counterpart-link { max-width: 40%; font-size: .74em; }
      }
    `;
    document.head.appendChild(style);
  }

  function restoreRows() {
    if (typeof document === 'undefined') return;
    for (const row of document.querySelectorAll('[data-work-primary-url]')) {
      for (const link of [...row.querySelectorAll('.work-primary-link')]) {
        const fragment = document.createDocumentFragment();
        while (link.firstChild) fragment.appendChild(link.firstChild);
        link.replaceWith(fragment);
      }
      row.querySelectorAll('.work-counterpart-link').forEach(link => link.remove());
      row.querySelectorAll('.work-linked-cell').forEach(cell => cell.classList.remove('work-linked-cell'));

      const anchor = document.createElement('a');
      anchor.className = row.className;
      anchor.href = row.dataset.workPrimaryUrl || '';
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      if (row.dataset.workOriginalAriaLabel) anchor.setAttribute('aria-label', row.dataset.workOriginalAriaLabel);
      while (row.firstChild) anchor.appendChild(row.firstChild);
      row.replaceWith(anchor);
    }
  }

  function externalLink(url, className, ariaLabel) {
    const link = document.createElement('a');
    link.className = className;
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (ariaLabel) link.setAttribute('aria-label', ariaLabel);
    return link;
  }

  function wrapContents(cell, url, ariaLabel) {
    if (!cell) return;
    const link = externalLink(url, 'work-primary-link', ariaLabel);
    while (cell.firstChild) link.appendChild(cell.firstChild);
    cell.appendChild(link);
  }

  function compactCounterpartLabel(identity) {
    const value = String(identity || '');
    return value.startsWith('PR #') ? `↔ #${value.slice(4)}` : `↔ ${value}`;
  }

  function appendCounterpart(cell, relation) {
    if (!cell) return;
    cell.classList.add('work-linked-cell');
    const link = externalLink(
      relation.counterpartUrl,
      'work-counterpart-link',
      `Open ${relation.counterpartIdentity}`,
    );
    link.textContent = compactCounterpartLabel(relation.counterpartIdentity);
    link.title = `Open ${relation.counterpartIdentity}`;
    cell.appendChild(link);
  }

  function wrapPrimaryCells(container, selectors, relation) {
    for (const selector of selectors) {
      wrapContents(container.querySelector(selector), relation.primaryUrl, `Open ${relation.primaryIdentity}`);
    }
  }

  function convertRow(row, relation, kind) {
    if (!row || row.tagName !== 'A') return;
    const container = document.createElement('div');
    container.className = row.className;
    container.dataset.workPrimaryUrl = relation.primaryUrl;
    container.dataset.workOriginalAriaLabel = row.getAttribute('aria-label') || '';
    container.setAttribute('role', 'group');
    container.setAttribute(
      'aria-label',
      `${row.getAttribute('aria-label') || relation.primaryIdentity}; linked to ${relation.counterpartIdentity}`,
    );
    while (row.firstChild) container.appendChild(row.firstChild);
    row.replaceWith(container);

    if (kind === 'jira') {
      wrapPrimaryCells(container, ['.flight-key', '.flight-summary', '.flight-move', '.flight-status'], relation);
      appendCounterpart(container.querySelector('.flight-summary'), relation);
      return;
    }

    if (kind === 'github') {
      wrapPrimaryCells(container, ['.github-pr-repo', '.github-pr-title', '.github-pr-updated', '.github-pr-state'], relation);
      appendCounterpart(container.querySelector('.github-pr-repo'), relation);
      return;
    }

    wrapPrimaryCells(container, ['.recent-identity', '.recent-title', '.recent-updated'], relation);
    appendCounterpart(container.querySelector('.recent-title'), relation);
  }

  function relationForRow(row, relationsByUrl) {
    const href = row.getAttribute('href') || '';
    return relationsByUrl.get(href) || relationsByUrl.get(row.href) || null;
  }

  function render(jiraPayload, githubPayload) {
    if (!root || typeof document === 'undefined') return resolve(jiraPayload, githubPayload);
    restoreRows();
    ensureStyle();

    const resolved = resolve(jiraPayload, githubPayload);
    const jiraByUrl = new Map(resolved.jiraRelations.map(relation => [relation.primaryUrl, relation]));
    const githubByUrl = new Map(resolved.githubRelations.map(relation => [relation.primaryUrl, relation]));

    for (const row of [...document.querySelectorAll('.flight-row[href]')]) {
      const relation = relationForRow(row, jiraByUrl);
      if (relation) convertRow(row, relation, 'jira');
    }
    for (const row of [...document.querySelectorAll('.github-pr-row[href]')]) {
      const relation = relationForRow(row, githubByUrl);
      if (relation) convertRow(row, relation, 'github');
    }
    for (const row of [...document.querySelectorAll('.recent-row[href]')]) {
      const relation = relationForRow(row, jiraByUrl) || relationForRow(row, githubByUrl);
      if (relation) convertRow(row, relation, 'recent');
    }

    return resolved;
  }

  function clear() {
    if (!root || typeof document === 'undefined') return;
    restoreRows();
  }

  return { JIRA_KEY_PATTERN, pullIdentity, distinctTitleKeys, resolve, compactCounterpartLabel, render, clear };
});
