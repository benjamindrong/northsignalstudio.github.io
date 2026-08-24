import { readFile } from 'node:fs/promises';

const fail = message => { throw new Error(message); };

const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const head = html.match(/<head>[\s\S]*?<\/head>/i)?.[0] || '';
if (!head.includes('<link rel="manifest" href="./manifest.webmanifest" />')) {
  fail('dashboard/index.html must declare ./manifest.webmanifest.');
}
if (head.includes('href="./icon.png"')) {
  fail('dashboard/index.html must not use the legacy transparent icon.png.');
}

const manifest = JSON.parse(await readFile(new URL('../dashboard/manifest.webmanifest', import.meta.url), 'utf8'));
if (manifest.id !== '/dashboard/' || manifest.start_url !== '/dashboard/' || manifest.scope !== '/dashboard/') {
  fail('Flight Control manifest identity, start_url, and scope must stay rooted at /dashboard/.');
}
if (manifest.display !== 'standalone') fail('Flight Control manifest must use standalone display mode.');

const icon = manifest.icons?.find(candidate => candidate.src === './flight-control-app-icon.png');
if (!icon) fail('Flight Control manifest must reference ./flight-control-app-icon.png.');
if (icon.type !== 'image/png' || icon.sizes !== '1024x1024') {
  fail('Flight Control web-app icon must be a 1024x1024 PNG.');
}
const purposes = new Set(String(icon.purpose || '').split(/\s+/).filter(Boolean));
if (!purposes.has('maskable')) fail('Flight Control web-app icon must declare maskable purpose.');

const png = await readFile(new URL('../dashboard/flight-control-app-icon.png', import.meta.url));
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!png.subarray(0, 8).equals(signature)) fail('Flight Control web-app icon must be a valid PNG.');
if (png.toString('ascii', 12, 16) !== 'IHDR') fail('Flight Control PNG must begin with an IHDR chunk.');
if (png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) {
  fail('Flight Control PNG dimensions must be exactly 1024x1024.');
}
const colorType = png[25];
if (colorType === 4 || colorType === 6 || png.includes(Buffer.from('tRNS'))) {
  fail('Flight Control PNG must be fully opaque with no alpha/transparency channel.');
}

console.log('Flight Control web-app icon contract: PASS');
