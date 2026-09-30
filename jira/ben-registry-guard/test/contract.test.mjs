import assert from 'node:assert/strict';
import test from 'node:test';
import { FIELD_SCHEMA, validateRegistryRecord, validateRegistryMutation, buildJiraValidationExpression } from '../src/contract-definition.mjs';
import { renderManifest } from '../scripts/render-manifest.mjs';
import { planMigration } from '../scripts/plan-migration.mjs';

const source = { key: 'HOME-1', projectKey: 'HOME' };
const resolveSource = key => key === 'HOME-1' ? { projectKey: 'HOME' } : null;
const completedAt = '2026-09-29T22:00:00.000Z';
const candidate = lifecycle => ({ version: 1, lifecycle, activityKind: 'candidate-evaluation', source, ...(lifecycle === 'Completed' ? { completedAt } : {}) });

test('registry participation requires one valid canonical record', () => {
  assert.equal(validateRegistryRecord(null).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused' }).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused', ideaCategory: 'fresh' }).ok, true);
});

test('active states require one activity and no idea category', () => {
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Running', activityKind: 'failure-evaluation' }).ok, true);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Running', ideaCategory: 'fresh' }).ok, false);
});

test('lifecycle/activity/idea/result contract matrix has no unclassified combination', () => {
  const lifecycles = ['Unused', 'Preparing', 'Blocked', 'Running', 'Completed', 'Retired'];
  const activities = [null, 'candidate-evaluation', 'failure-evaluation', 'benchmark-testing', 'uiux-discovery'];
  const ideas = [null, 'considered', 'fresh'];
  const results = [
    null,
    { mode: 'unknown' },
    { mode: 'summary', outcome: 'A', scores: '1-0', signal: 'Clear' }
  ];

  let checked = 0;
  for (const lifecycle of lifecycles) {
    for (const activityKind of activities) {
      for (const ideaCategory of ideas) {
        for (const result of results) {
          const record = { version: 1, lifecycle };
          if (activityKind) record.activityKind = activityKind;
          if (ideaCategory) record.ideaCategory = ideaCategory;
          if (result) record.result = result;
          if (lifecycle === 'Completed') record.completedAt = completedAt;

          const expected = lifecycle === 'Unused'
            ? (Boolean(activityKind || ideaCategory) && result == null)
            : (
              activityKind != null
              && ideaCategory == null
              && (
                result == null
                  ? !(lifecycle === 'Completed' && activityKind === 'candidate-evaluation')
                  : lifecycle === 'Completed' && activityKind === 'candidate-evaluation'
              )
            );

          assert.equal(
            validateRegistryRecord(record).ok,
            expected,
            `Unexpected contract result for ${JSON.stringify(record)}`
          );
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 270);
});

test('candidate result is completed-only', () => {
  const result = { mode: 'summary', outcome: 'A', scores: '1-0', signal: 'Clear' };
  assert.equal(validateRegistryRecord({ ...candidate('Running'), result }, { resolveSource }).ok, false);
  assert.equal(validateRegistryRecord(candidate('Completed'), { resolveSource }).ok, false);
  assert.equal(validateRegistryRecord({ ...candidate('Completed'), result }, { resolveSource }).ok, true);
  assert.equal(validateRegistryRecord({ ...candidate('Completed'), result: { mode: 'unknown' } }, { resolveSource }).ok, true);
  assert.equal(validateRegistryRecord({ ...candidate('Completed'), result: { mode: 'unknown', outcome: null } }, { resolveSource }).ok, false);
});

test('notable finding is completed-only', () => {
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Running', activityKind: 'failure-evaluation', notableFinding: 'x' }).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Completed', activityKind: 'failure-evaluation', notableFinding: 'x', completedAt }).ok, true);
});

test('completed timestamp is required and immutable while completed', () => {
  const record = { version: 1, lifecycle: 'Completed', activityKind: 'failure-evaluation', completedAt };
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Completed', activityKind: 'failure-evaluation' }).ok, false);
  assert.equal(validateRegistryRecord(record).ok, true);
  assert.equal(validateRegistryRecord({ ...record, completedAt: '2026-09-29T23:00:00.000Z' }, { previousRecord: record }).ok, false);
});

