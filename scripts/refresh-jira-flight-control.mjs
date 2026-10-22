import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = 'dashboard/jira-flight-control.config.json';
const DEFAULT_OUTPUT = 'dashboard/jira-flight-control.enc.json';
const PBKDF2_ITERATIONS = 250_000;
const RECENT_DONE_PER_PROJECT = 3;
const HEARTBEAT_AFTER_MS = 15 * 60 * 1000;
const STABILIZATION_WINDOW_MS = 20_000;
const STABILIZATION_RETRY_MS = 2_000;
const TRIGGER_KINDS = new Set(['jira', 'manual', 'schedule', 'push']);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function quoteJqlValue(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function exclusionJql() {
  return 'status != Shelved AND (labels IS EMPTY OR labels NOT IN ("shelved", "validated-not-pursuing"))';
}

function buildActiveJql(projects) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('Config must contain at least one Jira project key.');
  }
  const quoted = projects.map(quoteJqlValue).join(', ');
  return `project in (${quoted}) AND ${exclusionJql()} AND statusCategory != Done AND status NOT IN ("To Do", "Backlog", "Ready", "New") ORDER BY project ASC, updated DESC`;
}

function buildDoneJql(project) {
  return `project = ${quoteJqlValue(project)} AND ${exclusionJql()} AND statusCategory = Done ORDER BY statusCategoryChangedDate DESC`;
}

function historyTimestamp(created) {
  if (typeof created === 'number') {
    const milliseconds = created < 1_000_000_000_000 ? created * 1000 : created;
    return Number.isFinite(milliseconds) ? milliseconds : NaN;
  }
  const parsed = Date.parse(created);
  return Number.isNaN(parsed) ? NaN : parsed;
}

export function latestStatusMove(histories) {
  let latest = null;
  for (const history of histories || []) {
    const hasStatusChange = (history.items || []).some(item =>
      String(item.fieldId || item.field || '').toLowerCase() === 'status'
      || String(item.field || '').toLowerCase() === 'status'
    );
    if (!hasStatusChange || history.created == null) continue;
    const timestamp = historyTimestamp(history.created);
    if (Number.isNaN(timestamp)) continue;
    if (!latest || timestamp > latest.timestamp) latest = { timestamp, value: new Date(timestamp).toISOString() };
  }
  return latest?.value || null;
}

