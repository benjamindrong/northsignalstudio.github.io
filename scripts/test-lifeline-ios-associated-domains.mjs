import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const aasaPath = new URL('../.well-known/apple-app-site-association', import.meta.url);
const aasa = JSON.parse(readFileSync(aasaPath, 'utf8'));
const team = '5FF5MBB334';
const applications = [
  { bundle: 'com.northsignalstudio.lifeline', callback: '/lifeline/oauth/callback' },
  { bundle: 'com.northsignalstudio.lifeline.sandbox', callback: '/lifeline/sandbox/oauth/callback' },
];
const credentials = aasa.webcredentials?.apps;
assert.ok(Array.isArray(credentials), 'AASA must publish webcredentials.apps for iOS HTTPS OAuth callbacks');
assert.equal(new Set(credentials).size, credentials.length, 'AASA webcredentials.apps must not contain duplicates');

for (const app of applications) {
  const appID = `${team}.${app.bundle}`;
  assert.ok(credentials.includes(appID), `${appID} missing from webcredentials.apps; iOS OAuth would fail before login`);
  const link = aasa.applinks?.details?.find((entry) => entry.appID === appID);
  assert.ok(link?.paths?.includes(app.callback), `${appID} missing expected Universal Link callback ${app.callback}`);
}

assert.ok(
  credentials.includes(`${team}.com.lifeline.sandbox.nonproduction`),
  'Existing legacy sandbox credential association must be preserved',
);
console.log('PASS: Lifeline iOS production/sandbox HTTPS OAuth webcredentials and Universal Link contract');