test('source is validated when new and retained historically when unchanged', () => {
  const record = { version: 1, lifecycle: 'Preparing', activityKind: 'failure-evaluation', source };
  assert.equal(validateRegistryRecord(record).ok, false, 'new source requires resolution');
  assert.equal(validateRegistryRecord(record, { resolveSource }).ok, true);
  assert.equal(validateRegistryRecord(record, { previousRecord: record, resolveSource: () => null }).ok, true, 'unchanged source does not re-resolve');
  assert.equal(validateRegistryRecord({ ...record, source: { key: 'BEN-2', projectKey: 'BEN' } }, { previousRecord: record, resolveSource }).ok, false);
  assert.equal(validateRegistryRecord({ ...record, source: { key: 'HOME-404', projectKey: 'HOME' } }, { previousRecord: record, resolveSource }).ok, false);
});

test('null, unknown, and destructive-clearing mutations are rejected', () => {
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused', ideaCategory: null, activityKind: 'failure-evaluation' }).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused', ideaCategory: 'fresh', source: null }).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused', ideaCategory: 'fresh', extra: true }).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Completed', activityKind: 'candidate-evaluation', completedAt, result: { mode: 'unknown', extra: true } }).ok, false);
  assert.equal(validateRegistryMutation(null, { previousRecord: null }).ok, true, 'absence remains valid non-registry state');
  assert.equal(validateRegistryMutation(null, { previousRecord: { version: 1, lifecycle: 'Unused', ideaCategory: 'fresh' } }).ok, false, 'existing registry state cannot be silently cleared');
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused', ideaCategory: 'fresh' }, { projectKey: 'HOME' }).ok, false, 'registry records cannot exist outside BEN');
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused', ideaCategory: 'fresh' }, { issueKey: 'BEN-21' }).ok, false, 'BEN-21 cannot become a registry participant');
  assert.equal(FIELD_SCHEMA.additionalProperties, false);
  assert.equal(FIELD_SCHEMA.properties.result.additionalProperties, false);
  assert.equal(FIELD_SCHEMA.properties.source.additionalProperties, false);
});

test('one contract generates the Forge expression and manifest', () => {
  const expression = buildJiraValidationExpression();
  assert.match(expression, /issue\?\.\[fieldId\]/);
  assert.match(expression, /sameSource/);
  assert.match(expression, /r == null \? p == null/);
  assert.match(expression, /project\.key == 'BEN'/);
  assert.match(expression, /BEN-21/);
  assert.match(expression, /new Issue\(r\.source\.key\)/);
  const manifest = renderManifest();
  assert.match(manifest, /nodejs22\.x/);
  assert.match(manifest, /additionalProperties: false/);
  assert.doesNotMatch(manifest, /jira:workflowValidator/);
  assert.doesNotMatch(manifest, /jira:actionValidator/);
  assert.doesNotMatch(manifest, /issue-bulk-edit/);
  assert.doesNotMatch(manifest, /edit:\s*[\s\S]*parser:/, 'CSV/object parser must not be enabled implicitly.');
});


function legacyIssue(key, labels, category, {
  description = '',
  completedAt = '',
  links = []
} = {}) {
  return {
    key,
    fields: {
      summary: `${key} summary`,
      labels,
      status: { statusCategory: { key: category } },
      project: { key: 'BEN' },
      updated: '2026-09-29T22:00:00.000Z',
      statuscategorychangedate: completedAt,
      description,
      issuelinks: links
    }
  };
}

test('migration plan is deterministic and fails closed on ambiguous legacy state', () => {
  const valid = legacyIssue('BEN-8', ['failure-evaluation'], 'indeterminate');
  const plan = planMigration([valid]);
  assert.equal(plan.schema, 'home55.ben-registry-migration.v1');
  assert.equal(plan.records[0].key, 'BEN-8');
  assert.deepEqual(plan.records[0].record, {
    version: 1,
    lifecycle: 'Running',
    activityKind: 'failure-evaluation'
  });
  assert.equal(plan.records[0].parity.ok, true);
  assert.deepEqual(plan.records[0].parity.checkedFields, [
    'status',
    'activityKind',
    'ideaCategory',
    'resultState',
    'resultLines',
    'notableFinding',
    'completedAt',
    'source',
    'sourceKey'
  ]);

  const invalid = legacyIssue('BEN-9', ['failure-evaluation', 'registry-idea'], 'indeterminate');
  assert.throws(() => planMigration([invalid]), /Migration blocked/);
  assert.throws(() => planMigration([valid, valid]), /duplicate Jira keys/);
});
