import fs from 'node:fs/promises';
import process from 'node:process';
import { decryptPayload } from './refresh-github-prs.mjs';

const DEFAULT_OUTPUT = 'dashboard/github-prs.enc.json';
const REQUIRED_REPOSITORIES = ['benjamindrong/Runline'];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function verifyRequiredRepositories(repositories, requiredRepositories = REQUIRED_REPOSITORIES) {
  if (!Array.isArray(repositories)) throw new Error('Encrypted snapshot repositories must be an array.');
  const missing = requiredRepositories.filter(repository => !repositories.includes(repository));
  if (missing.length) {
    throw new Error(`Missing required production GitHub repository coverage: ${missing.join(', ')}`);
  }
  return repositories;
}

async function runSelfTest() {
  const configured = [
    'benjamindrong/MyRAM-iOS',
    'benjamindrong/NearbySyncCore',
    'benjamindrong/northsignalstudio.github.io',
    'benjamindrong/Runline'
  ];
  verifyRequiredRepositories(configured);

  let omissionFailed = false;
  try {
    verifyRequiredRepositories(configured.filter(repository => repository !== 'benjamindrong/Runline'));
  } catch (error) {
    omissionFailed = String(error?.message || error).includes('benjamindrong/Runline');
  }
  if (!omissionFailed) throw new Error('required repository omission must fail verification');

  console.log('github repository coverage self-test passed');
}

async function verifyOutputCoverage(filePath) {
  const passphrase = requiredEnv('DASHBOARD_DATA_PASSPHRASE');
  const envelope = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const payload = decryptPayload(envelope, passphrase);
  const repositories = verifyRequiredRepositories(payload.repositories);
  console.log(`Verified required GitHub repository coverage in encrypted snapshot (${repositories.length} configured).`);
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  return verifyOutputCoverage(process.env.OUTPUT_PATH || DEFAULT_OUTPUT);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
