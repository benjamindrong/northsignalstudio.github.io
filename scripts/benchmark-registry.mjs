const ACTIVITY_LABELS = new Map([
  ['candidate-evaluation', 'Candidate Evaluation'],
  ['benchmark-testing', 'Benchmark Testing']
]);

const IDEA_CATEGORY_LABELS = new Map([
  ['registry-idea-considered', 'considered'],
  ['registry-idea-fresh', 'fresh']
]);

const RESULT_LABELS = new Map([
  ['registry-result-summary', 'summary'],
  ['registry-result-unknown', 'unknown']
]);

export const REGISTRY_QUERY_LABELS = [
  ...ACTIVITY_LABELS.keys(),
  'registry-idea'
];

const POINTER_FORBIDDEN_LABELS = new Set([
  ...ACTIVITY_LABELS.keys(),
  'registry-idea',
  'registry-blocked',
  'registry-retired',
  ...IDEA_CATEGORY_LABELS.keys(),
  ...RESULT_LABELS.keys()
]);

const POINTER_SUMMARY = 'Benchmark Registry Next Pointer';
const ELIGIBLE_NEXT_STATUSES = new Set(['Preparing', 'Blocked', 'Running']);
const EXCLUDED_REGISTRY_KEYS = new Set(['BEN-6', 'BEN-21', 'BEN-33']);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function lowerLabels(issue) {
  return new Set((issue?.fields?.labels || []).map(label => clean(label).toLowerCase()).filter(Boolean));
}

function statusCategory(issue) {
  return clean(issue?.fields?.status?.statusCategory?.key).toLowerCase();
}

function issueProjectKey(issue) {
  const fieldKey = clean(issue?.fields?.project?.key);
  if (fieldKey) return fieldKey;
  return clean(issue?.key).split('-')[0] || '';
}

function linkedIssueFromRelates(link, owningKey) {
  if (clean(link?.type?.name).toLowerCase() !== 'relates') return null;
  const outward = link?.outwardIssue;
  const inward = link?.inwardIssue;
  if (outward && clean(outward.key) !== owningKey) return outward;
  if (inward && clean(inward.key) !== owningKey) return inward;
  return null;
}

function sourceIdentity(issue, errors) {
  const owningProject = issueProjectKey(issue);
  const linked = (issue?.fields?.issuelinks || [])
    .map(link => linkedIssueFromRelates(link, clean(issue?.key)))
    .filter(Boolean)
    .filter(candidate => issueProjectKey(candidate) && issueProjectKey(candidate) !== owningProject);

  if (linked.length > 1) {
    errors.push('More than one cross-project Relates link is present.');
    return { source: 'Unknown', sourceKey: '' };
  }
  if (!linked.length) return { source: 'Unknown', sourceKey: '' };
  return { source: clean(linked[0].key) || 'Unknown', sourceKey: clean(linked[0].key) };
}

function inlineText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return String(node.text || '');
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(inlineText).join('');
}

function listItemText(item) {
  return (item?.content || [])
    .filter(child => child?.type === 'paragraph' || child?.type === 'codeBlock')
    .map(inlineText)
    .join(' ');
}

function listBlocks(node, depth = 0, containerDepth = 0) {
  const blocks = [];
  for (const item of node?.content || []) {
    if (item?.type !== 'listItem') continue;
    const text = clean(listItemText(item));
    if (text) blocks.push({ kind: 'bullet', text, depth, listType: node.type, containerDepth });
    for (const child of item.content || []) {
      if (child?.type === 'bulletList' || child?.type === 'orderedList') {
        blocks.push(...listBlocks(child, depth + 1, containerDepth));
      } else if (child?.type !== 'paragraph' && child?.type !== 'codeBlock' && Array.isArray(child?.content)) {
        blocks.push(...adfNodeBlocks(child, containerDepth + 1));
      }
    }
  }
  return blocks;
}

