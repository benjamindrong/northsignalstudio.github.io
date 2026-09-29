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

const SOURCE_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateResult(result) {
  if (!isObject(result) || !RESULT_MODES.includes(result.mode)) {
    return ['Result must use a supported result mode.'];
  }

  if (result.mode === 'unknown') {
    if ('outcome' in result || 'scores' in result || 'signal' in result) {
      return ['Unknown result mode cannot carry summary fields.'];
    }
    return [];
  }

  const errors = [];
  if (!nonEmptyString(result.outcome)) errors.push('Summary result requires outcome.');
  if (!nonEmptyString(result.scores)) errors.push('Summary result requires scores.');
  if (!nonEmptyString(result.signal)) errors.push('Summary result requires signal.');
  return errors;
}

export function validateRegistryRecord(record, lifecycle, { resolveSource } = {}) {
  const errors = [];

  if (!LIFECYCLES.includes(lifecycle)) {
    return { ok: false, errors: ['Lifecycle must be one of the supported BEN registry statuses.'] };
  }

  if (!isObject(record)) {
    return { ok: false, errors: ['BEN Registry Record is required.'] };
  }

  if (record.version !== CONTRACT_VERSION) {
    errors.push(`Record version must be ${CONTRACT_VERSION}.`);
  }

  const activityKind = record.activityKind ?? null;
  const ideaCategory = record.ideaCategory ?? null;
  const result = record.result ?? null;
  const sourceKey = record.sourceKey ?? null;

  if (activityKind !== null && !ACTIVITY_KINDS.includes(activityKind)) {
    errors.push('Activity kind is invalid.');
  }

  if (ideaCategory !== null && !IDEA_CATEGORIES.includes(ideaCategory)) {
    errors.push('Idea category is invalid.');
  }

  if (sourceKey !== null) {
    if (!nonEmptyString(sourceKey) || !SOURCE_KEY.test(sourceKey)) {
      errors.push('Source identity must be a Jira issue key.');
    } else if (sourceKey.startsWith('BEN-')) {
      errors.push('Source identity must point outside BEN.');
    } else if (resolveSource) {
      const source = resolveSource(sourceKey);
      if (!source) errors.push('Source identity does not resolve.');
      else if (source.projectKey === 'BEN') errors.push('Source identity must point outside BEN.');
    }
  }

  if (lifecycle === 'Unused') {
    if (activityKind === null && ideaCategory === null) {
      errors.push('Unused registry work requires an activity kind or idea category.');
    }
    if (result !== null) errors.push('Unused registry work cannot carry a result.');
  } else {
    if (activityKind === null) errors.push(`${lifecycle} registry work requires an activity kind.`);
    if (ideaCategory !== null) errors.push('Idea category is only valid for Unused registry work.');
  }

  if (activityKind !== 'candidate-evaluation' && result !== null) {
    errors.push('Only Candidate Evaluation may carry result data.');
  }

  if (activityKind === 'candidate-evaluation') {
    if (lifecycle === 'Completed' && result === null) {
      errors.push('Completed Candidate Evaluation requires a result.');
    }
    if (['Unused', 'Retired'].includes(lifecycle) && result !== null) {
      errors.push(`${lifecycle} Candidate Evaluation cannot carry a result.`);
    }
    if (result !== null) errors.push(...validateResult(result));
  }

  return { ok: errors.length === 0, errors };
}

function quoteList(values) {
  return values.map(value => `'${value}'`).join(', ');
}

export function buildJiraValidationExpression({ recordExpression, lifecycleExpression }) {
  const activities = quoteList(ACTIVITY_KINDS);
  const ideas = quoteList(IDEA_CATEGORIES);
  const lifecycles = quoteList(LIFECYCLES);
  const resultModes = quoteList(RESULT_MODES);

  return [
    `let r = ${recordExpression};`,
    `let l = ${lifecycleExpression};`,
    `let activities = [${activities}];`,
    `let ideas = [${ideas}];`,
    `let lifecycles = [${lifecycles}];`,
    `let resultModes = [${resultModes}];`,
    `let source = r != null && r.sourceKey != null ? new Issue(r.sourceKey) : null;`,
    `let base = r != null && r.version == ${CONTRACT_VERSION} && lifecycles.includes(l) && (r.activityKind == null || activities.includes(r.activityKind)) && (r.ideaCategory == null || ideas.includes(r.ideaCategory)) && (r.sourceKey == null || (source != null && source.project.key != 'BEN'));`,
    `let resultShape = r == null || r.result == null || (resultModes.includes(r.result.mode) && (r.result.mode == 'unknown' ? r.result.outcome == null && r.result.scores == null && r.result.signal == null : r.result.outcome != null && r.result.outcome.trim().length > 0 && r.result.scores != null && r.result.scores.trim().length > 0 && r.result.signal != null && r.result.signal.trim().length > 0));`,
    `let unused = l != 'Unused' || ((r.activityKind != null || r.ideaCategory != null) && r.result == null);`,
    `let active = l == 'Unused' || (r.activityKind != null && r.ideaCategory == null);`,
    `let resultOwner = r.result == null || r.activityKind == 'candidate-evaluation';`,
    `let candidateCompleted = r.activityKind != 'candidate-evaluation' || l != 'Completed' || r.result != null;`,
    `let candidateForbidden = r.activityKind != 'candidate-evaluation' || !['Unused', 'Retired'].includes(l) || r.result == null;`,
    `base && resultShape && unused && active && resultOwner && candidateCompleted && candidateForbidden`
  ].join('\n');
}
