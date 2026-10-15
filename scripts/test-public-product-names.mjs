import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const publicHtmlFiles = trackedFiles.filter(path => path.toLowerCase().endsWith('.html'));
const obsoleteProductName = /\bMyHealth\b/;
const failures = [];

for (const path of publicHtmlFiles) {
  const content = await readFile(path, 'utf8');
  if (obsoleteProductName.test(content)) failures.push(`Obsolete public name in ${path}`);
}

for (const path of ['index.html', 'privacy.html', 'support.html', 'terms.html', 'lifeline.html']) {
  if (!(await readFile(path, 'utf8')).includes('Lifeline')) {
    failures.push(`Missing approved public name in ${path}`);
  }
}

const home = await readFile('index.html', 'utf8');
const support = await readFile('support.html', 'utf8');
const product = await readFile('lifeline.html', 'utf8');
const legacy = await readFile('myhealth.html', 'utf8');
if (!home.includes('href="lifeline.html"') || !support.includes('href="lifeline.html"')) {
  failures.push('Public product links do not target lifeline.html');
}
if (!product.includes('<h1>Lifeline</h1>')) {
  failures.push('lifeline.html is not the canonical Lifeline product page');
}
if (!legacy.includes('href="lifeline.html"') ||
    !legacy.includes('url=lifeline.html') ||
    !legacy.includes('window.location.replace("lifeline.html")')) {
  failures.push('Legacy myhealth.html redirect does not target Lifeline');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`PASS: scanned ${publicHtmlFiles.length} tracked HTML files; Lifeline branding and legacy redirect valid.`);
