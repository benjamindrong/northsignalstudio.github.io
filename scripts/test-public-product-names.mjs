import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const publicHtmlFiles = trackedFiles.filter(path => path.toLowerCase().endsWith('.html'));
const forbiddenCodename = /lifeline/i;
const failures = [];

for (const path of publicHtmlFiles) {
  const content = await readFile(path, 'utf8');
  if (forbiddenCodename.test(content)) failures.push(path);
}

if (failures.length) {
  console.error(`Forbidden project codename found in public-facing HTML: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`PASS: scanned ${publicHtmlFiles.length} tracked HTML files; no secret codename found.`);
