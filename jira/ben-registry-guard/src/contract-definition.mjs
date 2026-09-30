export const CONTRACT_VERSION = 1;

export const LIFECYCLES = Object.freeze([
  'Unused',
  'Preparing',
  'Blocked',
  'Running',
  'Completed',
  'Retired'
]);

export const ACTIVITY_KINDS = Object.freeze([
  'candidate-evaluation',
  'failure-evaluation',
  'benchmark-testing',
  'uiux-discovery'
]);

export const IDEA_CATEGORIES = Object.freeze(['considered', 'fresh']);
export const RESULT_MODES = Object.freeze(['unknown', 'summary']);

export const FIELD_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'lifecycle'],
  properties: {
    version: { type: 'integer', enum: [CONTRACT_VERSION] },
    lifecycle: { type: 'string', enum: [...LIFECYCLES] },
    activityKind: { type: 'string', enum: [...ACTIVITY_KINDS] },
    ideaCategory: { type: 'string', enum: [...IDEA_CATEGORIES] },
    result: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: [...RESULT_MODES] },
        outcome: { type: 'string', minLength: 1, maxLength: 500 },
        scores: { type: 'string', minLength: 1, maxLength: 500 },
        signal: { type: 'string', minLength: 1, maxLength: 1000 }
      }
    },
    notableFinding: { type: 'string', minLength: 1, maxLength: 2000 },
    completedAt: { type: 'string', format: 'date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$', minLength: 24, maxLength: 24 },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'projectKey'],
      properties: {
        key: { type: 'string', pattern: '^[A-Z][A-Z0-9]+-[0-9]+$' },
        projectKey: { type: 'string', pattern: '^[A-Z][A-Z0-9]+$' }
      }
    }
  }
});

const SOURCE_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9]+$/;
const COMPLETED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function ownKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

function exactKeys(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ownKeys(value);
  return keys.every(key => allowed.includes(key)) && required.every(key => keys.includes(key));
}

function nonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optionalNonNull(record, key) {
  return !hasOwn(record, key) || record[key] !== null;
}

function validShape(record) {
  if (!exactKeys(record, ['version', 'lifecycle', 'activityKind', 'ideaCategory', 'result', 'notableFinding', 'completedAt', 'source'], ['version', 'lifecycle'])) return false;
  if (record.version !== CONTRACT_VERSION || !LIFECYCLES.includes(record.lifecycle)) return false;
  for (const key of ['activityKind', 'ideaCategory', 'result', 'notableFinding', 'completedAt', 'source']) {
    if (!optionalNonNull(record, key)) return false;
  }
  if (record.activityKind != null && !ACTIVITY_KINDS.includes(record.activityKind)) return false;
  if (record.ideaCategory != null && !IDEA_CATEGORIES.includes(record.ideaCategory)) return false;
  if (record.notableFinding != null && !nonEmptyString(record.notableFinding, 2000)) return false;
  if (record.completedAt != null && (!COMPLETED_AT.test(record.completedAt) || Number.isNaN(Date.parse(record.completedAt)))) return false;

  if (record.result != null) {
    if (!exactKeys(record.result, ['mode', 'outcome', 'scores', 'signal'], ['mode'])) return false;
    if (!RESULT_MODES.includes(record.result.mode)) return false;
    if (record.result.mode === 'unknown') {
      if ('outcome' in record.result || 'scores' in record.result || 'signal' in record.result) return false;
    } else {
      if (!nonEmptyString(record.result.outcome, 500)) return false;
      if (!nonEmptyString(record.result.scores, 500)) return false;
      if (!nonEmptyString(record.result.signal, 1000)) return false;
    }
  }

  if (record.source != null) {
    if (!exactKeys(record.source, ['key', 'projectKey'], ['key', 'projectKey'])) return false;
    if (!SOURCE_KEY.test(record.source.key) || !PROJECT_KEY.test(record.source.projectKey)) return false;
  }

  return true;
}

function sourceEqual(a, b) {
  if (a == null && b == null) return true;
  return a?.key === b?.key && a?.projectKey === b?.projectKey;
}

