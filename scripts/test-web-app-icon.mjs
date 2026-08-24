import { readFile } from 'node:fs/promises';

const fail = message => { throw new Error(message); };
const ICON = './flight-control-app-icon.png';

const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const head = html.match(/<head>[\s\S]*?<\/head>/i)?.[0] || '';
if (!head.includes('<link rel="manifest" href="./manifest.webmanifest" />')) {
  fail('dashboard/index.html must declare ./manifest.webmanifest.');
}
if (!head.includes(`<link rel="icon" type="image/png" sizes="1024x1024" href="${ICON}" />`)) {
  fail('Safari favicon path must use the canonical opaque PNG.');
}
if (!head.includes(`<link rel="apple-touch-icon" href="${ICON}" />`)) {
  fail('Safari touch/web-app path must use the canonical opaque PNG.');
}
if (head.includes('href="./icon.png"') || head.includes('href="./flight-control-icon.svg"')) {
  fail('HTML must not expose a competing legacy or SVG icon path.');
}

const manifest = JSON.parse(await readFile(new URL('../dashboard/manifest.webmanifest', import.meta.url), 'utf8'));
if (manifest.id !== '/dashboard/' || manifest.start_url !== '/dashboard/' || manifest.scope !== '/dashboard/') {
  fail('Flight Control manifest identity, start_url, and scope must stay rooted at /dashboard/.');
}
if (manifest.display !== 'standalone') fail('Flight Control manifest must use standalone display mode.');
if (!Array.isArray(manifest.icons) || manifest.icons.length !== 1) {
  fail('Flight Control manifest must expose exactly one canonical icon path.');
}
const icon = manifest.icons[0];
if (icon.src !== ICON || icon.type !== 'image/png' || icon.sizes !== '1024x1024') {
  fail('Flight Control manifest must use the canonical 1024x1024 PNG.');
}
const purposes = new Set(String(icon.purpose || '').split(/\s+/).filter(Boolean));
if (!purposes.has('maskable') || !purposes.has('any')) {
  fail('Flight Control manifest icon must declare both any and maskable purposes.');
}

const png = await readFile(new URL(`../dashboard/${ICON.slice(2)}`, import.meta.url));
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!png.subarray(0, 8).equals(signature)) fail('Flight Control web-app icon must be a valid PNG.');
if (png.toString('ascii', 12, 16) !== 'IHDR') fail('Flight Control PNG must begin with an IHDR chunk.');
if (png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) {
  fail('Flight Control PNG dimensions must be exactly 1024x1024.');
}
if (png[24] !== 8 || png[25] !== 2) {
  fail(`Flight Control PNG must be 8-bit true-color RGB (PNG color type 2); got bit depth ${png[24]}, color type ${png[25]}.`);
}
if (png.includes(Buffer.from('tRNS'))) {
  fail('Flight Control PNG must not contain a transparency chunk.');
}

console.log('Flight Control web-app icon contract: PASS');
