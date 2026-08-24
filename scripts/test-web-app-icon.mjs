import { readFile } from 'node:fs/promises';

const fail = message => {
  throw new Error(message);
};

const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const head = html.match(/<head>[\s\S]*?<\/head>/i)?.[0] || '';

if (!head.includes('<link rel="manifest" href="./manifest.webmanifest" />')) {
  fail('dashboard/index.html must declare ./manifest.webmanifest.');
}
if (!head.includes('<link rel="icon" type="image/svg+xml" href="./flight-control-icon.svg" />')) {
  fail('dashboard/index.html must use the dedicated Flight Control SVG icon.');
}
if (head.includes('href="./icon.png"')) {
  fail('dashboard/index.html must not fall back to the legacy transparent icon.png.');
}

const manifest = JSON.parse(await readFile(new URL('../dashboard/manifest.webmanifest', import.meta.url), 'utf8'));
if (manifest.id !== '/dashboard/' || manifest.start_url !== '/dashboard/' || manifest.scope !== '/dashboard/') {
  fail('Flight Control manifest identity, start_url, and scope must stay rooted at /dashboard/.');
}
if (manifest.display !== 'standalone') {
  fail('Flight Control manifest must use standalone display mode.');
}

const icon = manifest.icons?.find(candidate => candidate.src === './flight-control-icon.svg');
if (!icon) fail('Flight Control manifest must reference ./flight-control-icon.svg.');
if (icon.type !== 'image/svg+xml' || icon.sizes !== 'any') {
  fail('Flight Control manifest icon must be an any-size SVG.');
}
const purposes = new Set(String(icon.purpose || '').split(/\s+/).filter(Boolean));
if (!purposes.has('maskable')) {
  fail('Flight Control manifest icon must declare maskable purpose.');
}

const svg = await readFile(new URL('../dashboard/flight-control-icon.svg', import.meta.url), 'utf8');
if (!svg.includes('viewBox="0 0 1024 1024"')) {
  fail('Flight Control icon must use a 1024×1024 square viewBox.');
}
if (!/<rect\s+width="1024"\s+height="1024"\s+fill="#[0-9a-fA-F]{6}"\s*\/>/.test(svg)) {
  fail('Flight Control icon must begin with an opaque full-bleed 1024×1024 background.');
}

console.log('Flight Control web-app icon contract: PASS');