function adfNodeBlocks(node, containerDepth = 0) {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'heading') {
    const text = clean(inlineText(node));
    return text ? [{ kind: 'heading', level: Number(node.attrs?.level) || 1, text, containerDepth }] : [];
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return listBlocks(node, 0, containerDepth);
  }
  if (node.type === 'paragraph' || node.type === 'codeBlock') {
    const text = clean(inlineText(node));
    return text ? [{ kind: 'paragraph', text, containerDepth }] : [];
  }
  if (node.type === 'text' || node.type === 'hardBreak') {
    const text = clean(inlineText(node));
    return text ? [{ kind: 'paragraph', text, containerDepth }] : [];
  }

  const children = Array.isArray(node.content) ? node.content : [];
  if (children.length) {
    const nested = children.flatMap(child => adfNodeBlocks(child, containerDepth + (node.type === 'doc' ? 0 : 1)));
    if (nested.length) return nested;
  }
  return node.type === 'doc' ? [] : [{ kind: 'unsupported', text: clean(inlineText(node)), containerDepth }];
}

function markdownBlocks(source) {
  const blocks = [];
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: clean(heading[2].replace(/\*\*/g, '')), containerDepth: 0 });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      blocks.push({ kind: 'bullet', text: clean(bullet[1].replace(/\*\*/g, '')), depth: 0, listType: 'bulletList', containerDepth: 0 });
      continue;
    }
    blocks.push({ kind: 'paragraph', text: clean(line.replace(/\*\*/g, '')), containerDepth: 0 });
  }
  return blocks;
}

export function descriptionBlocks(description) {
  if (typeof description === 'string') return markdownBlocks(description);
  if (!description || typeof description !== 'object' || description.type !== 'doc' || !Array.isArray(description.content)) return [];
  return description.content.flatMap(node => adfNodeBlocks(node, 0));
}

function headingIndexes(blocks, level, text) {
  const wanted = clean(text).toLowerCase();
  return blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.kind === 'heading' && block.level === level && clean(block.text).toLowerCase() === wanted)
    .map(({ index }) => index);
}

export function parseCanonicalResultSummary(description) {
  const blocks = descriptionBlocks(description);
  const artifactIndexes = headingIndexes(blocks, 3, 'Completion Artifact');
  const resultIndexes = headingIndexes(blocks, 4, 'Registry Result Summary');
  if (artifactIndexes.length !== 1) return { ok: false, error: 'Description must contain exactly one ### Completion Artifact.' };
  if (resultIndexes.length !== 1) return { ok: false, error: 'Description must contain exactly one #### Registry Result Summary.' };

  const artifactIndex = artifactIndexes[0];
  const resultIndex = resultIndexes[0];
  if (blocks[artifactIndex].containerDepth !== 0 || blocks[resultIndex].containerDepth !== 0) {
    return { ok: false, error: 'Canonical Completion Artifact and Registry Result Summary headings must be top-level Description sections.' };
  }

  const artifactEndOffset = blocks.slice(artifactIndex + 1).findIndex(block => block.kind === 'heading' && block.level <= 3);
  const artifactEnd = artifactEndOffset < 0 ? blocks.length : artifactIndex + 1 + artifactEndOffset;
  if (resultIndex <= artifactIndex || resultIndex >= artifactEnd) {
    return { ok: false, error: 'Registry Result Summary must be inside the canonical Completion Artifact.' };
  }

  const resultEndOffset = blocks.slice(resultIndex + 1).findIndex(block => block.kind === 'heading' && block.level <= 4);
  const resultEnd = resultEndOffset < 0 ? blocks.length : resultIndex + 1 + resultEndOffset;
  const resultContent = blocks.slice(resultIndex + 1, resultEnd);
  if (resultContent.some(block => block.kind !== 'bullet')) {
    return { ok: false, error: 'Registry Result Summary may contain only the three required bullets.' };
  }
  const bullets = resultContent.filter(block => block.kind === 'bullet');
  if (bullets.length !== 3 || bullets.some(block => block.depth !== 0 || block.listType !== 'bulletList' || block.containerDepth !== 0)) {
    return { ok: false, error: 'Registry Result Summary must contain exactly three top-level bullet-list items.' };
  }

  const names = ['Outcome', 'Scores', 'Signal'];
  const values = {};
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const pattern = new RegExp(`^${name}:\\s*`);
    const bullet = bullets[index];
    if (!pattern.test(bullet.text)) {
      return { ok: false, error: 'Registry Result Summary bullets must be exactly Outcome:, Scores:, and Signal: in that order.' };
    }
    const value = clean(bullet.text.replace(pattern, ''));
    if (!value) return { ok: false, error: `${name}: must contain a value.` };
    values[name.toLowerCase()] = value;
  }

  return {
    ok: true,
    values,
    lines: [`Outcome: ${values.outcome}`, `Scores: ${values.scores}`, `Signal: ${values.signal}`]
  };
}

