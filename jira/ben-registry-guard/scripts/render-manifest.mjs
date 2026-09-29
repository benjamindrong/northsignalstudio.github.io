import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildJiraValidationExpression } from '../src/contract-definition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../manifest.yml');

function indent(text, spaces) {
  const prefix = ' '.repeat(spaces);
  return text.split('\n').map(line => prefix + line).join('\n');
}

export function renderManifest() {
  const fieldExpression = buildJiraValidationExpression({
    recordExpression: 'value',
    lifecycleExpression: "(issue == null || issue.id == null) ? 'Unused' : issue.status.name"
  });

  const transitionExpression = buildJiraValidationExpression({
    recordExpression: "issue['${BEN_REGISTRY_FIELD_KEY}']",
    lifecycleExpression: 'transition.to.name'
  });

  return `app:
  id: "ari:cloud:ecosystem::app/${APP_ID}"
  runtime:
    name: nodejs22.x

environment:
  variables:
    - APP_ID
    - BEN_REGISTRY_FIELD_KEY
    - BEN_REGISTRY_ISSUE_TYPE_ID
    - BEN_REGISTRY_MIGRATION_KEYS

modules:
  jira:customField:
    - key: ben-registry-record
      name: BEN Registry Record
      description: Canonical validated BEN registry metadata.
      type: object
      schema:
        properties:
          version:
            type: integer
          activityKind:
            type: string
          ideaCategory:
            type: string
          result:
            type: object
            properties:
              mode:
                type: string
              outcome:
                type: string
              scores:
                type: string
              signal:
                type: string
          sourceKey:
            type: string
        required:
          - version
      view:
        formatter:
          expression: "value == null ? '' : (value.activityKind == null ? 'Idea' : value.activityKind) + (value.sourceKey == null ? '' : ' · ' + value.sourceKey)"
      edit:
        experience:
          - issue-create
          - issue-view
        validation:
          expression: |-
${indent(fieldExpression, 12)}
          errorMessage: BEN Registry Record is invalid for the current lifecycle.

  jira:workflowValidator:
    - key: ben-registry-transition-validator
      name: BEN registry lifecycle validator
      description: Rejects lifecycle transitions whose destination state would violate the BEN registry contract.
      projectTypes:
        - team-managed
      expression: |-
${indent(transitionExpression, 8)}
      errorMessage: BEN registry state is invalid for the destination lifecycle.

  jira:actionValidator:
    - key: ben-registry-type-validator
      action: workItemTypeChanged
      expression: "newIssueType != '${BEN_REGISTRY_ISSUE_TYPE_ID}' || '${BEN_REGISTRY_MIGRATION_KEYS}'.split(',').includes(issue.key)"
      errorMessage: Conversion into the BEN registry work type is disabled outside the migration allowlist.

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
