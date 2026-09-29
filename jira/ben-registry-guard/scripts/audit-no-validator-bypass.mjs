import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [
  /api\.asApp\(\).*requestJira/i,
  /private.*field.*update/i,
  /\/field\/[^/]+\/value/i
];

async function filesUnder(directory) {
  const entries = await readdir(directory);
  const results = [];
  for (const name of entries) {
    const full = path.join(directory, name);
    const info = await stat(full);
    if (info.isDirectory()) results.push(...await filesUnder(full));
    else results.push(full);
  }
  return results;
}

const files = (await filesUnder(root)).filter(file => !file.endsWith('audit-no-validator-bypass.mjs'));
for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) throw new Error(`Validator-bypass surface detected in ${path.relative(root, file)}`);
  }
}
console.log('PASS: no BEN Registry Record validator-bypass implementation detected');
