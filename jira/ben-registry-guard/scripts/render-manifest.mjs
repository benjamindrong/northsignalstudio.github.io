import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FIELD_SCHEMA, buildJiraValidationExpression } from '../src/contract-definition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../manifest.yml');

function indent(text, spaces) {
  const prefix = ' '.repeat(spaces);
  return text.split('\n').map(line => prefix + line).join('\n');
}

function yamlSchema(schema, spaces = 8) {
  const pad = ' '.repeat(spaces);
  const child = ' '.repeat(spaces + 2);
  const lines = [];
  for (const [key, value] of Object.entries(schema)) {
    if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      for (const item of value) lines.push(`${child}- ${JSON.stringify(item)}`);
    } else if (value && typeof value === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(yamlSchema(value, spaces + 2));
    } else {
      lines.push(`${pad}${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

export function renderManifest(appId = '${APP_ID}') {
  const expression = buildJiraValidationExpression();
  return `app:
  id: "ari:cloud:ecosystem::app/${appId}"
  runtime:
    name: nodejs22.x

modules:
  jira:customField:
    - key: ben-registry-record
      name: BEN Registry Record
      description: Canonical validated BEN registry state.
      type: object
      schema:
${yamlSchema(FIELD_SCHEMA, 8)}
      view:
        formatter:
          expression: "value == null ? '' : value.lifecycle + ' · ' + (value.activityKind == null ? (value.ideaCategory == null ? 'Registry' : 'Idea ' + value.ideaCategory) : value.activityKind)"
      edit:
        experience:
          - issue-create
          - issue-view
          - issue-transition
        validation:
          expression: |-
${indent(expression, 12)}
          errorMessage: BEN Registry Record is invalid.

permissions:
  scopes:
    - read:jira-work
`;
}

const rendered = renderManifest();
if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8');
  if (current !== rendered) {
    console.error('manifest.yml is not generated from the current contract.');
    process.exit(1);
  }
} else {
  await writeFile(target, rendered, 'utf8');
}
