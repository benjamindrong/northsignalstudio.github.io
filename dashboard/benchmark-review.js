(function (root) {
  'use strict';

  const JIRA_BASE_URL = 'https://benjamindrong80.atlassian.net/browse/';
  const EXPANDED_RESULT_LIMIT = 2;
  const expandedRunKeys = new Set();

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function ensureStyles() {
    if (document.getElementById('benchmark-review-styles')) return;
    const style = document.createElement('style');
    style.id = 'benchmark-review-styles';
    style.textContent = `
      .widget--benchmark { grid-column: 1 / -1; min-height: 360px; display: flex; flex-direction: column; }
      .benchmark-board { margin-top: 16px; min-width: 0; min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--board-line); background: var(--board-bg); color: var(--board-text); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .benchmark-meta { min-height: 34px; display: flex; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--board-line); background: var(--board-panel); color: #a8aea8; font-size: 9px; letter-spacing: .055em; text-transform: uppercase; }
      .benchmark-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 10px; display: grid; gap: 10px; }
      .benchmark-active { border: 1px solid #ffd166; padding: 10px; background: #15140e; }
      .benchmark-active-label { color: #ffd166; font-size: 8px; font-weight: 950; letter-spacing: .09em; text-transform: uppercase; }
      .benchmark-active .benchmark-run { padding-left: 0; padding-right: 0; }
      .benchmark-run-header { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 28px; align-items: start; gap: 8px; }
      .benchmark-run-identity { min-width: 0; }
      .benchmark-run-title { margin-top: 4px; color: #fff7d3; font-size: 13px; font-weight: 900; text-decoration: none; overflow-wrap: anywhere; }
      .benchmark-run-title:hover, .benchmark-run-title:focus-visible { text-decoration: underline; outline: none; }
      .benchmark-disclosure { width: 28px; min-width: 28px; height: 28px; border: 1px solid #697069; background: transparent; color: var(--board-text); cursor: pointer; font: inherit; line-height: 1; }
      .benchmark-disclosure:hover, .benchmark-disclosure:focus-visible { border-color: var(--board-text); outline: none; }
      .benchmark-run-meta { margin-top: 4px; color: #a8aea8; font-size: 9px; line-height: 1.35; overflow-wrap: anywhere; }
      .benchmark-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .benchmark-columns.completed-only { grid-template-columns: minmax(0, 1fr); }
      .benchmark-group { min-width: 0; border: 1px solid var(--board-line-soft); background: #101310; }
      .benchmark-group h3 { margin: 0; padding: 7px 8px; border-bottom: 1px solid var(--board-line-soft); color: #c8cec8; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
      .benchmark-run { min-width: 0; padding: 8px; border-bottom: 1px solid var(--board-line-soft); }
      .benchmark-run:last-child { border-bottom: 0; }
      .benchmark-result { margin-top: 5px; color: #c8c8bc; font-size: 9px; line-height: 1.35; overflow-wrap: anywhere; }
      .benchmark-result-summary { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .benchmark-result-summary[hidden], .benchmark-run-details[hidden] { display: none; }
      .benchmark-run-details { min-width: 0; margin-top: 7px; padding-top: 2px; border-top: 1px solid var(--board-line-soft); }
      .benchmark-result.backfill { color: #ffd166; }
      .benchmark-result.none, .benchmark-result.unknown { color: #9da59d; }
      .benchmark-status { display: inline-block; margin-left: 6px; border: 1px solid currentColor; padding: 2px 4px 1px; font-size: 7px; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; vertical-align: 1px; }
      .benchmark-status.preparing { color: var(--review); }
      .benchmark-status.blocked { color: var(--blocked); }
      .benchmark-status.running { color: var(--progress); }
      .benchmark-status.completed { color: var(--done); }
      .benchmark-status.selected { color: var(--review); }
      .benchmark-status.retired, .benchmark-status.unused { color: var(--muted); }
      .benchmark-ideas, .benchmark-invalid { border: 1px solid var(--board-line-soft); background: #101310; }
      .benchmark-ideas summary, .benchmark-invalid summary { cursor: pointer; padding: 8px; color: #c8cec8; font-size: 9px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
      .benchmark-idea-body { padding: 0 8px 8px; display: grid; gap: 8px; }
      .benchmark-idea-section strong { display: block; margin-bottom: 4px; color: #a8aea8; font-size: 8px; letter-spacing: .05em; text-transform: uppercase; }
      .benchmark-idea { color: #c8c8bc; font-size: 9px; line-height: 1.35; }
      .benchmark-invalid .benchmark-idea { color: var(--blocked); }
      .benchmark-empty { min-height: 170px; display: grid; place-items: center; padding: 18px; color: #9da59d; text-align: center; font-size: 10px; line-height: 1.45; letter-spacing: .04em; text-transform: uppercase; }
      @media (max-width: 859px) { .widget--benchmark { grid-column: auto; min-height: 360px; } }
      @media (max-width: 620px) { .benchmark-columns { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  function ensureSurface() {
    ensureStyles();
    let widget = document.querySelector('.widget--benchmark');
    if (widget) return widget;
    const grid = document.querySelector('.dashboard-grid');
    if (!grid) return null;
    widget = create('section', 'widget widget--benchmark');
    widget.setAttribute('aria-labelledby', 'benchmark-title');
    const header = create('header', 'widget-header');
    const title = create('h2', '', 'Benchmark Review');
    title.id = 'benchmark-title';
    header.appendChild(title);
    const board = create('div', 'benchmark-board');
    board.setAttribute('aria-label', 'Benchmark Review registry');
    const meta = create('div', 'benchmark-meta', 'Encrypted BEN registry');
    meta.id = 'benchmarkSource';
    const content = create('div', 'benchmark-content');
    content.id = 'benchmarkContent';
    content.appendChild(create('div', 'benchmark-empty', 'Unlock the dashboard to load Benchmark Review.'));
    board.append(meta, content);
    widget.append(header, board);
    grid.appendChild(widget);
    return widget;
  }

  function runLink(run) {
    const link = create('a', 'benchmark-run-title', `${run.key} · ${run.title}`);
    link.href = `${JIRA_BASE_URL}${encodeURIComponent(run.key)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function activityTypeLabel(run) {
    const activityKind = String(run?.activityKind || '').trim();
    const legacyType = String(run?.type || '').trim();
    if (run && run.activityKind === 'benchmark-testing') {
      return legacyType.startsWith('Benchmark Testing')
        ? legacyType.replace(/^Benchmark Testing/, 'Application Testing')
        : 'Application Testing';
    }
    if (run && run.activityKind === 'candidate-evaluation') {
      return legacyType.startsWith('Candidate Evaluation')
        ? legacyType.replace(/^Candidate Evaluation/, 'Comparative Evaluation')
        : 'Comparative Evaluation';
    }
    if (activityKind) return legacyType;
    if (legacyType.startsWith('Benchmark Testing')) return legacyType.replace(/^Benchmark Testing/, 'Application Testing');
    if (legacyType.startsWith('Candidate Evaluation')) return legacyType.replace(/^Candidate Evaluation/, 'Comparative Evaluation');
    return legacyType;
  }

  function resultSummaryText(run) {
    if (Array.isArray(run.resultLines) && run.resultLines.length) return String(run.resultLines[0]);
    if (activityTypeLabel(run).startsWith('Application Testing')) return 'Application testing record.';
    return run.resultState === 'none' ? 'No comparative results recorded yet.' : 'Result: Unknown / backfill.';
  }

  function expandedResultLines(run) {
    if (!Array.isArray(run?.resultLines)) return [];
    return run.resultLines.slice(0, EXPANDED_RESULT_LIMIT).map(line => String(line));
  }

  function appendResults(container, run) {
    const resultLines = expandedResultLines(run);
    if (resultLines.length) {
      for (const line of resultLines) container.appendChild(create('div', `benchmark-result ${run.resultState || 'unknown'}`, line));
      return;
    }
    if (activityTypeLabel(run).startsWith('Application Testing')) {
      container.appendChild(create('div', 'benchmark-result none', 'Application testing record.'));
      return;
    }
    const fallback = run.resultState === 'none' ? 'No comparative results recorded yet.' : 'Result: Unknown / backfill.';
    container.appendChild(create('div', `benchmark-result ${run.resultState || 'unknown'}`, fallback));
  }

  function appendRun(container, run) {
    const key = String(run.key || 'Unknown');
    const expanded = expandedRunKeys.has(key);
    const row = create('div', 'benchmark-run');
    row.dataset.benchmarkKey = key;

    const header = create('div', 'benchmark-run-header');
    const identity = create('div', 'benchmark-run-identity');
    identity.appendChild(runLink(run));
    const status = create('span', `benchmark-status ${String(run.status || 'unknown').toLowerCase()}`, run.statusRaw || run.status || 'Unknown');
    identity.appendChild(status);

    const disclosure = create('button', 'benchmark-disclosure', expanded ? '▾' : '▸');
    disclosure.type = 'button';
    disclosure.dataset.benchmarkDisclosure = key;
    disclosure.setAttribute('aria-expanded', String(expanded));
    disclosure.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} details for ${key}`);

    header.append(identity, disclosure);
    row.appendChild(header);

    const activityType = activityTypeLabel(run);
    const metadata = [run.source && `Source: ${run.source}`, activityType && `Type: ${activityType}`, run.turnsCompleted && `Turns: ${run.turnsCompleted}`].filter(Boolean).join(' · ');
    if (metadata) row.appendChild(create('div', 'benchmark-run-meta', metadata));

    const summary = create('div', `benchmark-result benchmark-result-summary ${run.resultState || 'unknown'}`, resultSummaryText(run));
    summary.dataset.benchmarkSummary = '';
    summary.hidden = expanded;
    row.appendChild(summary);

    const details = create('div', 'benchmark-run-details');
    details.dataset.benchmarkDetails = '';
    details.hidden = !expanded;
    appendResults(details, run);
    row.appendChild(details);

    disclosure.addEventListener('click', () => {
      const nextExpanded = disclosure.getAttribute('aria-expanded') !== 'true';
      if (nextExpanded) expandedRunKeys.add(key);
      else expandedRunKeys.delete(key);
      disclosure.setAttribute('aria-expanded', String(nextExpanded));
      disclosure.setAttribute('aria-label', `${nextExpanded ? 'Hide' : 'Show'} details for ${key}`);
      disclosure.textContent = nextExpanded ? '▾' : '▸';
      summary.hidden = nextExpanded;
      details.hidden = !nextExpanded;
    });

    container.appendChild(row);
  }

  function appendRunGroup(content, label, runs) {
    const group = create('section', 'benchmark-group');
    group.appendChild(create('h3', '', `${label} · ${runs.length}`));
    if (!runs.length) group.appendChild(create('div', 'benchmark-run benchmark-result unknown', `No ${label.toLowerCase()} benchmarks recorded.`));
    else for (const run of runs) appendRun(group, run);
    content.appendChild(group);
  }

  function orderedNextRuns(registry) {
    if (pointerErrorMessage(registry)) return [];
    const preparing = registry.runs.filter(run => run.status === 'Preparing');
    const selectedKey = registry.selectedNext.key;
    const selectedIndex = preparing.findIndex(run => run.key === selectedKey);
    if (selectedIndex < 0) return [];
    if (selectedIndex === 0) return preparing;
    const selected = preparing[selectedIndex];
    return [selected, ...preparing.slice(0, selectedIndex), ...preparing.slice(selectedIndex + 1)];
  }

  function pointerErrorMessage(registry) {
    if (registry?.pointerError) return registry.pointerError;
    if (!registry?.selectedNext) {
      return 'BEN-21 does not identify a selected Preparing registry item.';
    }
    if (registry.selectedNext.status !== 'Preparing') {
      return 'BEN-21 Parent does not identify an eligible Preparing registry item.';
    }
    const selectedKey = registry.selectedNext.key;
    if (!Array.isArray(registry.runs) || !registry.runs.some(run => run.status === 'Preparing' && run.key === selectedKey)) {
      return 'BEN-21 Parent is unavailable from the Preparing registry projection.';
    }
    return '';
  }

  function appendIdeas(content, registry) {
    const definedUnused = Array.isArray(registry.runs) ? registry.runs.filter(run => run.status === 'Unused') : [];
    const previous = Array.isArray(registry.previouslyConsidered) ? registry.previouslyConsidered : [];
    const freshGroups = Array.isArray(registry.freshBacklog) ? registry.freshBacklog : [];
    const freshCount = freshGroups.reduce((total, group) => total + (group.ideas?.length || 0), 0);
    const details = create('details', 'benchmark-ideas');
    details.appendChild(create('summary', '', `Idea backlog · ${definedUnused.length + previous.length + freshCount}`));
    const body = create('div', 'benchmark-idea-body');

    if (definedUnused.length) {
      const section = create('div', 'benchmark-idea-section');
      section.appendChild(create('strong', '', 'Defined unused benchmarks'));
      for (const run of definedUnused) section.appendChild(create('div', 'benchmark-idea', `${run.key} · ${run.title}`));
      body.appendChild(section);
    }

    if (previous.length) {
      const section = create('div', 'benchmark-idea-section');
      section.appendChild(create('strong', '', 'Previously considered / unused'));
      for (const idea of previous) section.appendChild(create('div', 'benchmark-idea', idea.detail ? `${idea.title} — ${idea.detail}` : idea.title));
      body.appendChild(section);
    }

    for (const group of freshGroups) {
      const section = create('div', 'benchmark-idea-section');
      section.appendChild(create('strong', '', `Fresh · ${group.group}`));
      for (const idea of group.ideas || []) section.appendChild(create('div', 'benchmark-idea', idea.detail ? `${idea.title} — ${idea.detail}` : idea.title));
      body.appendChild(section);
    }

    if (!body.childNodes.length) body.appendChild(create('div', 'benchmark-idea', 'No unused benchmark ideas recorded.'));
    details.appendChild(body);
    content.appendChild(details);
  }

  function appendInvalidRecords(content, registry) {
    const invalid = Array.isArray(registry.invalidRecords) ? registry.invalidRecords : [];
    if (!invalid.length) return;
    const details = create('details', 'benchmark-invalid');
    details.appendChild(create('summary', '', `Invalid registry records · ${invalid.length}`));
    const body = create('div', 'benchmark-idea-body');
    for (const record of invalid) {
      const reasons = Array.isArray(record.reasons) ? record.reasons.join('; ') : 'Invalid registry state.';
      body.appendChild(create('div', 'benchmark-idea', `${record.key || 'Unknown'} · ${reasons}`));
    }
    details.appendChild(body);
    content.appendChild(details);
  }

  function restoreRenderState(content, focusedKey, scrollTop) {
    const renderedKeys = new Set([...content.querySelectorAll('[data-benchmark-key]')].map(row => row.dataset.benchmarkKey));
    for (const key of [...expandedRunKeys]) {
      if (!renderedKeys.has(key)) expandedRunKeys.delete(key);
    }
    content.scrollTop = scrollTop;
    if (!focusedKey) return;
    const disclosure = [...content.querySelectorAll('[data-benchmark-disclosure]')]
      .find(button => button.dataset.benchmarkDisclosure === focusedKey);
    disclosure?.focus({ preventScroll: true });
  }

  function render(registry) {
    ensureSurface();
    const content = document.getElementById('benchmarkContent');
    const source = document.getElementById('benchmarkSource');
    if (!content || !source) return;
    const focusedKey = content.contains(document.activeElement)
      ? document.activeElement?.getAttribute?.('data-benchmark-disclosure') || ''
      : '';
    const scrollTop = content.scrollTop;
    content.replaceChildren();

    if (!registry || registry.state !== 'ready') {
      source.textContent = registry?.sourceLabel || (registry?.sourceKey ? `${registry.sourceKey} · unavailable` : 'BEN registry unavailable');
      content.appendChild(create('div', 'benchmark-empty', registry?.message || 'Benchmark registry is unavailable.'));
      return;
    }

    source.textContent = registry.sourceLabel || `${registry.sourceKey || 'BEN'} · benchmark registry`;

    const pointerError = pointerErrorMessage(registry);
    if (pointerError) content.appendChild(create('div', 'benchmark-result backfill', `Next pointer unavailable: ${pointerError}`));

    const activeRuns = registry.runs.filter(run => run.status === 'Running');
    if (activeRuns.length) {
      const active = create('section', 'benchmark-active');
      active.appendChild(create('div', 'benchmark-active-label', `Active · ${activeRuns.length}`));
      for (const run of activeRuns) appendRun(active, run);
      content.appendChild(active);
    }

    const nextRuns = orderedNextRuns(registry);
    const completedRuns = registry.runs
      .filter(run => run.status === 'Completed')
      .sort((a, b) => String(b.key || '').localeCompare(String(a.key || ''), undefined, { numeric: true }));
    const columns = create('div', nextRuns.length ? 'benchmark-columns' : 'benchmark-columns completed-only');
    if (nextRuns.length) appendRunGroup(columns, 'Next', nextRuns);
    appendRunGroup(columns, 'Completed', completedRuns);
    content.appendChild(columns);

    const blockedRuns = registry.runs.filter(run => run.status === 'Blocked');
    if (blockedRuns.length) appendRunGroup(content, 'Blocked', blockedRuns);

    appendIdeas(content, registry);
    appendInvalidRecords(content, registry);
    restoreRenderState(content, focusedKey, scrollTop);
  }

  function locked(message = 'Unlock the dashboard to load Benchmark Review.') {
    ensureSurface();
    expandedRunKeys.clear();
    const content = document.getElementById('benchmarkContent');
    const source = document.getElementById('benchmarkSource');
    if (source) source.textContent = 'Encrypted BEN registry';
    if (content) {
      content.replaceChildren();
      content.appendChild(create('div', 'benchmark-empty', message));
    }
  }

  if (typeof document !== 'undefined') ensureSurface();
  if (typeof module !== 'undefined' && module.exports) module.exports = { orderedNextRuns, pointerErrorMessage, resultSummaryText, expandedResultLines };
  root.DashboardBenchmarkReview = { render, locked };
})(typeof globalThis !== 'undefined' ? globalThis : this);