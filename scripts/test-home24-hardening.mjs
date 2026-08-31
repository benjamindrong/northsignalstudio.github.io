import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseCanonicalResultSummary, projectBenchmarkRegistry } from './benchmark-registry.mjs';

const POINTER_SUMMARY = 'Benchmark Registry Next Pointer';
const SELF = 'scripts/test-home24-hardening.mjs';
const WORKFLOW = '.github/workflows/refresh-jira-flight-control.yml';
const AUTHORITY_STATE_PATH = 'dashboard/benchmark-registry-authority.txt';

function text(value) { return { type: 'text', text: value }; }
function heading(level, value) { return { type: 'heading', attrs: { level }, content: [text(value)] }; }
function paragraph(value) { return { type: 'paragraph', content: [text(value)] }; }
function bullet(value) { return { type: 'listItem', content: [paragraph(value)] }; }

function canonicalSummary(extra = []) {
  return {
    type: 'doc',
    version: 1,
    content: [
      heading(3, 'Completion Artifact'),
      heading(4, 'Registry Result Summary'),
      { type: 'bulletList', content: [
        bullet('Outcome: Response B won.'),
        bullet('Scores: RA 8 / RB 9.'),
        bullet('Signal: State boundaries were preserved.')
      ] },
      ...extra
    ]
  };
}

const valid = parseCanonicalResultSummary(canonicalSummary());
assert.equal(valid.ok, true, valid.error);

const reorderedSummary = parseCanonicalResultSummary({
  type: 'doc', version: 1, content: [
    heading(3, 'Completion Artifact'), heading(4, 'Registry Result Summary'),
    { type: 'bulletList', content: [bullet('Scores: 9/8'), bullet('Outcome: B'), bullet('Signal: X')] }
  ]
});
assert.equal(reorderedSummary.ok, false);
assert.match(reorderedSummary.error, /in that order/i);

const lowerCaseSummary = parseCanonicalResultSummary({
  type: 'doc', version: 1, content: [
    heading(3, 'Completion Artifact'), heading(4, 'Registry Result Summary'),
    { type: 'bulletList', content: [bullet('outcome: B'), bullet('Scores: 9/8'), bullet('Signal: X')] }
  ]
});
assert.equal(lowerCaseSummary.ok, false);
assert.match(lowerCaseSummary.error, /exactly Outcome:/i);

