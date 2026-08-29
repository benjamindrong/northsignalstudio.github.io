const STATUS_NAMES = new Map([
  ['unused', 'Unused'],
  ['selected', 'Selected'],
  ['preparing', 'Preparing'],
  ['blocked', 'Blocked'],
  ['running', 'Running'],
  ['completed', 'Completed'],
  ['retired', 'Retired']
]);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function inlineText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return String(node.text || '');
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(inlineText).join('');
}

function itemText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'bulletList' || node.type === 'orderedList') return '';
  if (node.type === 'text') return String(node.text || '');
  if (node.type === 'hardBreak') return ' ';
  return (node.content || []).map(itemText).join(' ');
}

function listBlocks(node, depth = 0) {
  const blocks = [];
  for (const item of node?.content || []) {
    if (item?.type !== 'listItem') continue;
    const text = clean(itemText(item));
    if (text) blocks.push({ kind: 'bullet', depth, text });
    for (const child of item.content || []) {
      if (child?.type === 'bulletList' || child?.type === 'orderedList') blocks.push(...listBlocks(child, depth + 1));
    }
  }
  return blocks;
}

function markdownBlocks(source) {
  const blocks = [];
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: clean(heading[2].replace(/\*\*/g, '')) });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      blocks.push({ kind: 'bullet', depth: 0, text: clean(bullet[1].replace(/\*\*/g, '')) });
      continue;
    }
    blocks.push({ kind: 'paragraph', text: clean(line.replace(/\*\*/g, '')) });
  }
  return blocks;
}

export function adfBlocks(description) {
  if (typeof description === 'string') return markdownBlocks(description);
  if (!description || typeof description !== 'object' || description.type !== 'doc' || !Array.isArray(description.content)) return [];

  const blocks = [];
  for (const node of description.content) {
    if (node?.type === 'heading') {
      const text = clean(inlineText(node));
      if (text) blocks.push({ kind: 'heading', level: Number(node.attrs?.level) || 1, text });
    } else if (node?.type === 'bulletList' || node?.type === 'orderedList') {
      blocks.push(...listBlocks(node));
    } else {
      const text = clean(inlineText(node));
      if (text) blocks.push({ kind: 'paragraph', text });
    }
  }
  return blocks;
}

function normalizeHeading(value) {
  return clean(value).toLowerCase().replace(/[—–]/g, '-');
}

function sectionRange(blocks, headingText) {
  const wanted = normalizeHeading(headingText);
  const start = blocks.findIndex(block => block.kind === 'heading' && block.level === 2 && normalizeHeading(block.text) === wanted);
  if (start < 0) return [];
  const endOffset = blocks.slice(start + 1).findIndex(block => block.kind === 'heading' && block.level <= 2);
  const end = endOffset < 0 ? blocks.length : start + 1 + endOffset;
  return blocks.slice(start + 1, end);
}

function parseRunHeading(text) {
  const match = clean(text).match(/^([A-Z][A-Z0-9]+-\d+)\s*[—–-]\s*(.+)$/);
  return match ? { key: match[1], title: clean(match[2]) } : null;
}

function property(line) {
  const match = clean(line).match(/^([^:]{1,80}):\s*(.*)$/);
  return match ? { name: clean(match[1]), value: clean(match[2]) } : null;
}

function normalizeStatus(raw) {
  const text = clean(raw);
  const lower = text.toLowerCase();
  const next = /\bnext\b/.test(lower);
  const matched = [...STATUS_NAMES.entries()].find(([key]) => new RegExp(`\\b${key}\\b`, 'i').test(text));
  return { status: matched ? matched[1] : 'Unknown', statusRaw: text || 'Unknown', next };
}

function resultState(lines) {
  if (lines.some(line => /backfill|do not infer|unknown|record exact.*as .*canonical/i.test(line))) return 'backfill';
  if (lines.some(line => /none yet|no result/i.test(line))) return 'none';
  return lines.length ? 'recorded' : 'unknown';
}