function validateSource(record, previousRecord, resolveSource) {
  if (record.source == null) return true;
  if (record.source.projectKey === 'BEN') return false;
  if (previousRecord && sourceEqual(record.source, previousRecord.source)) return true;
  if (typeof resolveSource !== 'function') return false;
  const resolved = resolveSource(record.source.key);
  return Boolean(resolved && resolved.projectKey === record.source.projectKey && resolved.projectKey !== 'BEN');
}

function semanticValid(record) {
  const { lifecycle, activityKind = null, ideaCategory = null, result = null, notableFinding = null, completedAt = null } = record;

  if (lifecycle === 'Unused') {
    if (activityKind == null && ideaCategory == null) return false;
    if (result != null || notableFinding != null || completedAt != null) return false;
  } else {
    if (activityKind == null || ideaCategory != null) return false;
  }

  if (result != null && !(lifecycle === 'Completed' && activityKind === 'candidate-evaluation')) return false;
  if (lifecycle === 'Completed' && activityKind === 'candidate-evaluation' && result == null) return false;
  if (notableFinding != null && lifecycle !== 'Completed') return false;
  if (lifecycle === 'Completed' ? completedAt == null : completedAt != null) return false;

  return true;
}

export function validateRegistryRecord(record, { previousRecord = null, resolveSource, issueKey = '', projectKey = 'BEN' } = {}) {
  if (projectKey !== 'BEN') return { ok: false, errors: ['BEN Registry Record is only valid in BEN.'] };
  if (issueKey === 'BEN-21') return { ok: false, errors: ['BEN-21 is the registry pointer and cannot be a registry participant.'] };
  if (!validShape(record)) return { ok: false, errors: ['Record shape is invalid.'] };
  if (!semanticValid(record)) return { ok: false, errors: ['Record state is invalid.'] };
  if (previousRecord?.lifecycle === 'Completed' && record.lifecycle === 'Completed' && record.completedAt !== previousRecord.completedAt) return { ok: false, errors: ['Completed timestamp is immutable while remaining Completed.'] };
  if (!validateSource(record, previousRecord, resolveSource)) return { ok: false, errors: ['Source identity is invalid.'] };
  return { ok: true, errors: [] };
}

export function validateRegistryMutation(record, { previousRecord = null, resolveSource, issueKey = '', projectKey = 'BEN' } = {}) {
  if (record == null) {
    return previousRecord == null
      ? { ok: true, errors: [] }
      : { ok: false, errors: ['Existing registry participation cannot be cleared. Use lifecycle Retired instead.'] };
  }
  return validateRegistryRecord(record, { previousRecord, resolveSource, issueKey, projectKey });
}

function q(values) {
  return values.map(value => `'${value}'`).join(', ');
}

export function buildJiraValidationExpression() {
  return [
    'let r = value;',
    'let p = issue?.[fieldId];',
    "let projectSafe = project.key == 'BEN';",
    "let pointerSafe = issue?.key != 'BEN-21';",
    `let lifecycles = [${q(LIFECYCLES)}];`,
    `let activities = [${q(ACTIVITY_KINDS)}];`,
    `let ideas = [${q(IDEA_CATEGORIES)}];`,
    `let resultModes = [${q(RESULT_MODES)}];`,
    "let validResult = r?.result == null || (resultModes.includes(r.result.mode) && (r.result.mode == 'unknown' ? r.result.outcome == null && r.result.scores == null && r.result.signal == null : r.result.outcome != null && r.result.outcome.trim().length > 0 && r.result.outcome.length <= 500 && r.result.scores != null && r.result.scores.trim().length > 0 && r.result.scores.length <= 500 && r.result.signal != null && r.result.signal.trim().length > 0 && r.result.signal.length <= 1000));",
    "let validUnused = r?.lifecycle != 'Unused' || ((r.activityKind != null || r.ideaCategory != null) && r.result == null && r.notableFinding == null);",
    "let validActive = r?.lifecycle == 'Unused' || (r.activityKind != null && r.ideaCategory == null);",
    "let validResultOwner = r?.result == null || (r.lifecycle == 'Completed' && r.activityKind == 'candidate-evaluation');",
    "let completedCandidateHasResult = r?.lifecycle != 'Completed' || r.activityKind != 'candidate-evaluation' || r.result != null;",
    "let findingOnlyCompleted = r?.notableFinding == null || (r.lifecycle == 'Completed' && r.notableFinding.trim().length > 0 && r.notableFinding.length <= 2000);",
    "let completedTimestamp = r?.lifecycle == 'Completed' ? r.completedAt != null && r.completedAt.length == 24 : r?.completedAt == null;",
    "let stableCompletedTimestamp = p?.lifecycle != 'Completed' || r?.lifecycle != 'Completed' || p.completedAt == r.completedAt;",
    "let sameSource = r?.source == null ? p?.source == null : p?.source != null && r.source.key == p.source.key && r.source.projectKey == p.source.projectKey;",
    "let loadedSource = r?.source == null || sameSource ? null : new Issue(r.source.key);",
    "let validSource = r?.source == null || (r.source.projectKey != 'BEN' && (sameSource || (loadedSource != null && loadedSource.project.key == r.source.projectKey)));",
    `r == null ? p == null : (projectSafe && pointerSafe && r.version == ${CONTRACT_VERSION} && lifecycles.includes(r.lifecycle) && (r.activityKind == null || activities.includes(r.activityKind)) && (r.ideaCategory == null || ideas.includes(r.ideaCategory)) && validResult && validUnused && validActive && validResultOwner && completedCandidateHasResult && findingOnlyCompleted && completedTimestamp && stableCompletedTimestamp && validSource)`
  ].join('\n');
}
, minLength: 24, maxLength: 24 },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'projectKey'],
      properties: {
        key: { type: 'string', pattern: '^[A-Z][A-Z0-9]+-[0-9]+$' },
        projectKey: { type: 'string', pattern: '^[A-Z][A-Z0-9]+$' }
      }
    }
  }
});

