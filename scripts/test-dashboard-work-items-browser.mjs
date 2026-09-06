import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const index = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const runner = new URL('./test-dashboard-work-items-browser.py', import.meta.url);

assert.ok(index.includes('<script src="./work-items.js"></script>'), 'production page must load DashboardWorkItems');
assert.ok(
  index.indexOf('<script src="./work-items.js"></script>') < index.indexOf('<script src="./refresh-health.js"></script>'),
  'production page must load work-items.js before refresh-health.js',
);
assert.ok(fs.existsSync(runner), 'production-path browser harness is required');

const result = spawnSync('python3', [fileURLToPath(runner)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
  env: {
    ...process.env,
    PYTHONPYCACHEPREFIX: process.env.PYTHONPYCACHEPREFIX || '/tmp/home29-pycache',
  },
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
assert.equal(result.status, 0, 'HOME-29 production-path browser verification must pass');

console.log('HOME-29 Node browser gate: PASS');
