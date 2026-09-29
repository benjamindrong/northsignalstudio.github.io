import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productionFiles = [
  path.join(root, 'src', 'contract-definition.mjs'),
  path.join(root, 'manifest.yml')
];

const forbidden = [
  /@forge\/api/i,
  /requestJira\s*\(/i,
  /\/field\/[^/]+\/value/i,
  /private[^\n]*field[^\n]*update/i
];

for (const file of productionFiles) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      throw new Error(`Validator-bypass surface detected in ${path.relative(root, file)}`);
    }
  }
}

console.log('PASS: BEN registry production authority contains no validator-bypass writer');
