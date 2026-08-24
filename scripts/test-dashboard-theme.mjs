import { readFile } from 'node:fs/promises';

const fail = message => { throw new Error(message); };
const docs = ['index.html', 'display.html'];

for (const filename of docs) {
  const html = await readFile(new URL(`../dashboard/${filename}`, import.meta.url), 'utf8');
  const lightTheme = '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f6f8" />';
  const darkTheme = '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0d10" />';
  const stylesheet = '<link rel="stylesheet" href="./theme.css" />';

  if (!html.includes(lightTheme) || !html.includes(darkTheme)) {
    fail(`${filename} must expose light and dark system theme-color metadata.`);
  }
  if (!html.includes(stylesheet)) {
    fail(`${filename} must load ./theme.css.`);
  }
  if (html.indexOf(stylesheet) < html.indexOf('</style>')) {
    fail(`${filename} must load theme.css after its inline dark baseline so system overrides win.`);
  }
  if (/<meta name="theme-color" content=/.test(html)) {
    fail(`${filename} must not keep an unconditional dark theme-color meta tag.`);
  }
}

const css = await readFile(new URL('../dashboard/theme.css', import.meta.url), 'utf8');
if (!css.includes(':root {\n  color-scheme: light dark;')) {
  fail('theme.css must advertise both light and dark color schemes.');
}
if (!css.includes('@media (prefers-color-scheme: light)')) {
  fail('theme.css must follow the system light appearance with prefers-color-scheme.');
}
for (const token of ['--bg: #f4f6f8;', '--panel: #ffffff;', '--text: #15191e;', '--board-bg: #fbfcfd;', '--board-text: #20242a;']) {
  if (!css.includes(token)) fail(`theme.css is missing required light token: ${token}`);
}

const benchmarkJs = await readFile(new URL('../dashboard/benchmark-review.js', import.meta.url), 'utf8');
for (const darkDeclaration of [
  'background: #15140e;',
  'background: #101310;',
  'color: #fff7d3;',
  'color: #a8aea8;',
  'color: #c8cec8;',
  'color: #c8c8bc;',
  'color: #9da59d;'
]) {
  if (!benchmarkJs.includes(darkDeclaration)) {
    fail(`Benchmark Review dark baseline changed; re-audit light-mode overrides for: ${darkDeclaration}`);
  }
}
for (const lightOverride of [
  'color: #66727c !important;',
  'background: #fff8df !important;',
  'color: #695100 !important;',
  'background: #f7f9fa !important;',
  'color: #39434c !important;',
  'color: #5c6670 !important;',
  'color: #64707a !important;'
]) {
  if (!css.includes(lightOverride)) {
    fail(`Benchmark Review runtime dark CSS must have an authoritative light override: ${lightOverride}`);
  }
}
for (const selector of [
  '.benchmark-meta,',
  '.benchmark-next {',
  '.benchmark-run-title {',
  '.benchmark-group,',
  '.benchmark-group h3,',
  '.benchmark-result,',
  '.benchmark-result.none,'
]) {
  if (!css.includes(selector)) {
    fail(`theme.css is missing Benchmark Review light-mode selector: ${selector}`);
  }
}

const hexToRgb = hex => {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255);
};
const luminance = hex => {
  const [r, g, b] = hexToRgb(hex).map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};

for (const [foreground, background, label] of [
  ['#15191e', '#f4f6f8', 'page text'],
  ['#20242a', '#fbfcfd', 'board text'],
  ['#5d6873', '#f4f6f8', 'muted text'],
  ['#b42318', '#fbfcfd', 'blocked status'],
  ['#18723c', '#fbfcfd', 'done status'],
  ['#695100', '#fff8df', 'benchmark title'],
  ['#66727c', '#fff8df', 'benchmark metadata'],
  ['#39434c', '#f7f9fa', 'benchmark group heading'],
  ['#5c6670', '#f7f9fa', 'benchmark secondary text'],
  ['#64707a', '#fbfcfd', 'benchmark empty text']
]) {
  if (contrast(foreground, background) < 4.5) {
    fail(`Light theme ${label} contrast must remain at least 4.5:1.`);
  }
}

console.log('Dashboard system appearance contract: PASS');