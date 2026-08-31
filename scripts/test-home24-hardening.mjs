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

const expectedStateLines = [
  `if test -e "_dashboard-data/${AUTHORITY_STATE_PATH}"; then`,
  `rm -f "_dashboard-data/${AUTHORITY_STATE_PATH}"`,
  `git -C _dashboard-data add -A "${AUTHORITY_STATE_PATH}"`
].sort();

function assertAuthorityStateWorkflow(source) {
  const cutoverBlocks = [...source.matchAll(CUTOVER_BLOCK)].map(match => match[1]);
  assert.equal(cutoverBlocks.length, 2, 'workflow must contain only the two reviewed one-time cutover-finalization blocks');

  const outsideCutover = source.replace(CUTOVER_BLOCK, '');
  assert.equal(outsideCutover.includes(AUTHORITY_STATE_PATH), false, 'authority-state path may appear only inside marked cutover-finalization blocks');

  const stateLines = cutoverBlocks
    .flatMap(block => block.split(/\r?\n/))
    .map(line => line.trim())
    .filter(line => line.includes(AUTHORITY_STATE_PATH))
    .sort();
  assert.deepEqual(stateLines, expectedStateLines, 'authority-state file may only be existence-tested, deleted, and staged for deletion');
}

const workflowSource = fs.readFileSync(WORKFLOW, 'utf8');
assertAuthorityStateWorkflow(workflowSource);

const hiddenReadWorkflow = workflowSource.replace(
  `rm -f "_dashboard-data/${AUTHORITY_STATE_PATH}"`,
  `cat "_dashboard-data/${AUTHORITY_STATE_PATH}" >/dev/null\n          rm -f "_dashboard-data/${AUTHORITY_STATE_PATH}"`
);
assert.throws(
  () => assertAuthorityStateWorkflow(hiddenReadWorkflow),
  /authority-state file may only be existence-tested, deleted, and staged for deletion/,
  'a hidden authority-state read in a later cutover block must fail the whole-workflow audit'
);

const recreationWorkflow = workflowSource.replace(
  `rm -f "_dashboard-data/${AUTHORITY_STATE_PATH}"`,
  `printf 'jira-native\\n' > "_dashboard-data/${AUTHORITY_STATE_PATH}"\n          rm -f "_dashboard-data/${AUTHORITY_STATE_PATH}"`
);
assert.throws(
  () => assertAuthorityStateWorkflow(recreationWorkflow),
  /authority-state file may only be existence-tested, deleted, and staged for deletion/,
  'authority-state recreation in a later cutover block must fail the whole-workflow audit'
);

const serializedRegistryCount = (workflowSource.match(/Buffer\.from\(JSON\.stringify\(registry\), 'utf8'\)\.toString\('base64'\)/g) || []).length;
assert.equal(serializedRegistryCount, 2, 'both credentialed browser seams must serialize registry payloads as inert base64 data');
assert.doesNotMatch(workflowSource, /DashboardBenchmarkReview\.render\(\$\{JSON\.stringify\(registry\)\}\)/, 'credentialed browser seams must never interpolate raw registry JSON into executable script');
assert.match(workflowSource, /python3 -m http\.server 8000 --bind 127\.0\.0\.1/g, 'browser fixtures must bind their temporary server to loopback');

const rejected = findings.filter(finding => !finding.allowed);
assert.deepEqual(rejected, [], rejected.map(finding => `${finding.file}:${finding.line} ${finding.classification} (${finding.literal})`).join('\n'));
console.log(`HOME-24 adversarial registry hardening tests passed; classified ${findings.length} non-production legacy/state occurrence(s).`);
