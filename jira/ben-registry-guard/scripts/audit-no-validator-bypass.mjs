import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptPath = fileURLToPath(import.meta.url);
const guardRoot = path.resolve(path.dirname(scriptPath), '..');
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.yml', '.yaml']);
const excludedDirectories = new Set(['node_modules', 'test', 'tests', '__tests__']);

const forbidden = [
  /\/rest\/api\/(?:2|3)\/app\/field\//i,
  /\/field\/[^/\s]+\/value/i,
  /private[^\n]*field[^\n]*update/i,
  /requestJira\s*\(/i
];

async function collectProductionFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...await collectProductionFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || fullPath === scriptPath) continue;
    if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

const productionFiles = await collectProductionFiles(guardRoot);
if (!productionFiles.length) throw new Error('No BEN registry production files were discovered for bypass audit.');

for (const file of productionFiles) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      throw new Error(`Validator-bypass surface detected in ${path.relative(guardRoot, file)}`);
    }
  }
}

console.log(`PASS: BEN registry validator-bypass audit scanned ${productionFiles.length} production files`);
