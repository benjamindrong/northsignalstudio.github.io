import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = 'dashboard/github-prs.config.json';
const DEFAULT_OUTPUT = 'dashboard/github-prs.enc.json';
const PBKDF2_ITERATIONS = 250_000;
const API_ROOT = 'https://api.github.com';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseRepositoryList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function configuredRepositories(config) {
  const publicRepositories = Array.isArray(config.repositories) ? config.repositories : [];
  const privateRepositories = parseRepositoryList(process.env.DASHBOARD_GITHUB_PRIVATE_REPOSITORIES);
  const repositories = [...new Set([...publicRepositories, ...privateRepositories])];
  if (!repositories.length) throw new Error('GitHub PR configuration must contain at least one repository.');
  for (const repository of repositories) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error(`Invalid repository name: ${repository}`);
  }
  return repositories;
}

async function githubFetch(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'northsignalstudio-home-dashboard',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub request failed (${response.status} ${response.statusText}) for ${url}: ${text.slice(0, 400)}`);
  }
  return response.json();
}

function latestReviewStates(reviews) {
  const latest = new Map();
  for (const review of reviews || []) {
    const login = review.user?.login;
    const state = String(review.state || '').toUpperCase();
    if (!login || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(state)) continue;
    const timestamp = Date.parse(review.submitted_at || review.created_at || 0) || 0;
    const current = latest.get(login);
    if (!current || timestamp >= current.timestamp) latest.set(login, { state, timestamp });
  }
  return [...latest.values()].map(value => value.state);
}

function checkSummary(checkRuns) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const failing = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);
  const neutral = new Set(['success', 'neutral', 'skipped']);
  return {
    hasChecks: runs.length > 0,
    failing: runs.some(run => failing.has(String(run.conclusion || '').toLowerCase())),
    pending: runs.some(run => String(run.status || '').toLowerCase() !== 'completed'),
    passing: runs.length > 0 && runs.every(run => neutral.has(String(run.conclusion || '').toLowerCase()))
  };
}

export function classifyPullRequest({ draft, mergeableState, requestedReviewers, reviews, checkRuns }) {
  if (draft) return { state: 'DRAFT', rank: 7, className: 'unknown' };
  if (String(mergeableState || '').toLowerCase() === 'dirty') return { state: 'CONFLICT', rank: 0, className: 'blocked' };

  const reviewStates = latestReviewStates(reviews);
  if (reviewStates.includes('CHANGES_REQUESTED')) return { state: 'CHANGES', rank: 1, className: 'blocked' };

  const checks = checkSummary(checkRuns);
  if (checks.failing) return { state: 'CHECKS FAIL', rank: 2, className: 'blocked' };
  if ((requestedReviewers || []).length > 0) return { state: 'REVIEW', rank: 3, className: 'review' };
  if (checks.pending) return { state: 'CHECKS', rank: 4, className: 'progress' };
  if (reviewStates.includes('APPROVED') && (!checks.hasChecks || checks.passing)) return { state: 'READY', rank: 5, className: 'done' };
  return { state: 'OPEN', rank: 6, className: 'todo' };
}

async function fetchPullRequestsForRepository(repository, token, maxPullRequests) {
  const [owner, repo] = repository.split('/');
  const pulls = await githubFetch(`${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&sort=updated&direction=desc&per_page=${Math.min(100, maxPullRequests)}`, token);
  const selected = pulls.filter(pull => !pull.draft).slice(0, maxPullRequests);
  const mapped = [];

  for (const pull of selected) {
    const [detail, reviews, checks] = await Promise.all([
      githubFetch(`${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull.number}`, token),
      githubFetch(`${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull.number}/reviews?per_page=100`, token),
      githubFetch(`${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${pull.head.sha}/check-runs?per_page=100`, token)
    ]);
    const attention = classifyPullRequest({
      draft: Boolean(pull.draft),
      mergeableState: detail.mergeable_state,
      requestedReviewers: pull.requested_reviewers || [],
      reviews,
      checkRuns: checks.check_runs || []
    });
    mapped.push({
      repository,
      number: pull.number,
      title: pull.title || '',
      updatedAt: pull.updated_at || '',
      url: pull.html_url || '',
      state: attention.state,
      stateClass: attention.className,
      attentionRank: attention.rank
    });
  }

  return mapped;
}

function contentHash(payload) {
  const stable = { version: payload.version, repositories: payload.repositories, pullRequests: payload.pullRequests };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function encryptPayload(payload, passphrase) {
  const plaintext = Buffer.from(JSON.stringify(payload));
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    contentSha256: contentHash(payload),
    generatedAt: payload.generatedAt
  };
}

export function decryptPayload(envelope, passphrase) {
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const key = crypto.pbkdf2Sync(passphrase, salt, envelope.iterations, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

function canReuseEnvelope(previous, expectedHash, passphrase) {
  if (
    previous?.version !== 1
    || previous?.cipher !== 'AES-256-GCM'
    || previous?.kdf !== 'PBKDF2-SHA256'
    || previous?.iterations !== PBKDF2_ITERATIONS
    || previous?.contentSha256 !== expectedHash
  ) return false;
  try {
    return contentHash(decryptPayload(previous, passphrase)) === expectedHash;
  } catch {
    return false;
  }
}

function refreshEnvelopeHeartbeat(previous, generatedAt) {
  return { ...previous, generatedAt };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readPreviousEnvelope(filePath) {
  if (!filePath) return null;
  try { return await readJson(filePath); } catch { return null; }
}

async function runSelfTest() {
  const base = { draft: false, mergeableState: 'clean', requestedReviewers: [], reviews: [], checkRuns: [] };
  const cases = [
    [{ ...base, draft: true }, 'DRAFT', 7],
    [{ ...base, mergeableState: 'dirty' }, 'CONFLICT', 0],
    [{ ...base, reviews: [{ user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-08-12T12:00:00Z' }] }, 'CHANGES', 1],
    [{ ...base, checkRuns: [{ status: 'completed', conclusion: 'failure' }] }, 'CHECKS FAIL', 2],
    [{ ...base, requestedReviewers: [{ login: 'reviewer' }] }, 'REVIEW', 3],
    [{ ...base, checkRuns: [{ status: 'in_progress', conclusion: null }] }, 'CHECKS', 4],
    [{ ...base, reviews: [{ user: { login: 'reviewer' }, state: 'APPROVED', submitted_at: '2026-08-12T12:00:00Z' }], checkRuns: [{ status: 'completed', conclusion: 'success' }] }, 'READY', 5],
    [base, 'OPEN', 6]
  ];
  for (const [input, state, rank] of cases) {
    const actual = classifyPullRequest(input);
    if (actual.state !== state || actual.rank !== rank) throw new Error(`classification self-test failed for ${state}`);
  }

  const payload = {
    version: 1,
    generatedAt: '2026-08-12T12:00:00.000Z',
    repositories: ['benjamindrong/MyRAM-iOS'],
    pullRequests: [{ repository: 'benjamindrong/MyRAM-iOS', number: 1, title: 'Test', updatedAt: '2026-08-12T12:00:00Z', url: 'https://github.com/benjamindrong/MyRAM-iOS/pull/1', state: 'OPEN', stateClass: 'todo', attentionRank: 6 }]
  };
  const passphrase = 'correct horse battery staple';
  const envelope = encryptPayload(payload, passphrase);
  if (JSON.stringify(decryptPayload(envelope, passphrase)) !== JSON.stringify(payload)) throw new Error('encryption self-test failed');
  const hash = contentHash(payload);
  if (!canReuseEnvelope(envelope, hash, passphrase)) throw new Error('same-key envelope reuse self-test failed');
  if (canReuseEnvelope(envelope, hash, 'rotated passphrase')) throw new Error('passphrase rotation self-test failed');

  const heartbeatAt = '2026-08-12T12:15:00.000Z';
  const refreshedEnvelope = refreshEnvelopeHeartbeat(envelope, heartbeatAt);
  if (refreshedEnvelope.generatedAt !== heartbeatAt) throw new Error('refresh heartbeat self-test failed');
  if (refreshedEnvelope.ciphertext !== envelope.ciphertext || refreshedEnvelope.contentSha256 !== envelope.contentSha256) {
    throw new Error('refresh heartbeat must preserve encrypted content');
  }
  if (JSON.stringify(decryptPayload(refreshedEnvelope, passphrase)) !== JSON.stringify(payload)) {
    throw new Error('refresh heartbeat must not alter decrypted payload');
  }
  console.log('refresh-github-prs self-test passed');
}

async function verifyOutput(filePath) {
  if (!filePath) throw new Error('--verify-output requires an encrypted snapshot path.');
  const config = await readJson(process.env.CONFIG_PATH || DEFAULT_CONFIG);
  const passphrase = requiredEnv('DASHBOARD_DATA_PASSPHRASE');
  const repositories = configuredRepositories(config);
  const envelope = await readJson(filePath);
  if (Number.isNaN(Date.parse(envelope.generatedAt || ''))) throw new Error('Encrypted snapshot refresh heartbeat must be a valid generatedAt timestamp.');
  const payload = decryptPayload(envelope, passphrase);

  if (JSON.stringify(payload.repositories) !== JSON.stringify(repositories)) throw new Error('Encrypted snapshot repository configuration does not match the effective configuration.');
  if (!Array.isArray(payload.pullRequests)) throw new Error('Encrypted snapshot pullRequests must be an array.');
  const observedRepositories = new Set();
  for (const pull of payload.pullRequests) {
    for (const field of ['repository', 'title', 'updatedAt', 'url', 'state', 'stateClass']) {
      if (typeof pull[field] !== 'string') throw new Error(`Encrypted snapshot PR field ${field} must be a string.`);
    }
    if (!Number.isInteger(pull.number) || pull.number <= 0) throw new Error('Encrypted snapshot PR number must be a positive integer.');
    if (!Number.isInteger(pull.attentionRank) || pull.attentionRank < 0) throw new Error(`Invalid attention rank for ${pull.repository}#${pull.number}.`);
    if (!repositories.includes(pull.repository)) throw new Error(`Snapshot contains unconfigured repository ${pull.repository}.`);
    if (!pull.url.startsWith(`https://github.com/${pull.repository}/pull/`)) throw new Error(`Unexpected GitHub PR URL for ${pull.repository}#${pull.number}.`);
    if (Number.isNaN(Date.parse(pull.updatedAt))) throw new Error(`Invalid updatedAt value for ${pull.repository}#${pull.number}.`);
    observedRepositories.add(pull.repository);
  }

  const minimumOpenRepositories = Number(process.env.VERIFY_OPEN_REPOSITORIES || 0);
  if (Number.isFinite(minimumOpenRepositories) && minimumOpenRepositories > 0 && observedRepositories.size < minimumOpenRepositories) {
    throw new Error(`Live snapshot contains open PRs from ${observedRepositories.size} repositories; expected at least ${minimumOpenRepositories}.`);
  }
  console.log(`Verified encrypted GitHub PR snapshot with ${payload.pullRequests.length} open PRs across ${observedRepositories.size} repositories (${repositories.length} configured).`);
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const verifyIndex = process.argv.indexOf('--verify-output');
  if (verifyIndex >= 0) return verifyOutput(process.argv[verifyIndex + 1]);

  const config = await readJson(process.env.CONFIG_PATH || DEFAULT_CONFIG);
  const outputPath = process.env.OUTPUT_PATH || DEFAULT_OUTPUT;
  const previousPath = process.env.PREVIOUS_PATH || '';
  const passphrase = requiredEnv('DASHBOARD_DATA_PASSPHRASE');
  const token = process.env.GITHUB_API_TOKEN?.trim() || '';
  const repositories = configuredRepositories(config);
  const maxPullRequests = Math.max(1, Math.min(100, Number(config.maxPullRequestsPerRepository) || 20));

  const groups = await Promise.all(repositories.map(repository => fetchPullRequestsForRepository(repository, token, maxPullRequests)));
  const pullRequests = groups.flat().sort((a, b) => a.attentionRank - b.attentionRank || String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.repository.localeCompare(b.repository) || a.number - b.number);
  const payload = { version: 1, generatedAt: new Date().toISOString(), repositories, pullRequests };
  const previous = await readPreviousEnvelope(previousPath);
  const hash = contentHash(payload);
  const envelope = canReuseEnvelope(previous, hash, passphrase)
    ? refreshEnvelopeHeartbeat(previous, payload.generatedAt)
    : encryptPayload(payload, passphrase);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  console.log(`Wrote encrypted GitHub PR snapshot with ${pullRequests.length} open PRs across ${repositories.length} repositories to ${outputPath}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
