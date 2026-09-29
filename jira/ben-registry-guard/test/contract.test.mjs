import assert from 'node:assert/strict';
import test from 'node:test';
import { FIELD_SCHEMA, validateRegistryRecord, buildJiraValidationExpression } from '../src/contract-definition.mjs';
import { renderManifest } from '../scripts/render-manifest.mjs';

const source = { key: 'HOME-1', projectKey: 'HOME' };
const resolveSource = key => key === 'HOME-1' ? { projectKey: 'HOME' } : null;
const candidate = lifecycle => ({ version: 1, lifecycle, activityKind: 'candidate-evaluation', source });

test('registry participation requires one valid canonical record', () => {
  assert.equal(validateRegistryRecord(null).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused' }).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused', ideaCategory: 'fresh' }).ok, true);
});

test('active states require one activity and no idea category', () => {
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Running', activityKind: 'failure-evaluation' }).ok, true);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Running', ideaCategory: 'fresh' }).ok, false);
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
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Completed', activityKind: 'failure-evaluation', notableFinding: 'x' }).ok, true);
});

test('source is validated when new and retained historically when unchanged', () => {
  const record = { version: 1, lifecycle: 'Preparing', activityKind: 'failure-evaluation', source };
  assert.equal(validateRegistryRecord(record).ok, false, 'new source requires resolution');
  assert.equal(validateRegistryRecord(record, { resolveSource }).ok, true);
  assert.equal(validateRegistryRecord(record, { previousRecord: record, resolveSource: () => null }).ok, true, 'unchanged source does not re-resolve');
  assert.equal(validateRegistryRecord({ ...record, source: { key: 'BEN-2', projectKey: 'BEN' } }, { previousRecord: record, resolveSource }).ok, false);
  assert.equal(validateRegistryRecord({ ...record, source: { key: 'HOME-404', projectKey: 'HOME' } }, { previousRecord: record, resolveSource }).ok, false);
});

test('unknown properties are rejected at every schema level', () => {
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Unused', ideaCategory: 'fresh', extra: true }).ok, false);
  assert.equal(validateRegistryRecord({ version: 1, lifecycle: 'Completed', activityKind: 'candidate-evaluation', result: { mode: 'unknown', extra: true } }).ok, false);
  assert.equal(FIELD_SCHEMA.additionalProperties, false);
  assert.equal(FIELD_SCHEMA.properties.result.additionalProperties, false);
  assert.equal(FIELD_SCHEMA.properties.source.additionalProperties, false);
});

test('one contract generates the Forge expression and manifest', () => {
  const expression = buildJiraValidationExpression();
  assert.match(expression, /issue\?\.\[fieldId\]/);
  assert.match(expression, /sameSource/);
  assert.match(expression, /new Issue\(r\.source\.key\)/);
  const manifest = renderManifest();
  assert.match(manifest, /nodejs22\.x/);
  assert.match(manifest, /additionalProperties: false/);
  assert.doesNotMatch(manifest, /jira:workflowValidator/);
  assert.doesNotMatch(manifest, /jira:actionValidator/);
  assert.doesNotMatch(manifest, /issue-bulk-edit/);
});