function hasResultSummary(description) {
  return headingIndexes(descriptionBlocks(description), 4, 'Registry Result Summary').length > 0;
}

function classifyIssue(issue) {
  const labels = lowerLabels(issue);
  const errors = [];
  const key = clean(issue?.key);
  const title = clean(issue?.fields?.summary) || key;
  const category = statusCategory(issue);
  const activityLabels = [...ACTIVITY_LABELS.keys()].filter(label => labels.has(label));
  const ideaCategories = [...IDEA_CATEGORY_LABELS.keys()].filter(label => labels.has(label));
  const resultLabels = [...RESULT_LABELS.keys()].filter(label => labels.has(label));
  const isIdea = labels.has('registry-idea');
  const isBlocked = labels.has('registry-blocked');
  const isRetired = labels.has('registry-retired');

  if (activityLabels.length > 1) errors.push('More than one activity-kind label is present.');
  if (ideaCategories.length > 1) errors.push('More than one idea-category label is present.');
  if (ideaCategories.length && !isIdea) errors.push('Idea-category labels require registry-idea.');
  if (isIdea && (isBlocked || isRetired)) errors.push('registry-idea cannot coexist with registry-blocked or registry-retired.');
  if (isBlocked && isRetired) errors.push('registry-blocked cannot coexist with registry-retired.');

  let lifecycle = '';
  if (isIdea && category === 'new') lifecycle = 'Unused';
  else if (isBlocked && (category === 'new' || category === 'indeterminate')) lifecycle = 'Blocked';
  else if (!isIdea && !isBlocked && !isRetired && category === 'new' && activityLabels.length === 1) lifecycle = 'Preparing';
  else if (!isIdea && !isBlocked && !isRetired && category === 'indeterminate' && activityLabels.length === 1) lifecycle = 'Running';
  else if (!isIdea && !isBlocked && !isRetired && category === 'done' && activityLabels.length === 1) lifecycle = 'Completed';
  else if (!isIdea && !isBlocked && isRetired && category === 'done' && activityLabels.length === 1) lifecycle = 'Retired';
  else errors.push('Status category and lifecycle labels do not match the BEN-18 lifecycle mapping.');

  const ideaCategory = ideaCategories.length === 1 ? IDEA_CATEGORY_LABELS.get(ideaCategories[0]) : '';
  if (lifecycle === 'Unused' && !ideaCategory && activityLabels.length !== 1) {
    errors.push('Defined unused benchmark records require exactly one activity-kind label.');
  }
  if (lifecycle !== 'Unused' && activityLabels.length !== 1) {
    errors.push('Active/completed registry records require exactly one activity-kind label.');
  }

  const activityKind = activityLabels.length === 1 ? activityLabels[0] : '';
  const activityName = activityKind ? ACTIVITY_LABELS.get(activityKind) : '';
  let resultState = 'none';
  let resultLines = [];

  if (activityKind === 'candidate-evaluation' && lifecycle === 'Completed') {
    if (resultLabels.length !== 1) {
      errors.push('Completed Candidate Evaluation requires exactly one result-state label.');
    } else if (RESULT_LABELS.get(resultLabels[0]) === 'unknown') {
      if (hasResultSummary(issue?.fields?.description)) errors.push('registry-result-unknown cannot contain a Registry Result Summary subsection.');
      resultState = 'backfill';
      resultLines = ['Result: Unknown / backfill.'];
    } else {
      const parsed = parseCanonicalResultSummary(issue?.fields?.description);
      if (!parsed.ok) errors.push(parsed.error);
      else {
        resultState = 'recorded';
        resultLines = parsed.lines;
      }
    }
  } else if (resultLabels.length) {
    errors.push('Result-state labels are only valid on Completed Candidate Evaluation records.');
  }

  const source = sourceIdentity(issue, errors);
  return {
    key,
    title,
    status: lifecycle || 'Invalid',
    statusRaw: lifecycle || 'Invalid',
    activityKind,
    type: activityName,
    ideaCategory,
    source: source.source,
    sourceKey: source.sourceKey,
    turnsCompleted: null,
    resultState,
    resultLines,
    updatedAt: clean(issue?.fields?.updated),
    errors
  };
}

