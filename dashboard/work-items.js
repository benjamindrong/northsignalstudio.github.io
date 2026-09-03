(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardWorkItems = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, root => {
  'use strict';

  const RECENT_ACTIVITY_LIMIT = 12;
  const WORK_NODE_ATTR = 'data-work-node-id';
  const STATUS_CLASSES = ['todo', 'progress', 'review', 'blocked', 'done', 'unknown'];

  function statusInfo(status) {
    const value = String(status || '').trim();
    const lower = value.toLowerCase();
    if (/block|imped/.test(lower)) return { className: 'blocked', rank: 0 };
    if (/review|approval/.test(lower)) return { className: 'review', rank: 1 };
    if (/in progress|progress|doing|active|started/.test(lower)) return { className: 'progress', rank: 2 };
    if (/to do|todo|backlog|ready|open|new/.test(lower)) return { className: 'todo', rank: 3 };
    if (/done|closed|complete|resolved|finished/.test(lower)) return { className: 'done', rank: 9 };
    return { className: 'unknown', rank: 4 };
  }

  function pullIdentity(pull) {
    const repository = String(pull?.repository || '').trim().toLowerCase();
    const number = Number(pull?.number);
    if (!repository || !Number.isInteger(number) || number <= 0) return '';
    return `${repository}#${number}`;
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

  function recentTimestamp(value) {
    const timestamp = Date.parse(value || '');
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function recentActivityCompare(a, b) {
    return recentTimestamp(b.updatedAt) - recentTimestamp(a.updatedAt)
      || a.source.localeCompare(b.source)
      || a.identity.localeCompare(b.identity);
  }

  function flightDescriptors(payload) {
    const activeByProject = new Map();
    const doneByProject = new Map();
    const projectNames = new Map();

    for (const issue of payload?.issues || []) {
      const key = issue.projectKey || 'OTHER';
      projectNames.set(key, issue.projectName || key);
      const target = issue.statusCategory === 'done' ? doneByProject : activeByProject;
      if (!target.has(key)) target.set(key, []);
      target.get(key).push(issue);
    }

    const discoveredKeys = [...new Set([...activeByProject.keys(), ...doneByProject.keys()])];
    const allKeys = [...new Set([...(payload?.projects || []), ...discoveredKeys])];
    const projectOrder = [...allKeys.filter(key => key !== 'LAN'), ...allKeys.filter(key => key === 'LAN')];
    const descriptors = [];

    for (const key of projectOrder) {
      const issues = [...(activeByProject.get(key) || [])];
      if (!issues.length) continue;
      descriptors.push({ type: 'header', id: `${key}:active`, label: projectNames.get(key) || key });
      issues
        .sort((a, b) => statusInfo(a.status).rank - statusInfo(b.status).rank
          || String(b.lastMove || '').localeCompare(String(a.lastMove || ''))
          || String(a.key || '').localeCompare(String(b.key || '')))
        .forEach(issue => descriptors.push({ type: 'row', kind: 'jira', id: String(issue.key || ''), item: issue }));
    }

    for (const key of projectOrder) {
      const issues = [...(doneByProject.get(key) || [])];
      if (!issues.length) continue;
      descriptors.push({ type: 'header', id: `${key}:recently-done`, label: `${projectNames.get(key) || key} · Recently Done` });
      issues
        .sort((a, b) => String(b.lastMove || '').localeCompare(String(a.lastMove || ''))
          || String(a.key || '').localeCompare(String(b.key || '')))
        .forEach(issue => descriptors.push({ type: 'row', kind: 'jira', id: String(issue.key || ''), item: issue }));
    }

    return descriptors.filter(descriptor => descriptor.type === 'header' || descriptor.id);
  }

  function githubDescriptors(payload) {
    return [...(payload?.pullRequests || [])]
      .filter(pull => String(pull?.state || '').toUpperCase() !== 'DRAFT')
      .filter(pull => pullIdentity(pull))
      .sort((a, b) => Number(a.attentionRank) - Number(b.attentionRank)
        || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
        || String(a.repository || '').localeCompare(String(b.repository || ''))
        || Number(a.number) - Number(b.number))
      .map(pull => ({ type: 'row', kind: 'github', id: pullIdentity(pull), item: pull }));
  }

  function recentActivityItems(jiraPayloadValue, githubPayloadValue, limit = RECENT_ACTIVITY_LIMIT) {
    const jiraItems = (jiraPayloadValue?.issues || [])
      .filter(issue => issue?.key)
      .map(issue => ({
        source: 'JIRA',
        stableId: `JIRA:${issue.key}`,
        identity: issue.key || 'Issue',
        title: issue.summary || 'Untitled issue',
        updatedAt: issue.updatedAt || issue.lastMove || '',
        url: issue.url || ''
      }));
    const githubItems = (githubPayloadValue?.pullRequests || [])
      .filter(pull => String(pull?.state || '').toUpperCase() !== 'DRAFT')
      .filter(pull => pullIdentity(pull))
      .map(pull => {
        const repository = String(pull.repository || 'Repository').split('/').pop() || 'Repository';
        return {
          source: 'GITHUB',
          stableId: `GITHUB:${pullIdentity(pull)}`,
          identity: `${repository} #${pull.number}`,
          title: pull.title || 'Untitled pull request',
          updatedAt: pull.updatedAt || '',
          url: pull.url || ''
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

  function recentDescriptors(jiraPayloadValue, githubPayloadValue) {
    return recentActivityItems(jiraPayloadValue, githubPayloadValue)
      .map(item => ({ type: 'row', kind: 'recent', id: item.stableId, item }));
  }

  function safeDomId(value) {
    return String(value || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  }

  function externalLink(className) {
    const link = document.createElement('a');
    link.className = className;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function createDisclosure(row, descriptor) {
    const disclosure = document.createElement('button');
    disclosure.type = 'button';
    disclosure.className = 'work-disclosure';
    disclosure.setAttribute('aria-expanded', 'false');
    disclosure.setAttribute('aria-label', `Toggle full details for ${descriptor.id}`);

    const details = document.createElement('div');
    details.className = 'work-details';
    details.dataset.workDetails = '';
    details.id = `work-details-${safeDomId(descriptor.kind)}-${safeDomId(descriptor.id)}`;
    details.hidden = true;
    disclosure.setAttribute('aria-controls', details.id);
    disclosure.textContent = '▸';
    disclosure.addEventListener('click', () => {
      const expanded = disclosure.getAttribute('aria-expanded') !== 'true';
      disclosure.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      disclosure.textContent = expanded ? '▾' : '▸';
      details.hidden = !expanded;
      row.dataset.workExpanded = expanded ? 'true' : 'false';
    });
    return { disclosure, details };
  }

  function createJiraRow(descriptor) {
    const row = document.createElement('div');
    row.className = 'flight-row';
    const primary = externalLink('work-primary-link flight-primary-link');
    const key = document.createElement('div'); key.className = 'flight-cell flight-key';
    const summary = document.createElement('div'); summary.className = 'flight-cell flight-summary';
    primary.append(key, summary);
    const counterpart = document.createElement('span'); counterpart.dataset.workCounterpartSlot = ''; counterpart.className = 'work-counterpart-slot';
    const move = document.createElement('div'); move.className = 'flight-cell flight-move';
    const status = document.createElement('div'); status.className = 'flight-cell flight-status unknown';
    const { disclosure, details } = createDisclosure(row, descriptor);
    row.append(primary, counterpart, move, status, disclosure, details);
    return row;
  }

  function createGithubRow(descriptor) {
    const row = document.createElement('div');
    row.className = 'github-pr-row';
    const primary = externalLink('work-primary-link github-primary-link');
    const repo = document.createElement('div'); repo.className = 'github-pr-repo';
    const repoName = document.createElement('span'); repoName.className = 'github-pr-repo-name';
    const number = document.createElement('span'); number.className = 'github-pr-number';
    repo.append(repoName, document.createTextNode(' '), number);
    const title = document.createElement('div'); title.className = 'github-pr-title';
    primary.append(repo, title);
    const counterpart = document.createElement('span'); counterpart.dataset.workCounterpartSlot = ''; counterpart.className = 'work-counterpart-slot';
    const updated = document.createElement('div'); updated.className = 'github-pr-updated';
    const state = document.createElement('div'); state.className = 'github-pr-state unknown';
    const { disclosure, details } = createDisclosure(row, descriptor);
    row.append(primary, counterpart, updated, state, disclosure, details);
    return row;
  }

  function createRecentRow(descriptor) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    const primary = externalLink('work-primary-link recent-primary-link');
    const identity = document.createElement('div'); identity.className = 'recent-identity';
    const badge = document.createElement('span'); badge.className = 'recent-source-badge';
    const identityText = document.createElement('span'); identityText.className = 'recent-identity-text';
    identity.append(badge, document.createTextNode(' '), identityText);
    const title = document.createElement('div'); title.className = 'recent-title';
    primary.append(identity, title);
    const counterpart = document.createElement('span'); counterpart.dataset.workCounterpartSlot = ''; counterpart.className = 'work-counterpart-slot';
    const updated = document.createElement('div'); updated.className = 'recent-updated';
    const { disclosure, details } = createDisclosure(row, descriptor);
    row.append(primary, counterpart, updated, disclosure, details);
    return row;
  }

  function createRow(descriptor) {
    if (descriptor.kind === 'jira') return createJiraRow(descriptor);
    if (descriptor.kind === 'github') return createGithubRow(descriptor);
    return createRecentRow(descriptor);
  }

  function createNode(descriptor) {
    if (descriptor.type === 'header') {
      const header = document.createElement('div');
      header.className = 'flight-project';
      header.dataset.workHeaderId = descriptor.id;
      header.setAttribute(WORK_NODE_ATTR, `header:${descriptor.id}`);
      header.textContent = descriptor.label;
      return header;
    }
    const row = createRow(descriptor);
    row.dataset.workKind = descriptor.kind;
    row.dataset.workId = descriptor.id;
    row.dataset.workPrimaryUrl = '';
    row.dataset.workExpanded = 'false';
    row.setAttribute(WORK_NODE_ATTR, `row:${descriptor.id}`);
    return row;
  }

  function updateHeader(header, descriptor) {
    header.dataset.workHeaderId = descriptor.id;
    header.textContent = descriptor.label;
  }

  function setStatusClass(element, className) {
    element.classList.remove(...STATUS_CLASSES);
    element.classList.add(STATUS_CLASSES.includes(className) ? className : 'unknown');
  }

  function updateCommonRow(row, descriptor, url, baseAria, summaryText) {
    row.dataset.workKind = descriptor.kind;
    row.dataset.workId = descriptor.id;
    row.dataset.workPrimaryUrl = String(url || '');
    row.dataset.workBaseAriaLabel = baseAria;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', baseAria);
    const primary = row.querySelector('.work-primary-link');
    primary.href = String(url || '');
    primary.setAttribute('aria-label', `Open ${descriptor.id}`);
    const details = row.querySelector('[data-work-details]');
    details.textContent = summaryText;
  }

  function updateJiraRow(row, descriptor) {
    const issue = descriptor.item;
    const summaryText = issue.summary || 'Unavailable';
    const baseAria = `${issue.key}: ${summaryText}; last move ${formatDateTime(issue.lastMove)}; status ${issue.status || 'Unavailable'}`;
    updateCommonRow(row, descriptor, issue.url, baseAria, summaryText);
    const key = row.querySelector('.flight-key'); key.textContent = issue.key || 'Unavailable'; key.title = issue.key || 'Unavailable';
    const summary = row.querySelector('.flight-summary'); summary.textContent = summaryText; summary.title = summaryText;
    const move = row.querySelector('.flight-move'); move.textContent = formatDateTime(issue.lastMove); move.title = issue.lastMove || 'No status transition recorded';
    const info = statusInfo(issue.status);
    const status = row.querySelector('.flight-status'); setStatusClass(status, info.className); status.textContent = issue.status || 'Unavailable'; status.title = issue.status || 'Unavailable';
  }

  function updateGithubRow(row, descriptor) {
    const pull = descriptor.item;
    const shortRepo = String(pull.repository || '').split('/').pop() || pull.repository || 'Repository';
    const titleText = pull.title || 'Untitled pull request';
    const baseAria = `${pull.repository} pull request ${pull.number}: ${titleText}; ${pull.state || 'OPEN'}; updated ${formatDateTime(pull.updatedAt)}`;
    updateCommonRow(row, descriptor, pull.url, baseAria, titleText);
    const repoName = row.querySelector('.github-pr-repo-name'); repoName.textContent = shortRepo;
    const number = row.querySelector('.github-pr-number'); number.textContent = `#${pull.number}`;
    const repo = row.querySelector('.github-pr-repo'); repo.title = pull.repository || '';
    const title = row.querySelector('.github-pr-title'); title.textContent = titleText; title.title = titleText;
    const updated = row.querySelector('.github-pr-updated'); updated.textContent = `Updated ${formatDateTime(pull.updatedAt)}`; updated.title = pull.updatedAt || 'Unknown update time';
    const allowedClass = STATUS_CLASSES.includes(pull.stateClass) ? pull.stateClass : 'unknown';
    const state = row.querySelector('.github-pr-state'); setStatusClass(state, allowedClass); state.textContent = pull.state || 'OPEN'; state.title = pull.state || 'OPEN';
  }

  function updateRecentRow(row, descriptor) {
    const item = descriptor.item;
    const baseAria = `${item.source} ${item.identity}: ${item.title}; updated ${formatDateTime(item.updatedAt)}`;
    updateCommonRow(row, descriptor, item.url, baseAria, item.title);
    const badge = row.querySelector('.recent-source-badge'); badge.className = `recent-source-badge ${item.source.toLowerCase()}`; badge.textContent = item.source;
    const identityText = row.querySelector('.recent-identity-text'); identityText.textContent = item.identity;
    const identity = row.querySelector('.recent-identity'); identity.title = `${item.source} · ${item.identity}`;
    const title = row.querySelector('.recent-title'); title.textContent = item.title; title.title = item.title;
    const updated = row.querySelector('.recent-updated'); updated.textContent = formatDateTime(item.updatedAt); updated.title = item.updatedAt;
  }

  function updateRow(row, descriptor) {
    if (descriptor.kind === 'jira') updateJiraRow(row, descriptor);
    else if (descriptor.kind === 'github') updateGithubRow(row, descriptor);
    else updateRecentRow(row, descriptor);
  }

  function reconcile(container, descriptors, { emptyClass, emptyText } = {}) {
    if (!container || typeof document === 'undefined') return [];
    const scrollTop = container.scrollTop;
    const focused = container.ownerDocument?.activeElement;
    const preserveFocus = Boolean(focused && container.contains(focused));
    const existing = new Map();
    for (const node of [...container.querySelectorAll(`[${WORK_NODE_ATTR}]`)]) {
      const key = node.getAttribute(WORK_NODE_ATTR);
      if (key && !existing.has(key)) existing.set(key, node);
    }

    const desiredKeys = new Set();
    let cursor = container.firstChild;
    for (const descriptor of descriptors) {
      const key = descriptor.type === 'header' ? `header:${descriptor.id}` : `row:${descriptor.id}`;
      desiredKeys.add(key);
      let node = existing.get(key);
      if (!node) node = createNode(descriptor);
      if (descriptor.type === 'header') updateHeader(node, descriptor);
      else updateRow(node, descriptor);

      if (node !== cursor) container.insertBefore(node, cursor);
      cursor = node.nextSibling;
    }

    for (const [key, node] of existing.entries()) {
      if (!desiredKeys.has(key)) node.remove();
    }
    for (const child of [...container.children]) {
      if (!child.hasAttribute(WORK_NODE_ATTR)) child.remove();
    }

    if (!descriptors.length && emptyClass && emptyText) {
      let empty = container.querySelector('[data-work-empty]');
      if (!empty) {
        empty = document.createElement('div');
        empty.dataset.workEmpty = '';
        empty.className = emptyClass;
        container.appendChild(empty);
      }
      empty.textContent = emptyText;
    } else {
      container.querySelectorAll('[data-work-empty]').forEach(node => node.remove());
    }

    if (preserveFocus && focused.isConnected && typeof focused.focus === 'function') {
      focused.focus({ preventScroll: true });
    }
    container.scrollTop = scrollTop;
    return descriptors;
  }

  function renderFlight(container, payload) {
    return reconcile(container, flightDescriptors(payload), {
      emptyClass: 'flight-empty',
      emptyText: 'No Jira tickets match the Flight Control filters.'
    });
  }

  function renderGithub(container, payload) {
    return reconcile(container, githubDescriptors(payload), {
      emptyClass: 'github-empty',
      emptyText: 'No open pull requests in the configured repositories.'
    });
  }

  function renderRecent(container, jiraPayloadValue, githubPayloadValue) {
    return reconcile(container, recentDescriptors(jiraPayloadValue, githubPayloadValue), {
      emptyClass: 'recent-empty',
      emptyText: 'No recent Jira or GitHub activity is available.'
    });
  }

  return {
    RECENT_ACTIVITY_LIMIT,
    statusInfo,
    pullIdentity,
    formatDateTime,
    recentTimestamp,
    recentActivityCompare,
    flightDescriptors,
    githubDescriptors,
    recentActivityItems,
    recentDescriptors,
    reconcile,
    renderFlight,
    renderGithub,
    renderRecent
  };
});
