import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTRACT_VERSION,
  validateRegistryRecord,
  buildJiraValidationExpression
} from '../src/contract-definition.mjs';
import { renderManifest } from '../scripts/render-manifest.mjs';

const base = {
  version: CONTRACT_VERSION,
  activityKind: 'candidate-evaluation',
  sourceKey: 'HOME-1'
};

test('invalid registry creation cannot exist', () => {
  assert.equal(validateRegistryRecord(null, 'Unused').ok, false);
  assert.equal(validateRegistryRecord({ version: CONTRACT_VERSION }, 'Unused').ok, false);
});

test('unused ideas and defined unused activities remain valid', () => {
  assert.equal(validateRegistryRecord({ version: CONTRACT_VERSION, ideaCategory: 'fresh' }, 'Unused').ok, true);
  assert.equal(validateRegistryRecord({ version: CONTRACT_VERSION, activityKind: 'failure-evaluation' }, 'Unused').ok, true);
});

test('active lifecycle requires activity and excludes idea category', () => {
  assert.equal(validateRegistryRecord({ version: CONTRACT_VERSION, ideaCategory: 'fresh' }, 'Running').ok, false);
  assert.equal(validateRegistryRecord({ version: CONTRACT_VERSION, activityKind: 'failure-evaluation' }, 'Running').ok, true);
});

test('candidate result can be staged before completion but is required at completion', () => {
  const summary = { mode: 'summary', outcome: 'A', scores: '1-0', signal: 'Clear' };
  assert.equal(validateRegistryRecord({ ...base, result: summary }, 'Running').ok, true);
  assert.equal(validateRegistryRecord(base, 'Completed').ok, false);
  assert.equal(validateRegistryRecord({ ...base, result: summary }, 'Completed').ok, true);
});

test('non-candidate activity cannot carry candidate result', () => {
  const record = {
    version: CONTRACT_VERSION,
    activityKind: 'failure-evaluation',
    result: { mode: 'unknown' }
  };
  assert.equal(validateRegistryRecord(record, 'Running').ok, false);
});

test('source identity must resolve outside BEN', () => {
  assert.equal(validateRegistryRecord({ ...base, sourceKey: 'BEN-2' }, 'Preparing').ok, false);
  assert.equal(validateRegistryRecord(base, 'Preparing', { resolveSource: () => null }).ok, false);
  assert.equal(validateRegistryRecord(base, 'Preparing', { resolveSource: () => ({ projectKey: 'HOME' }) }).ok, true);
});

test('manifest expressions are generated from the versioned contract', () => {
  const expression = buildJiraValidationExpression({
    recordExpression: "issue['FIELD']",
    lifecycleExpression: 'transition.to.name'
  });
  assert.match(expression, /candidate-evaluation/);
  assert.match(expression, /transition\.to\.name/);

  const manifest = renderManifest();
  assert.match(manifest, /jira:customField:/);
  assert.match(manifest, /jira:workflowValidator:/);
  assert.match(manifest, /jira:actionValidator:/);
  assert.match(manifest, /BEN_REGISTRY_FIELD_KEY/);
  assert.match(manifest, /BEN_REGISTRY_ISSUE_TYPE_ID/);
});