const nestedDuplicateResult = parseCanonicalResultSummary(canonicalSummary([{
  type: 'panel', attrs: { panelType: 'info' },
  content: [heading(4, 'Registry Result Summary'), paragraph('Hidden competing result authority.')]
}]));
assert.equal(nestedDuplicateResult.ok, false);
assert.match(nestedDuplicateResult.error, /exactly one #### Registry Result Summary/i);

const nestedDuplicateArtifact = parseCanonicalResultSummary(canonicalSummary([{
  type: 'expand', attrs: { title: 'Older completion evidence' },
  content: [heading(3, 'Completion Artifact'), paragraph('Hidden competing artifact authority.')]
}]));
assert.equal(nestedDuplicateArtifact.ok, false);
assert.match(nestedDuplicateArtifact.error, /exactly one ### Completion Artifact/i);

const nestedCanonicalOnly = parseCanonicalResultSummary({
  type: 'doc', version: 1, content: [{
    type: 'panel', attrs: { panelType: 'info' }, content: [
      heading(3, 'Completion Artifact'), heading(4, 'Registry Result Summary'),
      { type: 'bulletList', content: [bullet('Outcome: B'), bullet('Scores: 9/8'), bullet('Signal: X')] }
    ]
  }]
});
assert.equal(nestedCanonicalOnly.ok, false);
assert.match(nestedCanonicalOnly.error, /top-level Description sections/i);

const unknownWithNestedSummary = projectBenchmarkRegistry([{
  key: 'BEN-90', fields: {
    summary: 'Unknown result fixture',
    labels: ['candidate-evaluation', 'registry-result-unknown'],
    status: { statusCategory: { key: 'done' } },
    project: { key: 'BEN' },
    updated: '2026-08-29T12:00:00.000Z',
    issuelinks: [],
    description: { type: 'doc', version: 1, content: [{
      type: 'panel', attrs: { panelType: 'warning' },
      content: [heading(4, 'Registry Result Summary'), paragraph('Competing result text.')]
    }] }
  }
}], { pointerIssue: null, pointerMatches: [] });
assert.equal(unknownWithNestedSummary.runs.length, 0);
assert.match(unknownWithNestedSummary.invalidRecords[0]?.reasons.join('\n') || '', /cannot contain a Registry Result Summary/i);

const pointerTarget = {
  key: 'BEN-91', fields: {
    summary: 'Pointer target', labels: ['candidate-evaluation'],
    status: { statusCategory: { key: 'new' } }, project: { key: 'BEN' },
    updated: '2026-08-29T12:00:00.000Z', issuelinks: []
  }
};
const pointerIssue = {
  key: 'BEN-21', fields: {
    summary: POINTER_SUMMARY, labels: [], issuetype: { name: 'Subtask', subtask: true },
    parent: { key: 'BEN-91' }, updated: '2026-08-29T12:01:00.000Z'
  }
};
const duplicateCasePointer = projectBenchmarkRegistry([pointerTarget], {
  pointerIssue,
  pointerMatches: [
    { key: 'BEN-21', fields: { summary: POINTER_SUMMARY } },
    { key: 'BEN-92', fields: { summary: 'benchmark   registry next pointer' } }
  ]
});
assert.equal(duplicateCasePointer.selectedNext, null);
assert.match(duplicateCasePointer.pointerError, /not the unique/i);

function trackedTextFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' });
  return output.toString('utf8').split('\0').filter(Boolean).flatMap(file => {
    let bytes;
    try { bytes = fs.readFileSync(file); } catch { return []; }
    if (bytes.includes(0)) return [];
    return [{ file, source: bytes.toString('utf8') }];
  });
}

function isDocumentation(file) {
  return /(?:^|\/)(?:docs?\/.*|[^/]+\.(?:md|markdown))$/i.test(file);
}

function isTest(file) {
  return /(?:^|\/)(?:test[^/]*|[^/]*\.test)\.(?:mjs|js|cjs|ts)$/i.test(file) || file === SELF;
}

function isProductionReachableText(file) {
  if (isTest(file) || isDocumentation(file)) return false;
  return /\.(?:mjs|js|cjs|ts|json|ya?ml|sh|html|txt)$/i.test(file);
}

const forbiddenLiterals = [
  'benchmark-registry-legacy',
  'benchmark-registry-cutover-policy',
  'BENCHMARK_REGISTRY_AUTHORITY',
  'benchmarkRegistryAuthority',
  'benchmarkRegistryLegacyKey',
  'VERIFY_BENCHMARK_AUTHORITY',
  '--verify-benchmark-parity'
];

const findings = [];
for (const { file, source } of trackedTextFiles()) {
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const literal of forbiddenLiterals) {
      if (!line.includes(literal)) continue;
      if (file === SELF) continue;
      if (isDocumentation(file)) {
        findings.push({ allowed: true, file, line: index + 1, classification: 'documentation/history', literal });
        continue;
      }
      if (isTest(file)) {
        findings.push({ allowed: true, file, line: index + 1, classification: 'negative test guard', literal });
        continue;
      }
      findings.push({ allowed: false, file, line: index + 1, classification: 'forbidden runtime mechanism', literal });
    }

    if (line.includes(AUTHORITY_STATE_PATH) && file !== SELF) {
      if (file === WORKFLOW) {
        const allowedUse = /test -e|rm -f|git(?:\s+-C\s+\S+)?\s+add\s+-A/.test(line);
        findings.push({ allowed: allowedUse, file, line: index + 1, classification: allowedUse ? 'one-time cutover existence/delete seam' : 'forbidden authority-state use', literal: AUTHORITY_STATE_PATH });
      } else if (isDocumentation(file)) {
        findings.push({ allowed: true, file, line: index + 1, classification: 'documentation/history', literal: AUTHORITY_STATE_PATH });
      } else if (isTest(file)) {
        findings.push({ allowed: true, file, line: index + 1, classification: 'negative test guard', literal: AUTHORITY_STATE_PATH });
      } else {
        findings.push({ allowed: false, file, line: index + 1, classification: 'forbidden authority-state runtime use', literal: AUTHORITY_STATE_PATH });
      }
    }

    if (isProductionReachableText(file) && /\bben-8\b|projectLegacyBenchmarkRegistry|fetchLegacyBenchmarkRegistry/i.test(line)) {
      const workflowNegativeAssertion = file === WORKFLOW && /grep|includes|assert|forbid|reject|alternate|rollback/i.test(line);
      findings.push({ allowed: workflowNegativeAssertion, file, line: index + 1, classification: workflowNegativeAssertion ? 'negative runtime assertion' : 'forbidden BEN-8 runtime projection/source metadata', literal: 'BEN-8 runtime path' });
    }
  });
}

const workflowSource = fs.readFileSync(WORKFLOW, 'utf8');
const cutoverBlocks = [...workflowSource.matchAll(/# HOME-24 CUTOVER FINALIZATION BEGIN([\s\S]*?)# HOME-24 CUTOVER FINALIZATION END/g)].map(match => match[1]);
assert.ok(cutoverBlocks.length >= 1, 'workflow must mark the one-time cutover-finalization block');
const combinedCutover = cutoverBlocks.join('\n');
assert.ok(combinedCutover.includes(`test -e "_dashboard-data/${AUTHORITY_STATE_PATH}"`), 'cutover may test only authority-state path existence');
assert.ok(combinedCutover.includes(`rm -f "_dashboard-data/${AUTHORITY_STATE_PATH}"`), 'cutover must delete the obsolete authority-state path after proof');
assert.doesNotMatch(combinedCutover, /cat\s+.*benchmark-registry-authority|readFile.*benchmark-registry-authority|<\s*.*benchmark-registry-authority/i, 'cutover blocks must never read or resolve authority from the state file');
assert.doesNotMatch(workflowSource, /printf[^\n>]*>[^\n]*benchmark-registry-authority|touch[^\n]*benchmark-registry-authority/i, 'workflow must never recreate the authority-state file');

const rejected = findings.filter(finding => !finding.allowed);
assert.deepEqual(rejected, [], rejected.map(finding => `${finding.file}:${finding.line} ${finding.classification} (${finding.literal})`).join('\n'));
console.log(`HOME-24 adversarial registry hardening tests passed; classified ${findings.length} legacy/state occurrence(s).`);