function maxUpdatedAt(records) {
  let best = '';
  let bestTime = NaN;
  for (const value of records.map(record => clean(record)).filter(Boolean)) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) continue;
    if (Number.isNaN(bestTime) || time > bestTime) {
      best = value;
      bestTime = time;
    }
  }
  return best;
}

function exactPointerMatches(pointerMatches) {
  const wanted = POINTER_SUMMARY.toLowerCase();
  return (pointerMatches || []).filter(issue => clean(issue?.fields?.summary).toLowerCase() === wanted);
}

function resolveSelectedNext(pointerIssue, pointerMatches, runs) {
  const exactMatches = exactPointerMatches(pointerMatches);
  if (exactMatches.length !== 1 || clean(exactMatches[0]?.key) !== 'BEN-21') {
    return { selectedNext: null, pointerError: 'BEN-21 is not the unique Benchmark Registry Next Pointer.' };
  }
  if (clean(pointerIssue?.key) !== 'BEN-21' || clean(pointerIssue?.fields?.summary) !== POINTER_SUMMARY) {
    return { selectedNext: null, pointerError: 'BEN-21 identity is invalid or unavailable.' };
  }
  if (pointerIssue?.fields?.issuetype?.subtask !== true) {
    return { selectedNext: null, pointerError: 'BEN-21 must remain the permanent Subtask pointer.' };
  }
  const forbiddenPointerLabels = [...lowerLabels(pointerIssue)].filter(label => POINTER_FORBIDDEN_LABELS.has(label));
  if (forbiddenPointerLabels.length) {
    return { selectedNext: null, pointerError: 'BEN-21 must not carry registry labels.' };
  }
  const parentKey = clean(pointerIssue?.fields?.parent?.key);
  if (!parentKey) return { selectedNext: null, pointerError: 'BEN-21 Parent is missing.' };
  const target = runs.find(run => run.key === parentKey);
  if (!target || !ELIGIBLE_NEXT_STATUSES.has(target.status)) {
    return { selectedNext: null, pointerError: 'BEN-21 Parent does not identify an eligible Preparing, Blocked, or Running registry item.' };
  }
  return { selectedNext: target, pointerError: '' };
}

export function projectBenchmarkRegistry(issues, {
  pointerIssue = null,
  pointerMatches = [],
  sourceKey = 'BEN',
  sourceLabel = 'Jira-native BEN registry'
} = {}) {
  if (!Array.isArray(issues)) {
    return { state: 'unavailable', authority: 'jira-native', sourceKey, sourceLabel, updatedAt: '', pointerUpdatedAt: '', message: 'BEN registry query did not return an issue array.' };
  }

  const eligibleIssues = issues.filter(issue => !EXCLUDED_REGISTRY_KEYS.has(clean(issue?.key)));
  const projected = eligibleIssues.map(classifyIssue);
  const invalidRecords = projected
    .filter(record => record.errors.length)
    .map(record => ({ key: record.key, title: record.title, reasons: [...record.errors] }));
  const valid = projected.filter(record => !record.errors.length);
  const runs = valid.filter(record => record.status !== 'Unused' || !record.ideaCategory);
  const considered = valid.filter(record => record.status === 'Unused' && record.ideaCategory === 'considered');
  const fresh = valid.filter(record => record.status === 'Unused' && record.ideaCategory === 'fresh');
  const { selectedNext, pointerError } = resolveSelectedNext(pointerIssue, pointerMatches, runs);
  const pointerUpdatedAt = clean(pointerIssue?.fields?.updated);

  return {
    state: 'ready',
    authority: 'jira-native',
    sourceKey,
    sourceLabel,
    updatedAt: maxUpdatedAt([...eligibleIssues.map(issue => issue?.fields?.updated), pointerUpdatedAt]),
    pointerUpdatedAt,
    selectedNext,
    pointerError,
    invalidRecords,
    runs,
    previouslyConsidered: considered.map(record => ({ key: record.key, title: record.title, detail: '', updatedAt: record.updatedAt })),
    freshBacklog: fresh.length ? [{
      group: 'Fresh idea backlog',
      ideas: fresh.map(record => ({ key: record.key, title: record.title, detail: '', updatedAt: record.updatedAt }))
    }] : []
  };
}
