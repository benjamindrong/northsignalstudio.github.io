import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ALLOWED_AUTHORITIES = new Set(['jira-native', 'ben-8']);
const PRESERVE_AUTHORITY = 'preserve';

// This allowlist exists only to validate HOME-24 Slice 1's one-time BEN-18
// migration parity at the current cutover candidate. It is not a production
// registry-change policy: ordinary Jira-native publishes do not consult it.
export const ALLOWED_POST_MIGRATION_DIFFERENCES = new Set([
  'Selected-next advanced after BEN-18: BEN-17 -> BEN-34.',
  'BEN-17 lifecycle advanced after BEN-18: Selected -> Unused.'
]);

function clean(value) {
  return String(value ?? '').trim();
}

function validateAuthority(value, source) {
  const authority = clean(value);
  if (!ALLOWED_AUTHORITIES.has(authority)) {
    throw new Error(`Unsupported benchmark registry authority from ${source}: ${authority || 'empty'}.`);
  }
  return authority;
}

export function resolveBenchmarkRegistryAuthority({ requested = '', persisted = '', fallback = 'jira-native' } = {}) {
  const requestedAuthority = clean(requested);
  if (requestedAuthority && requestedAuthority !== PRESERVE_AUTHORITY) {
    return validateAuthority(requestedAuthority, 'explicit request');
  }
  if (clean(persisted)) return validateAuthority(persisted, 'persisted cutover state');
  return validateAuthority(fallback, 'configured fallback');
}

export function verifyBenchmarkParityOutput(output) {
  const lines = String(output || '').split(/\r?\n/).map(line => line.trim());
  const passMarker = 'Benchmark registry Jira-native/BEN-8 parity passed for HOME-24 legacy targets.';
  if (!lines.includes(passMarker)) {
    throw new Error('Benchmark parity output is missing the required HOME-24 pass marker.');
  }

  const headingIndex = lines.indexOf('Accepted post-BEN-18 Jira-native differences:');
  if (headingIndex < 0) return [];

  const differences = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (!line.startsWith('- ')) break;
    differences.push(line.slice(2));
  }

  if (!differences.length) {
    throw new Error('Parity output declared post-BEN-18 differences without listing them.');
  }

  const unexpected = differences.filter(difference => !ALLOWED_POST_MIGRATION_DIFFERENCES.has(difference));
  if (unexpected.length) {
    throw new Error(`Unexpected post-BEN-18 parity difference(s):\n- ${unexpected.join('\n- ')}`);
  }

  if (new Set(differences).size !== differences.length) {
    throw new Error('Post-BEN-18 parity output contains duplicate accepted differences.');
  }

  return differences;
}

function readPersistedAuthority(filePath) {
  const statePath = clean(filePath);
  if (!statePath) return '';
  try {
    return fs.readFileSync(statePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function runSelfTest() {
  const assertEqual = (actual, expected, label) => {
    if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
  };
  const assertThrows = (fn, pattern, label) => {
    try {
      fn();
    } catch (error) {
      if (pattern.test(String(error?.message || error))) return;
      throw new Error(`${label}: unexpected error ${error?.message || error}`);
    }
    throw new Error(`${label}: expected an error`);
  };

  assertEqual(resolveBenchmarkRegistryAuthority({ requested: 'ben-8', persisted: 'jira-native' }), 'ben-8', 'explicit rollback wins');
  assertEqual(resolveBenchmarkRegistryAuthority({ persisted: 'ben-8' }), 'ben-8', 'scheduled refresh preserves rollback');
  assertEqual(resolveBenchmarkRegistryAuthority({ requested: 'preserve', persisted: 'ben-8' }), 'ben-8', 'manual preserve keeps rollback');
  assertEqual(resolveBenchmarkRegistryAuthority({ requested: 'jira-native', persisted: 'ben-8' }), 'jira-native', 'explicit restore wins');
  assertEqual(resolveBenchmarkRegistryAuthority({ requested: 'preserve' }), 'jira-native', 'preserve without state uses safe fallback');
  assertEqual(resolveBenchmarkRegistryAuthority({}), 'jira-native', 'fallback authority');
  assertThrows(
    () => resolveBenchmarkRegistryAuthority({ persisted: 'invalid' }),
    /persisted cutover state/,
    'invalid persisted state fails closed'
  );

  const accepted = verifyBenchmarkParityOutput(`Accepted post-BEN-18 Jira-native differences:\n- Selected-next advanced after BEN-18: BEN-17 -> BEN-34.\n- BEN-17 lifecycle advanced after BEN-18: Selected -> Unused.\nBenchmark registry Jira-native/BEN-8 parity passed for HOME-24 legacy targets.`);
  assertEqual(accepted.length, 2, 'known post-migration differences');
  assertThrows(
    () => verifyBenchmarkParityOutput(`Accepted post-BEN-18 Jira-native differences:\n- BEN-22 idea category advanced after BEN-18: considered -> fresh.\nBenchmark registry Jira-native/BEN-8 parity passed for HOME-24 legacy targets.`),
    /Unexpected post-BEN-18 parity difference/,
    'unrelated post-cutoff drift fails closed'
  );
  assertThrows(
    () => verifyBenchmarkParityOutput('Accepted post-BEN-18 Jira-native differences:\n- Selected-next advanced after BEN-18: BEN-17 -> BEN-34.'),
    /missing the required HOME-24 pass marker/,
    'missing comparator success marker fails closed'
  );

  console.log('benchmark registry cutover policy self-test passed');
}

async function main() {
  const command = process.argv[2] || '';
  if (command === '--self-test') return runSelfTest();
  if (command === 'resolve-authority') {
    const requested = process.argv[3] || '';
    const statePath = process.argv[4] || '';
    const fallback = process.argv[5] || 'jira-native';
    const persisted = readPersistedAuthority(statePath);
    process.stdout.write(`${resolveBenchmarkRegistryAuthority({ requested, persisted, fallback })}\n`);
    return;
  }
  if (command === 'verify-parity-output') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const differences = verifyBenchmarkParityOutput(input);
    console.log(`Benchmark parity post-migration policy passed (${differences.length} accepted difference${differences.length === 1 ? '' : 's'}).`);
    return;
  }
  throw new Error('Usage: benchmark-registry-cutover-policy.mjs --self-test | resolve-authority <requested|preserve> <state-path> [fallback] | verify-parity-output');
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
