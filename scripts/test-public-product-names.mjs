import { readFile } from 'node:fs/promises';

const publicFiles = [
  'index.html',
  'privacy.html',
  'terms.html',
  'support.html',
  'myhealth.html',
  'lifeline.html',
  'lifeline/oauth/callback/index.html',
];

const forbiddenCodename = /lifeline/i;
const failures = [];

for (const path of publicFiles) {
  const content = await readFile(path, 'utf8');
  if (forbiddenCodename.test(content)) failures.push(path);
}

if (failures.length) {
  console.error(`Forbidden project codename found in public-facing content: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('PASS: public-facing product naming contains no secret codename.');