const SOURCE_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9]+$/;

function ownKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

function exactKeys(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ownKeys(value);
  return keys.every(key => allowed.includes(key)) && required.every(key => keys.includes(key));
}

function nonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function validShape(record) {
  if (!exactKeys(record, ['version', 'lifecycle', 'activityKind', 'ideaCategory', 'result', 'notableFinding', 'completedAt', 'source'], ['version', 'lifecycle'])) return false;
  if (record.version !== CONTRACT_VERSION || !LIFECYCLES.includes(record.lifecycle)) return false;
  if (record.activityKind != null && !ACTIVITY_KINDS.includes(record.activityKind)) return false;
  if (record.ideaCategory != null && !IDEA_CATEGORIES.includes(record.ideaCategory)) return false;
  if (record.notableFinding != null && !nonEmptyString(record.notableFinding, 2000)) return false;
  if (record.completedAt != null && (!nonEmptyString(record.completedAt, 40) || Number.isNaN(Date.parse(record.completedAt)))) return false;

  if (record.result != null) {
    if (!exactKeys(record.result, ['mode', 'outcome', 'scores', 'signal'], ['mode'])) return false;
    if (!RESULT_MODES.includes(record.result.mode)) return false;
    if (record.result.mode === 'unknown') {
      if ('outcome' in record.result || 'scores' in record.result || 'signal' in record.result) return false;
    } else {
      if (!nonEmptyString(record.result.outcome, 500)) return false;
      if (!nonEmptyString(record.result.scores, 500)) return false;
      if (!nonEmptyString(record.result.signal, 1000)) return false;
    }
  }

  if (record.source != null) {
    if (!exactKeys(record.source, ['key', 'projectKey'], ['key', 'projectKey'])) return false;
    if (!SOURCE_KEY.test(record.source.key) || !PROJECT_KEY.test(record.source.projectKey)) return false;
  }

  return true;
}

function sourceEqual(a, b) {
  if (a == null && b == null) return true;
  return a?.key === b?.key && a?.projectKey === b?.projectKey;
}

function validateSource(record, previousRecord, resolveSource) {
  if (record.source == null) return true;
  if (record.source.projectKey === 'BEN') return false;
  if (previousRecord && sourceEqual(record.source, previousRecord.source)) return true;
  if (typeof resolveSource !== 'function') return false;
  const resolved = resolveSource(record.source.key);
  return Boolean(resolved && resolved.projectKey === record.source.projectKey && resolved.projectKey !== 'BEN');
}

