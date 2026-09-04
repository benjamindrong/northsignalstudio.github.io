(function (root, factory) {
  const workItems = typeof module === 'object' && module.exports
    ? require('./work-items.js')
    : root?.DashboardWorkItems;
  const api = factory(root, workItems);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardWorkRelationships = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root, WorkItems) => {
  'use strict';

  const JIRA_KEY_PATTERN = /\b[A-Z][A-Z0-9_]*-[1-9][0-9]*\b/g;

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
    if (!WorkItems?.pullIdentity) return { jiraRelations: [], githubRelations: [] };
    const jiraIssues = Array.isArray(jiraPayload?.issues) ? jiraPayload.issues : [];
    const pullRequests = Array.isArray(githubPayload?.pullRequests) ? githubPayload.pullRequests : [];

    const uniqueJiraByKey = new Map();
    for (const [key, matches] of groupBy(jiraIssues, issue => String(issue?.key || '')).entries()) {
      if (matches.length === 1 && matches[0]?.url) uniqueJiraByKey.set(key, matches[0]);
    }

    const uniquePulls = [];
    for (const [identity, matches] of groupBy(pullRequests, WorkItems.pullIdentity).entries()) {
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

  function compactCounterpartLabel(identity) {
    const value = String(identity || '');
    return value.startsWith('PR #') ? `↔ #${value.slice(4)}` : `↔ ${value}`;
  }

  function externalLink(url) {
    const link = document.createElement('a');
    link.className = 'work-counterpart-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function sameDestination(link, url) {
    if (!link) return false;
    return String(link.getAttribute('href') || '') === String(url || '');
  }

  function clearRow(row) {
    if (!row) return;
    row.classList.remove('work-linked-row');
    const slot = row.querySelector('[data-work-counterpart-slot]');
    slot?.querySelectorAll('.work-counterpart-link').forEach(link => link.remove());
    const baseAria = row.dataset.workBaseAriaLabel || '';
    if (baseAria) row.setAttribute('aria-label', baseAria);
    else row.removeAttribute('aria-label');
  }

  function decorateRow(row, relation) {
    if (!row || !relation) return;
    const primary = row.querySelector('.work-primary-link');
    const slot = row.querySelector('[data-work-counterpart-slot]');
    if (!primary || !slot) return;

    row.classList.add('work-linked-row');
    row.setAttribute('role', 'group');
    const baseAria = row.dataset.workBaseAriaLabel || relation.primaryIdentity;
    row.setAttribute('aria-label', `${baseAria}; linked to ${relation.counterpartIdentity}`);
    primary.setAttribute('aria-label', `Open ${relation.primaryIdentity}`);

    let counterpart = slot.querySelector('.work-counterpart-link');
    if (counterpart && !sameDestination(counterpart, relation.counterpartUrl)) {
      counterpart.remove();
      counterpart = null;
    }
    if (!counterpart) {
      counterpart = externalLink(relation.counterpartUrl);
      slot.appendChild(counterpart);
    }
    counterpart.textContent = compactCounterpartLabel(relation.counterpartIdentity);
    counterpart.title = `Open ${relation.counterpartIdentity}`;
    counterpart.setAttribute('aria-label', `Open ${relation.counterpartIdentity}`);
  }

  function relationMaps(resolved) {
    const jiraByUrl = new Map(resolved.jiraRelations.map(relation => [relation.primaryUrl, relation]));
    const githubByUrl = new Map(resolved.githubRelations.map(relation => [relation.primaryUrl, relation]));
    return { jiraByUrl, githubByUrl };
  }

  function relationForRow(row, maps) {
    const url = String(row?.dataset?.workPrimaryUrl || '');
    if (!url) return null;
    if (row.dataset.workKind === 'jira') return maps.jiraByUrl.get(url) || null;
    if (row.dataset.workKind === 'github') return maps.githubByUrl.get(url) || null;
    return maps.jiraByUrl.get(url) || maps.githubByUrl.get(url) || null;
  }

  function render(jiraPayload, githubPayload) {
    const resolved = resolve(jiraPayload, githubPayload);
    if (!root || typeof document === 'undefined' || !WorkItems?.pullIdentity) return resolved;
    const maps = relationMaps(resolved);
    for (const row of [...document.querySelectorAll('[data-work-primary-url][data-work-kind]')]) {
      const relation = relationForRow(row, maps);
      if (relation) decorateRow(row, relation);
      else clearRow(row);
    }
    return resolved;
  }

  function clear() {
    if (!root || typeof document === 'undefined') return;
    for (const row of [...document.querySelectorAll('[data-work-primary-url][data-work-kind]')]) clearRow(row);
  }

  return {
    JIRA_KEY_PATTERN,
    distinctTitleKeys,
    resolve,
    compactCounterpartLabel,
    render,
    clear,
    decorateRow,
    clearRow
  };
});