function isResultLine(line) {
  return /^(historical per-turn scores\/winner|exact scores\/winners|candidate results|most consequential benchmark signal|result\s*:|most consequential split|exact historical candidate scores)\b/i.test(clean(line));
}

function parseRun(section, headingIndex) {
  const identity = parseRunHeading(section[headingIndex].text);
  if (!identity) return null;
  const nextHeadingOffset = section.slice(headingIndex + 1).findIndex(block => block.kind === 'heading' && block.level <= 3);
  const end = nextHeadingOffset < 0 ? section.length : headingIndex + 1 + nextHeadingOffset;
  const lines = section.slice(headingIndex + 1, end).filter(block => block.kind === 'bullet' || block.kind === 'paragraph').map(block => block.text);
  const properties = lines.map(property).filter(Boolean);
  const valueFor = pattern => properties.find(entry => pattern.test(entry.name))?.value || '';
  const statusInfo = normalizeStatus(valueFor(/^status$/i));
  const resultLines = lines.filter(isResultLine);
  const turns = valueFor(/^turns completed$/i);

  return {
    ...identity,
    status: statusInfo.status,
    statusRaw: statusInfo.statusRaw,
    next: statusInfo.next,
    source: valueFor(/^(source|feature\/source)$/i),
    type: valueFor(/^type$/i),
    turnsCompleted: turns || null,
    resultState: resultState(resultLines),
    resultLines
  };
}

function parseRuns(blocks) {
  const section = sectionRange(blocks, 'Benchmark Run Ledger');
  if (!section.length) return { runs: [], error: 'Benchmark Run Ledger section is missing.' };
  const runs = [];
  for (let index = 0; index < section.length; index += 1) {
    if (section[index].kind !== 'heading' || section[index].level !== 3) continue;
    const run = parseRun(section, index);
    if (run) runs.push(run);
  }
  if (!runs.length) return { runs: [], error: 'Benchmark Run Ledger contains no recognizable BEN entries.' };
  return { runs, error: '' };
}

function parseIdeaLine(text) {
  const line = clean(text);
  const separator = line.match(/^(.*?)\s+[—–]\s+(.+)$/);
  return separator
    ? { title: clean(separator[1]), detail: clean(separator[2]) }
    : { title: line, detail: '' };
}

function parsePreviouslyConsidered(blocks) {
  return sectionRange(blocks, 'Previously Considered / Unused Ideas')
    .filter(block => block.kind === 'bullet')
    .map(block => parseIdeaLine(block.text));
}

function parseFreshBacklog(blocks) {
  const section = sectionRange(blocks, 'Fresh Idea Backlog');
  const groups = [];
  let group = null;
  for (const block of section) {
    if (block.kind === 'heading' && block.level === 3) {
      group = { group: block.text, ideas: [] };
      groups.push(group);
    } else if (block.kind === 'bullet' && group) {
      group.ideas.push(parseIdeaLine(block.text));
    }
  }
  return groups.filter(entry => entry.ideas.length);
}

function unavailable(sourceKey, updatedAt, message) {
  return {
    state: 'unavailable',
    authority: 'ben-8',
    sourceKey,
    sourceLabel: 'BEN-8 temporary rollback authority',
    updatedAt,
    message
  };
}

export function projectBenchmarkRegistry(description, { sourceKey = 'BEN-8', updatedAt = '' } = {}) {
  const blocks = adfBlocks(description);
  const { runs, error } = parseRuns(blocks);
  if (error) return unavailable(sourceKey, updatedAt, error);

  const selectedNext = runs.filter(run => run.status === 'Selected' && run.next);
  if (selectedNext.length > 1) {
    return unavailable(sourceKey, updatedAt, 'Benchmark registry contains multiple selected-next entries.');
  }

  return {
    state: 'ready',
    authority: 'ben-8',
    sourceKey,
    sourceLabel: 'BEN-8 temporary rollback authority',
    updatedAt,
    selectedNext: selectedNext[0] || null,
    runs,
    previouslyConsidered: parsePreviouslyConsidered(blocks),
    freshBacklog: parseFreshBacklog(blocks)
  };
}