function semanticValid(record) {
  const { lifecycle, activityKind = null, ideaCategory = null, result = null, notableFinding = null, completedAt = null } = record;

  if (lifecycle === 'Unused') {
    if (activityKind == null && ideaCategory == null) return false;
    if (result != null || notableFinding != null || completedAt != null) return false;
  } else {
    if (activityKind == null || ideaCategory != null) return false;
  }

  if (result != null && !(lifecycle === 'Completed' && activityKind === 'candidate-evaluation')) return false;
  if (lifecycle === 'Completed' && activityKind === 'candidate-evaluation' && result == null) return false;
  if (notableFinding != null && lifecycle !== 'Completed') return false;
  if (lifecycle === 'Completed' ? completedAt == null : completedAt != null) return false;

  return true;
}

export function validateRegistryRecord(record, { previousRecord = null, resolveSource } = {}) {
  if (!validShape(record)) return { ok: false, errors: ['Record shape is invalid.'] };
  if (!semanticValid(record)) return { ok: false, errors: ['Record state is invalid.'] };
  if (previousRecord?.lifecycle === 'Completed' && record.lifecycle === 'Completed' && record.completedAt !== previousRecord.completedAt) return { ok: false, errors: ['Completed timestamp is immutable while remaining Completed.'] };
  if (!validateSource(record, previousRecord, resolveSource)) return { ok: false, errors: ['Source identity is invalid.'] };
  return { ok: true, errors: [] };
}

function q(values) {
  return values.map(value => `'${value}'`).join(', ');
}

export function buildJiraValidationExpression() {
  return [
    'let r = value;',
    'let p = issue?.[fieldId];',
    `let lifecycles = [${q(LIFECYCLES)}];`,
    `let activities = [${q(ACTIVITY_KINDS)}];`,
    `let ideas = [${q(IDEA_CATEGORIES)}];`,
    `let resultModes = [${q(RESULT_MODES)}];`,
    "let validResult = r?.result == null || (resultModes.includes(r.result.mode) && (r.result.mode == 'unknown' ? r.result.outcome == null && r.result.scores == null && r.result.signal == null : r.result.outcome != null && r.result.outcome.trim().length > 0 && r.result.outcome.length <= 500 && r.result.scores != null && r.result.scores.trim().length > 0 && r.result.scores.length <= 500 && r.result.signal != null && r.result.signal.trim().length > 0 && r.result.signal.length <= 1000));",
    "let validUnused = r?.lifecycle != 'Unused' || ((r.activityKind != null || r.ideaCategory != null) && r.result == null && r.notableFinding == null);",
    "let validActive = r?.lifecycle == 'Unused' || (r.activityKind != null && r.ideaCategory == null);",
    "let validResultOwner = r?.result == null || (r.lifecycle == 'Completed' && r.activityKind == 'candidate-evaluation');",
    "let completedCandidateHasResult = r?.lifecycle != 'Completed' || r.activityKind != 'candidate-evaluation' || r.result != null;",
    "let findingOnlyCompleted = r?.notableFinding == null || (r.lifecycle == 'Completed' && r.notableFinding.trim().length > 0 && r.notableFinding.length <= 2000);",
    "let completedTimestamp = r?.lifecycle == 'Completed' ? r.completedAt != null && r.completedAt.length >= 20 && r.completedAt.length <= 40 : r?.completedAt == null;",
    "let stableCompletedTimestamp = p?.lifecycle != 'Completed' || r?.lifecycle != 'Completed' || p.completedAt == r.completedAt;",
    "let sameSource = r?.source == null ? p?.source == null : p?.source != null && r.source.key == p.source.key && r.source.projectKey == p.source.projectKey;",
    "let loadedSource = r?.source == null || sameSource ? null : new Issue(r.source.key);",
    "let validSource = r?.source == null || (r.source.projectKey != 'BEN' && (sameSource || (loadedSource != null && loadedSource.project.key == r.source.projectKey)));",
    `r != null && r.version == ${CONTRACT_VERSION} && lifecycles.includes(r.lifecycle) && (r.activityKind == null || activities.includes(r.activityKind)) && (r.ideaCategory == null || ideas.includes(r.ideaCategory)) && validResult && validUnused && validActive && validResultOwner && completedCandidateHasResult && findingOnlyCompleted && completedTimestamp && stableCompletedTimestamp && validSource`
  ].join('\n');
}
