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
    completedAt: {
      type: 'string',
      format: 'date-time',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
      minLength: 24,
      maxLength: 24
    },
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaTypeMatches(type, value) {
  if (type === 'object') return isObject(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return Number.isInteger(value);
  return false;
}

function schemaValid(schema, value) {
  if (!schemaTypeMatches(schema.type, value)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;

  if (schema.type === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) return false;
    if (schema.maxLength != null && value.length > schema.maxLength) return false;
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) return false;
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) return false;
    return true;
  }

  if (schema.type === 'integer') return true;

  const keys = Object.keys(value);
  const properties = schema.properties || {};
  if (schema.additionalProperties === false && keys.some(key => !(key in properties))) return false;
  if ((schema.required || []).some(key => !(key in value))) return false;
  for (const key of keys) {
    if (!properties[key] || !schemaValid(properties[key], value[key])) return false;
  }
  return true;
}

function sourceEqual(a, b) {
  if (a == null && b == null) return true;
  return a?.key === b?.key && a?.projectKey === b?.projectKey;
}

function validResult(record) {
  if (record.result == null) return true;
  if (record.result.mode === 'unknown') {
    return !('outcome' in record.result) && !('scores' in record.result) && !('signal' in record.result);
  }
  return record.result.mode === 'summary'
    && record.result.outcome.trim().length > 0
    && record.result.scores.trim().length > 0
    && record.result.signal.trim().length > 0;
}

function validSource(context) {
  const { record, previousRecord, resolveSource } = context;
  if (record.source == null) return true;
  if (record.source.projectKey === 'BEN') return false;
  if (!record.source.key.startsWith(`${record.source.projectKey}-`)) return false;
  if (previousRecord && sourceEqual(record.source, previousRecord.source)) return true;
  if (typeof resolveSource !== 'function') return false;
  const resolved = resolveSource(record.source.key);
  return Boolean(resolved && resolved.projectKey === record.source.projectKey && resolved.projectKey !== 'BEN');
}

const SEMANTIC_RULES = Object.freeze([
  {
    id: 'ben-project-only',
    local: ({ projectKey }) => projectKey === 'BEN',
    jira: "project.key == 'BEN'"
  },
  {
    id: 'pointer-excluded',
    local: ({ issueKey }) => issueKey !== 'BEN-21',
    jira: "issue?.key != 'BEN-21'"
  },
  {
    id: 'result-shape',
    local: ({ record }) => validResult(record),
    jira: "r.result == null || (r.result.mode == 'unknown' ? r.result.outcome == null && r.result.scores == null && r.result.signal == null : r.result.mode == 'summary' && r.result.outcome != null && r.result.outcome.trim().length > 0 && r.result.scores != null && r.result.scores.trim().length > 0 && r.result.signal != null && r.result.signal.trim().length > 0)"
  },
  {
    id: 'unused-state',
    local: ({ record }) => record.lifecycle !== 'Unused'
      || ((record.activityKind != null || record.ideaCategory != null)
        && record.result == null
        && record.notableFinding == null
        && record.completedAt == null),
    jira: "r.lifecycle != 'Unused' || ((r.activityKind != null || r.ideaCategory != null) && r.result == null && r.notableFinding == null && r.completedAt == null)"
  },
  {
    id: 'active-state',
    local: ({ record }) => record.lifecycle === 'Unused'
      || (record.activityKind != null && record.ideaCategory == null),
    jira: "r.lifecycle == 'Unused' || (r.activityKind != null && r.ideaCategory == null)"
  },
  {
    id: 'completed-only-result',
    local: ({ record }) => record.result == null
      || (record.lifecycle === 'Completed' && record.activityKind === 'candidate-evaluation'),
    jira: "r.result == null || (r.lifecycle == 'Completed' && r.activityKind == 'candidate-evaluation')"
  },
  {
    id: 'completed-candidate-requires-result',
    local: ({ record }) => record.lifecycle !== 'Completed'
      || record.activityKind !== 'candidate-evaluation'
      || record.result != null,
    jira: "r.lifecycle != 'Completed' || r.activityKind != 'candidate-evaluation' || r.result != null"
  },
  {
    id: 'completed-only-finding',
    local: ({ record }) => record.notableFinding == null
      || (record.lifecycle === 'Completed' && record.notableFinding.trim().length > 0),
    jira: "r.notableFinding == null || (r.lifecycle == 'Completed' && r.notableFinding.trim().length > 0)"
  },
  {
    id: 'completed-timestamp',
    local: ({ record }) => record.lifecycle === 'Completed'
      ? record.completedAt != null
      : record.completedAt == null,
    jira: "r.lifecycle == 'Completed' ? r.completedAt != null : r.completedAt == null"
  },
  {
    id: 'completed-timestamp-immutable',
    local: ({ record, previousRecord }) => previousRecord?.lifecycle !== 'Completed'
      || record.lifecycle !== 'Completed'
      || previousRecord.completedAt === record.completedAt,
    jira: "p?.lifecycle != 'Completed' || r.lifecycle != 'Completed' || p.completedAt == r.completedAt"
  },
  {
    id: 'source-valid',
    local: context => validSource(context),
    jira: "r.source == null || (r.source.projectKey != 'BEN' && r.source.key.indexOf(r.source.projectKey + '-') == 0 && (sameSource || (loadedSource != null && loadedSource.project.key == r.source.projectKey)))"
  }
]);

export const SEMANTIC_RULE_IDS = Object.freeze(SEMANTIC_RULES.map(rule => rule.id));

export function validateRegistryRecord(record, {
  previousRecord = null,
  resolveSource,
  issueKey = '',
  projectKey = 'BEN'
} = {}) {
  if (!schemaValid(FIELD_SCHEMA, record)) {
    return { ok: false, errors: ['Record shape is invalid.'] };
  }

  const context = { record, previousRecord, resolveSource, issueKey, projectKey };
  const failed = SEMANTIC_RULES.filter(rule => !rule.local(context)).map(rule => rule.id);
  return failed.length
    ? { ok: false, errors: failed.map(id => `Semantic rule failed: ${id}`) }
    : { ok: true, errors: [] };
}

export function validateRegistryMutation(record, options = {}) {
  if (record == null) {
    return options.previousRecord == null
      ? { ok: true, errors: [] }
      : { ok: false, errors: ['Existing registry participation cannot be cleared. Use lifecycle Retired instead.'] };
  }
  return validateRegistryRecord(record, options);
}

export function buildJiraValidationExpression() {
  const rules = SEMANTIC_RULES.map(rule => `(${rule.jira})`).join(' && ');
  return [
    'let r = value;',
    'let p = issue?.[fieldId];',
    "let sameSource = r?.source == null ? p?.source == null : p?.source != null && r.source.key == p.source.key && r.source.projectKey == p.source.projectKey;",
    "let loadedSource = r?.source == null || sameSource ? null : new Issue(r.source.key);",
    `r == null ? p == null : (${rules})`
  ].join('\n');
}
