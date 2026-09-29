import { readFile, writeFile } from 'node:fs/promises';
import {
  classifyLegacyBenchmarkIssue,
  canonicalRecordFromLegacyProjection
} from '../../../scripts/benchmark-registry.mjs';

function byKey(a, b) {
  return String(a.key).localeCompare(String(b.key), 'en', { sensitivity: 'variant' });
}

export function planMigration(issues) {
  if (!Array.isArray(issues)) throw new Error('Migration input must be a Jira issue array.');

  const records = issues.map(issue => {
    const projected = classifyLegacyBenchmarkIssue(issue);
    if (projected.errors.length) {
      throw new Error(`Migration blocked for ${projected.key || 'unknown'}: ${projected.errors.join(' | ')}`);
    }
    return {
      key: projected.key,
      legacy: {
        lifecycle: projected.status,
        activityKind: projected.activityKind || null,
        ideaCategory: projected.ideaCategory || null,
        resultState: projected.resultState,
        resultLines: [...(projected.resultLines || [])],
        notableFinding: projected.notableFinding || '',
        completedAt: projected.completedAt || '',
        sourceKey: projected.sourceKey || ''
      },
      record: canonicalRecordFromLegacyProjection(projected)
    };
  }).sort(byKey);

  const keys = records.map(item => item.key);
  if (new Set(keys).size !== keys.length) throw new Error('Migration input contains duplicate Jira keys.');

  return {
    schema: 'home55.ben-registry-migration.v1',
    records
  };
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error('Usage: node scripts/plan-migration.mjs <jira-issues.json> <migration-plan.json>');
  }
  const issues = JSON.parse(await readFile(inputPath, 'utf8'));
  const plan = planMigration(issues);
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
