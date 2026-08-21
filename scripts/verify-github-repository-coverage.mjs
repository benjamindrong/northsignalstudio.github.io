import fs from 'node:fs/promises';
import process from 'node:process';

const DEFAULT_CONFIG = 'dashboard/github-prs.config.json';
const REQUIRED_REPOSITORIES = ['benjamindrong/Runline'];

function parseRepositoryList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function validateRepository(repository) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error(`Invalid repository name: ${repository}`);
  }
}

export function effectiveRepositories(config, privateRepositoryValue = '') {
  const publicRepositories = Array.isArray(config.repositories) ? config.repositories : [];
  const privateRepositories = parseRepositoryList(privateRepositoryValue);
  const repositories = [...new Set([...publicRepositories, ...privateRepositories])];
  if (!repositories.length) throw new Error('GitHub PR configuration must contain at least one repository.');
  repositories.forEach(validateRepository);
  return repositories;
}

export function verifyRequiredRepositories(repositories, requiredRepositories = REQUIRED_REPOSITORIES) {
  const missing = requiredRepositories.filter(repository => !repositories.includes(repository));
  if (missing.length) {
    throw new Error(`Missing required production GitHub repository coverage: ${missing.join(', ')}`);
  }
  return repositories;
}

async function runSelfTest() {
  const config = {
    repositories: [
      'benjamindrong/MyRAM-iOS',
      'benjamindrong/NearbySyncCore',
      'benjamindrong/northsignalstudio.github.io'
    ]
  };

  const withRunline = effectiveRepositories(config, 'benjamindrong/Runline');
  verifyRequiredRepositories(withRunline);
  for (const repository of config.repositories) {
    if (!withRunline.includes(repository)) throw new Error(`public repository was lost from effective coverage: ${repository}`);
  }

  let omissionFailed = false;
  try {
    verifyRequiredRepositories(effectiveRepositories(config, ''));
  } catch (error) {
    omissionFailed = String(error?.message || error).includes('benjamindrong/Runline');
  }
  if (!omissionFailed) throw new Error('required repository omission must fail verification');

  console.log('github repository coverage self-test passed');
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG;
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const repositories = effectiveRepositories(config, process.env.DASHBOARD_GITHUB_PRIVATE_REPOSITORIES);
  verifyRequiredRepositories(repositories);
  console.log(`Verified effective GitHub repository coverage across ${repositories.length} repositories.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