async function jiraFetch(url, options, authHeader) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: authHeader,
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jira request failed (${response.status} ${response.statusText}): ${text.slice(0, 500)}`);
  }
  return response.json();
}

function assertCompleteSearch(nextPageToken, issueCount, maxIssues, context) {
  if (nextPageToken && issueCount >= maxIssues) {
    throw new Error(`${context} exceeded the configured maximum of ${maxIssues} issues.`);
  }
}

async function searchJqlIssues(
  baseUrl,
  authHeader,
  jql,
  maxIssues,
  fields = ['summary', 'status', 'project', 'updated'],
  { requireComplete = false, context = 'Jira query' } = {}
) {
  const issues = [];
  let nextPageToken;
  do {
    const body = {
      jql,
      maxResults: Math.min(100, Math.max(1, maxIssues - issues.length)),
      fields
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = await jiraFetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      body: JSON.stringify(body)
    }, authHeader);
    issues.push(...(page.issues || []));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && issues.length < maxIssues);
  if (requireComplete) assertCompleteSearch(nextPageToken, issues.length, maxIssues, context);
  return issues.slice(0, maxIssues);
}

async function searchIssues(baseUrl, authHeader, projects, maxIssues) {
  const active = await searchJqlIssues(baseUrl, authHeader, buildActiveJql(projects), maxIssues);
  const recentDone = [];
  for (const project of projects) {
    recentDone.push(...await searchJqlIssues(baseUrl, authHeader, buildDoneJql(project), RECENT_DONE_PER_PROJECT));
  }
  return [...active, ...recentDone];
}

async function fetchStatusChangelogs(baseUrl, authHeader, issues) {
  if (!issues.length) return new Map();
  const historiesByIssueId = new Map();
  let nextPageToken;
  do {
    const body = {
      issueIdsOrKeys: issues.map(issue => issue.id || issue.key),
      fieldIds: ['status'],
      maxResults: 1000
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = await jiraFetch(`${baseUrl}/rest/api/3/changelog/bulkfetch`, {
      method: 'POST',
      body: JSON.stringify(body)
    }, authHeader);
    for (const issueLog of page.issueChangeLogs || []) {
      const current = historiesByIssueId.get(String(issueLog.issueId)) || [];
      current.push(...(issueLog.changeHistories || []));
      historiesByIssueId.set(String(issueLog.issueId), current);
    }
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return historiesByIssueId;
}

function contentHash(payload) {
  const stable = {
    version: payload.version,
    generatedAt: payload.generatedAt,
    projects: payload.projects,
    issues: payload.issues
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function semanticView(payload) {
  const { generatedAt: _ignoredGeneratedAt, ...semantic } = payload || {};
  return semantic;
}

function canonicalizeSemantic(value) {
  if (Array.isArray(value)) return value.map(canonicalizeSemantic);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalizeSemantic(value[key])]));
  }
  return value;
}

export function semanticHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalizeSemantic(semanticView(payload)))).digest('hex');
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

function deterministicIssueCompare(a, b) {
  return String(a.projectKey || '').localeCompare(String(b.projectKey || ''))
    || String(a.key || '').localeCompare(String(b.key || ''));
}

function issuesInDeterministicOrder(issues) {
  return (issues || []).every((issue, index) => index === 0 || deterministicIssueCompare(issues[index - 1], issue) <= 0);
}

function validPayloadShape(payload) {
  return payload?.version === 1
    && Array.isArray(payload.projects)
    && Array.isArray(payload.issues);
}

function validEnvelopeMetadata(envelope) {
  return envelope?.version === 1
    && envelope?.cipher === 'AES-256-GCM'
    && envelope?.kdf === 'PBKDF2-SHA256'
    && envelope?.iterations === PBKDF2_ITERATIONS
    && typeof envelope?.contentSha256 === 'string'
    && typeof envelope?.generatedAt === 'string';
}

async function readPreviousState(filePath, passphrase, nowMs = Date.now()) {
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const envelope = JSON.parse(raw);
    if (!validEnvelopeMetadata(envelope)) return null;
    const payload = decryptPayload(envelope, passphrase);
    if (!validPayloadShape(payload) || !issuesInDeterministicOrder(payload.issues)) return null;
    if (contentHash(payload) !== envelope.contentSha256) return null;
    if (payload.generatedAt !== envelope.generatedAt) return null;
    const generatedAtMs = Date.parse(payload.generatedAt || '');
    if (Number.isNaN(generatedAtMs) || generatedAtMs > nowMs) return null;
    return { raw, envelope, payload, generatedAtMs, semanticHash: semanticHash(payload) };
  } catch {
    return null;
  }
}

function triggerKind(value) {
  const kind = String(value || 'manual').trim().toLowerCase();
  if (!TRIGGER_KINDS.has(kind)) throw new Error(`Unsupported REFRESH_TRIGGER_KIND: ${kind || '(empty)'}`);
  return kind;
}

export function shouldHeartbeatUnchanged(trigger, previousGeneratedAtMs, nowMs) {
  if (trigger === 'jira' || trigger === 'push') return false;
  return nowMs - previousGeneratedAtMs >= HEARTBEAT_AFTER_MS;
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function stabilizeProjection(initialProjection, acquire, {
  now = Date.now,
  delay = sleep,
  windowMs = STABILIZATION_WINDOW_MS,
  retryMs = STABILIZATION_RETRY_MS
} = {}) {
  const startedAt = now();
  let previous = initialProjection;
  while (now() - startedAt < windowMs) {
    await delay(retryMs);
    if (now() - startedAt > windowMs) break;
    const next = await acquire();
    if (semanticHash(next) === semanticHash(previous)) return next;
    previous = next;
  }
  throw new Error(`Jira projection did not stabilize within ${windowMs}ms.`);
}

async function writePreviousBytes(outputPath, previous) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, previous.raw, 'utf8');
}

async function acquireProjection(baseUrl, authHeader, config, maxIssues) {
  const issues = await searchIssues(baseUrl, authHeader, config.projects, maxIssues);
  const historiesByIssueId = await fetchStatusChangelogs(baseUrl, authHeader, issues);
  const mapped = issues.map(issue => ({
    key: issue.key,
    summary: issue.fields?.summary || '',
    status: issue.fields?.status?.name || '',
    statusCategory: issue.fields?.status?.statusCategory?.key || '',
    projectKey: issue.fields?.project?.key || '',
    projectName: issue.fields?.project?.name || issue.fields?.project?.key || '',
    updatedAt: issue.fields?.updated || '',
    lastMove: latestStatusMove(historiesByIssueId.get(String(issue.id)) || []),
    url: `${baseUrl}/browse/${encodeURIComponent(issue.key)}`
  })).sort(deterministicIssueCompare);
  return {
    version: 1,
    projects: [...config.projects],
    issues: mapped
  };
}

async function runSelfTest() {
  const histories = [
    { created: '2026-08-11T10:00:00.000-0500', items: [{ field: 'summary' }] },
    { created: 1786473296, items: [{ field: 'status', fieldId: 'status' }] }
  ];
  if (latestStatusMove(histories) !== '2026-08-11T18:34:56.000Z') {
    throw new Error('Status history ordering failed');
  }
  const payload = {
    version: 1, generatedAt: '2026-08-12T12:00:00.000Z',
    projects: ['MYR', 'BEN'],
    issues: [{ key: 'BEN-1', projectKey: 'BEN' }, { key: 'MYR-1', projectKey: 'MYR' }]
  };
  const passphrase = 'correct horse battery staple';
  const envelope = encryptPayload(payload, passphrase);
  if (!validPayloadShape(payload) || !validEnvelopeMetadata(envelope) ||
      JSON.stringify(decryptPayload(envelope, passphrase)) !== JSON.stringify(payload) ||
      contentHash(payload) !== envelope.contentSha256) {
    throw new Error('Jira Flight Control envelope self-test failed');
  }
  if (semanticHash(payload) !== semanticHash({ ...payload, generatedAt: '2026-08-12T12:10:00.000Z' }) ||
      semanticHash(payload) === semanticHash({ ...payload, issues: [] })) {
    throw new Error('Semantic refresh identity failed');
  }
  if (!issuesInDeterministicOrder(payload.issues) ||
      issuesInDeterministicOrder([...payload.issues].reverse())) {
    throw new Error('Jira issue sorting failed');
  }
  if (!buildActiveJql(['MYR', 'HOME']).includes('project in ("MYR", "HOME")') ||
      !buildDoneJql('MYR').includes('statusCategory = Done')) {
    throw new Error('Generic Jira JQL self-test failed');
  }
  const nowMs = Date.parse('2026-08-12T12:20:00.000Z');
  if (shouldHeartbeatUnchanged('jira', nowMs - HEARTBEAT_AFTER_MS, nowMs) ||
      !shouldHeartbeatUnchanged('schedule', nowMs - HEARTBEAT_AFTER_MS, nowMs) ||
      shouldHeartbeatUnchanged('schedule', nowMs - HEARTBEAT_AFTER_MS + 1, nowMs)) {
    throw new Error('Publisher heartbeat failed');
  }
  const directory = await fs.mkdtemp(path.join(process.cwd(), '.home26-refresh-selftest-'));
  try {
    const previous = path.join(directory, 'previous.enc.json');
    await fs.writeFile(previous, JSON.stringify(envelope));
    if (!await readPreviousState(previous, passphrase, nowMs) ||
        await readPreviousState(previous, 'wrong password', nowMs)) {
      throw new Error('Authenticated previous-state reuse failed');
    }
    await fs.writeFile(previous, '{not-json');
    if (await readPreviousState(previous, passphrase, nowMs)) {
      throw new Error('Malformed previous-state rejection failed');
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
  let fakeNow = 0, index = 0;
  const first = {version: 1, projects:['MYR'], issues:[{key:'MYR-1'}]};
  const later = {...first, issues:[{key:'MYR-2'}]};
  const settled = await stabilizeProjection(first, async () => [later, later][Math.min(index++, 1)], {
    now: () => fakeNow, delay: async ms => { fakeNow += ms; }
  });
  if (settled.issues[0].key !== 'MYR-2') throw new Error('Stabilization failed');
  console.log('Generic Jira Flight Control self-test passed; no BEN registry acquisition.');
}

async function verifyOutput(filePath) {
  if (!filePath) throw new Error('--verify-output requires an encrypted snapshot path.');
  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG;
  const config = await readJson(configPath);
  const baseUrl = normalizeBaseUrl(config.jiraBaseUrl);
  const passphrase = requiredEnv('DASHBOARD_DATA_PASSPHRASE');
  const envelope = await readJson(filePath);
  const payload = decryptPayload(envelope, passphrase);
  if (!validEnvelopeMetadata(envelope)) throw new Error('Encrypted snapshot envelope metadata is invalid.');
  if (!validPayloadShape(payload)) throw new Error('Encrypted snapshot payload structure is invalid.');
  if (!issuesInDeterministicOrder(payload.issues)) throw new Error('Encrypted snapshot issues are not in deterministic project/key order.');
  if (contentHash(payload) !== envelope.contentSha256) throw new Error('Encrypted snapshot content hash does not match decrypted payload.');
  if (Number.isNaN(Date.parse(payload.generatedAt || ''))) throw new Error('Encrypted snapshot payload generatedAt must be a valid timestamp.');
  if (payload.generatedAt !== envelope.generatedAt) throw new Error('Encrypted snapshot generatedAt metadata must match the decrypted payload.');
  if (JSON.stringify(payload.projects) !== JSON.stringify(config.projects)) throw new Error('Encrypted snapshot project configuration does not match the dashboard config.');
  if (!Array.isArray(payload.issues)) throw new Error('Encrypted snapshot issues must be an array.');

  const observedProjects = new Set();
  const doneCountByProject = new Map();
  for (const issue of payload.issues) {
    for (const field of ['key', 'summary', 'status', 'statusCategory', 'projectKey', 'projectName', 'updatedAt', 'url']) {
      if (typeof issue[field] !== 'string') throw new Error(`Encrypted snapshot issue field ${field} must be a string.`);
    }
    if (!issue.url.startsWith(`${baseUrl}/browse/`)) throw new Error(`Unexpected Jira issue URL for ${issue.key}.`);
    if (issue.lastMove != null && Number.isNaN(Date.parse(issue.lastMove))) throw new Error(`Invalid LAST MOVE value for ${issue.key}.`);
    if (Number.isNaN(Date.parse(issue.updatedAt))) throw new Error(`Invalid updatedAt value for ${issue.key}.`);
    if (issue.statusCategory === 'done') {
      const count = (doneCountByProject.get(issue.projectKey) || 0) + 1;
      doneCountByProject.set(issue.projectKey, count);
      if (count > RECENT_DONE_PER_PROJECT) throw new Error(`Snapshot contains more than ${RECENT_DONE_PER_PROJECT} Done issues for ${issue.projectKey}.`);
    }
    observedProjects.add(issue.projectKey);
  }
  const requiredProjects = String(process.env.VERIFY_PROJECTS || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const project of requiredProjects) {
    if (!observedProjects.has(project)) throw new Error(`Live snapshot is missing required verification project ${project}.`);
  }
  console.log(`Verified encrypted Jira snapshot with ${payload.issues.length} issues across ${[...observedProjects].sort().join(', ') || 'no active projects'}.`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const verifyIndex = process.argv.indexOf('--verify-output');
  if (verifyIndex >= 0) return verifyOutput(process.argv[verifyIndex + 1]);

  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG;
  const config = await readJson(configPath);
  const baseUrl = normalizeBaseUrl(config.jiraBaseUrl);
  const email = requiredEnv('JIRA_EMAIL');
  const apiToken = requiredEnv('JIRA_API_TOKEN');
  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
  const outputPath = process.env.OUTPUT_PATH || DEFAULT_OUTPUT;
  const previousPath = process.env.PREVIOUS_PATH || '';
  const passphrase = requiredEnv('DASHBOARD_DATA_PASSPHRASE');
  const maxIssues = Number.isFinite(Number(config.maxIssues)) ? Number(config.maxIssues) : 100;
  const trigger = triggerKind(process.env.REFRESH_TRIGGER_KIND || 'manual');
  const nowMs = Date.now();
  const previous = await readPreviousState(previousPath, passphrase, nowMs);
  const acquire = () => acquireProjection(baseUrl, authHeader, config, maxIssues);
  const first = await acquire();
  const firstHash = semanticHash(first);

  if (previous && firstHash === previous.semanticHash) {
    if (trigger === 'jira') {
      const stable = await stabilizeProjection(first, acquire);
      if (semanticHash(stable) === previous.semanticHash) {
        await writePreviousBytes(outputPath, previous);
        console.log('Reused unchanged Jira Flight Control envelope after Jira-trigger stabilization.');
        return;
      }
      const payload = { ...stable, generatedAt: new Date().toISOString() };
      const envelope = encryptPayload(payload, passphrase);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
      console.log(`Wrote stabilized Jira-triggered encrypted snapshot with ${stable.issues.length} issues.`);
      return;
    }

    if (!shouldHeartbeatUnchanged(trigger, previous.generatedAtMs, nowMs)) {
      await writePreviousBytes(outputPath, previous);
      console.log(`Reused unchanged Jira Flight Control envelope for ${trigger} refresh.`);
      return;
    }
  }

  const stable = await stabilizeProjection(first, acquire);
  if (previous && semanticHash(stable) === previous.semanticHash && !shouldHeartbeatUnchanged(trigger, previous.generatedAtMs, Date.now())) {
    await writePreviousBytes(outputPath, previous);
    console.log(`Reused Jira Flight Control envelope after stabilized ${trigger} refresh returned to prior semantics.`);
    return;
  }

  const payload = {
    ...stable,
    generatedAt: new Date().toISOString()
  };
  const envelope = encryptPayload(payload, passphrase);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  console.log(`Wrote stabilized encrypted Jira Flight Control snapshot with ${stable.issues.length} issues to ${outputPath}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
