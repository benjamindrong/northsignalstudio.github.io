import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseCanonicalResultSummary, projectBenchmarkRegistry } from './benchmark-registry.mjs';

const POINTER_SUMMARY = 'Benchmark Registry Next Pointer';
const SELF = 'scripts/test-home24-hardening.mjs';
const WORKFLOW = '.github/workflows/refresh-jira-flight-control.yml';
const AUTHORITY_STATE_PATH = 'dashboard/benchmark-registry-authority.txt';
const CUTOVER_BLOCK = /# HOME-24 CUTOVER FINALIZATION BEGIN([\s\S]*?)# HOME-24 CUTOVER FINALIZATION END/g;

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

const panelWrappedBullets = parseCanonicalResultSummary({
  type: 'doc',
  version: 1,
  content: [
    heading(3, 'Completion Artifact'),
    heading(4, 'Registry Result Summary'),
    {
      type: 'panel',
      attrs: { panelType: 'info' },
      content: [{ type: 'bulletList', content: [bullet('Outcome: B'), bullet('Scores: 9/8'), bullet('Signal: X')] }]
    }
  ]
});
assert.equal(panelWrappedBullets.ok, false);
assert.match(panelWrappedBullets.error, /top-level bullet-list items|only the three required bullets/i);

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

function isTestFile(file) {
  return /(?:^|\/)(?:test-[^/]+|[^/]+\.(?:test|spec))\.(?:mjs|js|cjs|ts)$/i.test(file);
}

function isProductionReachableText(file) {
  if (isDocumentation(file) || isTestFile(file) || file === SELF) return false;
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
      findings.push({ allowed: false, file, line: index + 1, classification: 'forbidden runtime/test mechanism', literal });
    }

    if (line.includes(AUTHORITY_STATE_PATH) && file !== SELF && file !== WORKFLOW) {
      if (isDocumentation(file)) {
        findings.push({ allowed: true, file, line: index + 1, classification: 'documentation/history', literal: AUTHORITY_STATE_PATH });
      } else {
        findings.push({ allowed: false, file, line: index + 1, classification: 'forbidden authority-state use', literal: AUTHORITY_STATE_PATH });
      }
    }

    if (isProductionReachableText(file) && /\bben-8\b|projectLegacyBenchmarkRegistry|fetchLegacyBenchmarkRegistry/i.test(line)) {
      findings.push({ allowed: false, file, line: index + 1, classification: 'forbidden BEN-8 runtime projection/source metadata', literal: 'BEN-8 runtime path' });
    }
  });
}

// HOME-24's one-time Jira authority transition is historical. Runtime cutover now
// forbids reinstating the legacy BEN-21 credentialed publisher or state flag.
const workflowSource = fs.readFileSync(WORKFLOW, 'utf8');
const producerSource = fs.readFileSync('scripts/refresh-jira-flight-control.mjs', 'utf8');
const refreshSource = fs.readFileSync('dashboard/refresh-health.js', 'utf8');
assert.equal([...workflowSource.matchAll(CUTOVER_BLOCK)].length, 0,
  'obsolete Jira-native cutover blocks must not run after native cutover');
assert.doesNotMatch(workflowSource, /HOME24_CUTOVER_PENDING|live-gate:|independentPointer/,
  'historical BEN-21 credentialed gates must not execute');
assert.doesNotMatch(workflowSource, /benchmark-registry-authority\\.txt/,
  'the published Jira workflow cannot read or rewrite legacy authority flags');
assert.doesNotMatch(producerSource,
  /fetchJiraNativeBenchmarkRegistry|REGISTRY_QUERY_LABELS|buildBenchmarkRegistryJql|buildBenchmarkPointerIdentityJql|benchmarkReview|BENCHMARK_POINTER_SUMMARY/,
  'generic Jira acquisition must not restore Benchmark Review authority');
assert.doesNotMatch(refreshSource, /payload\\.benchmarkReview/,
  'browser refresh must not accept Jira BEN state');
assert.match(workflowSource, /owned_path=dashboard\\/jira-flight-control\\.enc\\.json/,
  'generic Jira publication must still own its original encrypted artifact');
assert.match(workflowSource, /sibling_path=dashboard\\/github-prs\\.enc\\.json/,
  'generic Jira publication must preserve the GitHub sibling snapshot');
assert.match(workflowSource, /python3 -m http\\.server 8000 --bind 127\\.0\\.0\\.1/,
  'native browser fixtures must bind to loopback');
const rejected = findings.filter(finding => !finding.allowed);
assert.deepEqual(rejected, [],
  rejected.map(finding => `${finding.file}:${finding.line} ${finding.classification} (${finding.literal})`).join('\\n'));
console.log(`PASS: native authority anti-regression and historical fixture audit; ${findings.length} permitted historical occurrences`);
