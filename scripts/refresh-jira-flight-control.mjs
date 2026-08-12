import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = 'dashboard/jira-flight-control.config.json';
const DEFAULT_OUTPUT = 'dashboard/jira-flight-control.enc.json';
const PBKDF2_ITERATIONS = 250_000;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildJql(projects) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('Config must contain at least one Jira project key.');
  }
  const quoted = projects.map(project => `"${String(project).replaceAll('"', '\\"')}"`).join(', ');
  return `project in (${quoted}) AND statusCategory != Done AND status != Shelved AND (labels IS EMPTY OR labels NOT IN ("shelved", "validated-not-pursuing")) ORDER BY project ASC, updated DESC`;
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
    if (!latest || timestamp > latest.timestamp) {
      latest = { timestamp, value: new Date(timestamp).toISOString() };
    }
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

async function searchIssues(baseUrl, authHeader, projects, maxIssues) {
  const issues = [];
  let nextPageToken;
  do {
    const body = {
      jql: buildJql(projects),
      maxResults: Math.min(100, Math.max(1, maxIssues - issues.length)),
      fields: ['summary', 'status', 'project']
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = await jiraFetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      body: JSON.stringify(body)
    }, authHeader);
    issues.push(...(page.issues || []));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && issues.length < maxIssues);
  return issues.slice(0, maxIssues);
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
  const stable = { version: payload.version, projects: payload.projects, issues: payload.issues };
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readPreviousEnvelope(filePath) {
  if (!filePath) return null;
  try { return await readJson(filePath); } catch { return null; }
}

async function runSelfTest() {
  const histories = [
    { created: '2026-08-11T10:00:00.000-0500', items: [{ field: 'summary' }] },
    { created: '2026-08-11T11:00:00.000-0500', items: [{ field: 'status', fieldId: 'status', fromString: 'To Do', toString: 'Ready' }] },
    { created: 1786473296, items: [{ field: 'status', fieldId: 'status', fromString: 'Ready', toString: 'In Progress' }] }
  ];
  if (latestStatusMove(histories) !== '2026-08-11T18:34:56.000Z') {
    throw new Error(`latestStatusMove self-test failed: ${latestStatusMove(histories)}`);
  }
  const payload = { version: 1, generatedAt: '2026-08-12T12:00:00.000Z', projects: ['MYR'], issues: [{ key: 'MYR-1' }] };
  const envelope = encryptPayload(payload, 'correct horse battery staple');
  if (JSON.stringify(decryptPayload(envelope, 'correct horse battery staple')) !== JSON.stringify(payload)) throw new Error('encryption self-test failed');
  const jql = buildJql(['MYR', 'HOME']);
  if (!jql.includes('project in ("MYR", "HOME")') || !jql.includes('status != Shelved')) throw new Error('JQL self-test failed');
  console.log('refresh-jira-flight-control self-test passed');
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG;
  const outputPath = process.env.OUTPUT_PATH || DEFAULT_OUTPUT;
  const previousPath = process.env.PREVIOUS_PATH || '';
  const config = await readJson(configPath);
  const baseUrl = normalizeBaseUrl(config.jiraBaseUrl);
  const email = requiredEnv('JIRA_EMAIL');
  const apiToken = requiredEnv('JIRA_API_TOKEN');
  const passphrase = requiredEnv('DASHBOARD_DATA_PASSPHRASE');
  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
  const maxIssues = Number.isFinite(Number(config.maxIssues)) ? Number(config.maxIssues) : 100;

  const issues = await searchIssues(baseUrl, authHeader, config.projects, maxIssues);
  const historiesByIssueId = await fetchStatusChangelogs(baseUrl, authHeader, issues);
  const mapped = issues.map(issue => ({
    key: issue.key,
    summary: issue.fields?.summary || '',
    status: issue.fields?.status?.name || '',
    projectKey: issue.fields?.project?.key || '',
    projectName: issue.fields?.project?.name || issue.fields?.project?.key || '',
    lastMove: latestStatusMove(historiesByIssueId.get(String(issue.id)) || []),
    url: `${baseUrl}/browse/${encodeURIComponent(issue.key)}`
  }));

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    projects: config.projects,
    issues: mapped
  };

  const previous = await readPreviousEnvelope(previousPath);
  const hash = contentHash(payload);
  const envelope = previous?.contentSha256 === hash
    ? previous
    : encryptPayload(payload, passphrase);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  console.log(`Wrote encrypted Jira Flight Control snapshot with ${mapped.length} issues to ${outputPath}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
