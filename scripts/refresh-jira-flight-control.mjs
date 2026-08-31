import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { projectBenchmarkRegistry, REGISTRY_QUERY_LABELS } from './benchmark-registry.mjs';

const DEFAULT_CONFIG = 'dashboard/jira-flight-control.config.json';
const DEFAULT_OUTPUT = 'dashboard/jira-flight-control.enc.json';
const PBKDF2_ITERATIONS = 250_000;
const RECENT_DONE_PER_PROJECT = 3;
const BENCHMARK_PROJECT = 'BEN';
const BENCHMARK_POINTER_SUMMARY = 'Benchmark Registry Next Pointer';
const BENCHMARK_PARTICIPANT_FIELDS = ['summary', 'status', 'project', 'labels', 'updated', 'issuelinks'];
const BENCHMARK_RESULT_LABELS = new Set(['registry-result-summary', 'registry-result-unknown']);

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

function benchmarkProjectKey(config) {
  const projectKey = String(config?.benchmarkRegistryProject || '').trim();
  if (projectKey !== BENCHMARK_PROJECT) {
    throw new Error(`Dashboard benchmarkRegistryProject must remain ${BENCHMARK_PROJECT}.`);
  }
  return projectKey;
}

export function buildBenchmarkRegistryJql(projectKey) {
  const labels = REGISTRY_QUERY_LABELS.map(quoteJqlValue).join(', ');
  return `project = ${quoteJqlValue(projectKey)} AND labels IN (${labels}) ORDER BY key ASC`;
}

export function buildBenchmarkPointerIdentityJql(projectKey) {
  return `project = ${quoteJqlValue(projectKey)} AND summary ~ ${quoteJqlValue(`"${BENCHMARK_POINTER_SUMMARY}"`)} ORDER BY key ASC`;
}

function buildBenchmarkResultDescriptionJql(keys) {
  if (!Array.isArray(keys) || !keys.length) throw new Error('Result Description query requires at least one BEN key.');
  return `key in (${keys.map(quoteJqlValue).join(', ')}) ORDER BY key ASC`;
}

function benchmarkIssueLabels(issue) {
  return new Set((issue?.fields?.labels || []).map(label => String(label || '').trim().toLowerCase()).filter(Boolean));
}

function needsBenchmarkDescription(issue) {
  const labels = benchmarkIssueLabels(issue);
  return [...BENCHMARK_RESULT_LABELS].some(label => labels.has(label));
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

async function hydrateBenchmarkResultDescriptions(baseUrl, authHeader, issues) {
  const required = (issues || []).filter(needsBenchmarkDescription);
  if (!required.length) return issues;
  const expectedKeys = required.map(issue => String(issue?.key || '').trim()).filter(Boolean);
  if (expectedKeys.length !== required.length || new Set(expectedKeys).size !== expectedKeys.length) {
    throw new Error('Result-mode BEN records contain missing or duplicate issue keys.');
  }
  const details = await searchJqlIssues(
    baseUrl,
    authHeader,
    buildBenchmarkResultDescriptionJql(expectedKeys),
    expectedKeys.length,
    ['description'],
    { requireComplete: true, context: 'BEN registry result Description query' }
  );
  const detailByKey = new Map(details.map(issue => [String(issue?.key || '').trim(), issue]));
  if (detailByKey.size !== expectedKeys.length || expectedKeys.some(key => !detailByKey.has(key))) {
    throw new Error('BEN registry result Description query did not return every exact result-mode issue.');
  }
  for (const key of expectedKeys) {
    const fields = detailByKey.get(key)?.fields;
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, 'description')) {
      throw new Error(`BEN registry result Description is unavailable for ${key}.`);
    }
  }
  return (issues || []).map(issue => {
    const key = String(issue?.key || '').trim();
    if (!detailByKey.has(key)) return issue;
    return { ...issue, fields: { ...issue.fields, description: detailByKey.get(key).fields.description } };
  });
}

async function fetchJiraNativeBenchmarkRegistry(baseUrl, authHeader, config) {
  const projectKey = benchmarkProjectKey(config);
  const pointerKey = String(config.benchmarkRegistryPointerKey || 'BEN-21').trim();
  const maxIssues = Number.isFinite(Number(config.benchmarkRegistryMaxIssues)) ? Number(config.benchmarkRegistryMaxIssues) : 100;
  try {
    const participants = await searchJqlIssues(
      baseUrl,
      authHeader,
      buildBenchmarkRegistryJql(projectKey),
      maxIssues,
      BENCHMARK_PARTICIPANT_FIELDS,
      { requireComplete: true, context: 'BEN registry participant query' }
    );
    const issues = await hydrateBenchmarkResultDescriptions(baseUrl, authHeader, participants);

    let pointerIssue = null;
    try {
      pointerIssue = await jiraFetch(
        `${baseUrl}/rest/api/3/issue/${encodeURIComponent(pointerKey)}?fields=summary,parent,updated,labels,issuetype`,
        {},
        authHeader
      );
    } catch (error) {
      console.warn(`Benchmark pointer ${pointerKey} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    let pointerMatches = [];
    try {
      pointerMatches = await searchJqlIssues(
        baseUrl,
        authHeader,
        buildBenchmarkPointerIdentityJql(projectKey),
        20,
        ['summary'],
        { requireComplete: true, context: 'BEN registry pointer identity query' }
      );
    } catch (error) {
      console.warn(`Benchmark pointer identity query is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    return projectBenchmarkRegistry(issues, {
      pointerIssue,
      pointerMatches,
      sourceKey: projectKey,
      sourceLabel: 'Jira-native BEN registry'
    });
  } catch (error) {
    console.warn(`Jira-native BEN registry is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return {
      state: 'unavailable',
      authority: 'jira-native',
      sourceKey: projectKey,
      sourceLabel: 'Jira-native BEN registry',
      updatedAt: '',
      message: 'Jira-native BEN registry is unavailable.'
    };
  }
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
    issues: payload.issues,
    benchmarkReview: payload.benchmarkReview
  };
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readPreviousEnvelope(filePath) {
  if (!filePath) return null;
  try { return await readJson(filePath); } catch { return null; }
}

function benchmarkFixtureIssue(key, labels, category, updated = '2026-08-18T12:00:00.000Z') {
  return {
    key,
    fields: {
      summary: `${key} fixture`,
      labels,
      status: { statusCategory: { key: category } },
      project: { key: 'BEN' },
      updated,
      description: '',
      issuelinks: []
    }
  };
}

async function runSelfTest() {
  const histories = [
    { created: '2026-08-11T10:00:00.000-0500', items: [{ field: 'summary' }] },
    { created: '2026-08-11T11:00:00.000-0500', items: [{ field: 'status', fieldId: 'status', fromString: 'To Do', toString: 'Ready' }] },
    { created: 1786473296, items: [{ field: 'status', fieldId: 'status', fromString: 'Ready', toString: 'In Progress' }] }
  ];
  if (latestStatusMove(histories) !== '2026-08-11T18:34:56.000Z') throw new Error('latestStatusMove self-test failed');

  const selectedIssue = benchmarkFixtureIssue('BEN-17', ['candidate-evaluation'], 'new');
  const summaryIssue = benchmarkFixtureIssue('BEN-9', ['candidate-evaluation', 'registry-result-summary'], 'done');
  const unknownIssue = benchmarkFixtureIssue('BEN-10', ['candidate-evaluation', 'registry-result-unknown'], 'done');
  if (BENCHMARK_PARTICIPANT_FIELDS.includes('description')) throw new Error('Benchmark participant query must not fetch Description eagerly');
  if (needsBenchmarkDescription(selectedIssue)) throw new Error('Non-result benchmark must not fetch Description');
  if (!needsBenchmarkDescription(summaryIssue) || !needsBenchmarkDescription(unknownIssue)) throw new Error('Result-mode benchmarks must fetch their owning Description');
  const resultDescriptionJql = buildBenchmarkResultDescriptionJql(['BEN-9', 'BEN-10']);
  if (!resultDescriptionJql.includes('"BEN-9"') || !resultDescriptionJql.includes('"BEN-10"')) throw new Error('Result Description JQL must target exact result-mode keys');

  benchmarkProjectKey({ benchmarkRegistryProject: 'BEN' });
  let wrongProjectFailed = false;
  try { benchmarkProjectKey({ benchmarkRegistryProject: 'OTHER' }); } catch { wrongProjectFailed = true; }
  if (!wrongProjectFailed) throw new Error('Benchmark project drift must fail closed');

  const benchmarkReview = projectBenchmarkRegistry([selectedIssue], {
    pointerIssue: {
      key: 'BEN-21',
      fields: {
        summary: BENCHMARK_POINTER_SUMMARY,
        parent: { key: 'BEN-17' },
        updated: '2026-08-18T12:01:00.000Z',
        labels: [],
        issuetype: { name: 'Subtask', subtask: true }
      }
    },
    pointerMatches: [{ key: 'BEN-21', fields: { summary: BENCHMARK_POINTER_SUMMARY } }]
  });
  if (benchmarkReview.state !== 'ready' || benchmarkReview.authority !== 'jira-native') throw new Error('benchmark Jira-native self-test failed');
  if (benchmarkReview.selectedNext?.key !== 'BEN-17' || benchmarkReview.selectedNext?.status !== 'Preparing') throw new Error('benchmark pointer self-test failed');

  const payload = {
    version: 1,
    generatedAt: '2026-08-12T12:00:00.000Z',
    projects: ['MYR', 'BEN'],
    issues: [{ key: 'MYR-1' }],
    benchmarkReview
  };
  const passphrase = 'correct horse battery staple';
  const envelope = encryptPayload(payload, passphrase);
  if (JSON.stringify(decryptPayload(envelope, passphrase)) !== JSON.stringify(payload)) throw new Error('encryption self-test failed');
  const hash = contentHash(payload);
  if (!canReuseEnvelope(envelope, hash, passphrase)) throw new Error('same-key envelope reuse self-test failed');
  if (canReuseEnvelope(envelope, hash, 'rotated dashboard passphrase')) throw new Error('passphrase rotation self-test failed');
  if (contentHash({ ...payload, benchmarkReview: { ...benchmarkReview, updatedAt: '2026-08-18T12:15:00.000Z' } }) === hash) throw new Error('benchmark registry must participate in snapshot identity');
  if (contentHash({ ...payload, generatedAt: '2026-08-12T12:15:00.000Z' }) === hash) throw new Error('generatedAt must participate in snapshot identity');

  const activeJql = buildActiveJql(['MYR', 'HOME', 'BEN']);
  if (
    !activeJql.includes('project in ("MYR", "HOME", "BEN")')
    || !activeJql.includes('status != Shelved')
    || !activeJql.includes('statusCategory != Done')
    || !activeJql.includes('status NOT IN ("To Do", "Backlog", "Ready", "New")')
    || activeJql.includes('"Open"')
  ) throw new Error('active JQL self-test failed');

  const doneJql = buildDoneJql('BEN');
  if (
    !doneJql.includes('project = "BEN"')
    || !doneJql.includes('statusCategory = Done')
    || !doneJql.includes('ORDER BY statusCategoryChangedDate DESC')
    || doneJql.includes('-7d')
  ) throw new Error('Done JQL self-test failed');

  const registryJql = buildBenchmarkRegistryJql('BEN');
  if (
    !registryJql.includes('labels IN (')
    || !registryJql.includes('"candidate-evaluation"')
    || !registryJql.includes('"benchmark-testing"')
    || !registryJql.includes('"registry-idea"')
    || registryJql.includes('"registry-blocked"')
    || registryJql.includes('"registry-result-summary"')
  ) throw new Error('Benchmark registry JQL participation-boundary self-test failed');
  if (!buildBenchmarkPointerIdentityJql('BEN').includes('Benchmark Registry Next Pointer')) throw new Error('Benchmark pointer identity JQL self-test failed');

  let boundedSearchFailed = false;
  try { assertCompleteSearch('next-page', 100, 100, 'BEN registry participant query'); } catch (error) {
    boundedSearchFailed = /exceeded the configured maximum/.test(String(error?.message || error));
  }
  if (!boundedSearchFailed) throw new Error('Benchmark registry bounded-query self-test failed');
  console.log('refresh-jira-flight-control self-test passed');
}

async function verifyOutput(filePath) {
  if (!filePath) throw new Error('--verify-output requires an encrypted snapshot path.');
  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG;
  const config = await readJson(configPath);
  const baseUrl = normalizeBaseUrl(config.jiraBaseUrl);
  const projectKey = benchmarkProjectKey(config);
  const passphrase = requiredEnv('DASHBOARD_DATA_PASSPHRASE');
  const envelope = await readJson(filePath);
  const payload = decryptPayload(envelope, passphrase);
  if (Number.isNaN(Date.parse(payload.generatedAt || ''))) throw new Error('Encrypted snapshot payload generatedAt must be a valid timestamp.');
  if (payload.generatedAt !== envelope.generatedAt) throw new Error('Encrypted snapshot generatedAt metadata must match the decrypted payload.');
  if (JSON.stringify(payload.projects) !== JSON.stringify(config.projects)) throw new Error('Encrypted snapshot project configuration does not match the dashboard config.');
  if (!Array.isArray(payload.issues)) throw new Error('Encrypted snapshot issues must be an array.');
  if (!payload.benchmarkReview || typeof payload.benchmarkReview !== 'object') throw new Error('Encrypted snapshot benchmarkReview must be an object.');
  if (payload.benchmarkReview.authority !== 'jira-native') throw new Error('Encrypted snapshot benchmark registry authority must be jira-native.');
  if (payload.benchmarkReview.sourceKey !== projectKey) throw new Error('Encrypted snapshot benchmark registry source key must be BEN.');
  if (payload.benchmarkReview.sourceLabel !== 'Jira-native BEN registry') throw new Error('Encrypted snapshot benchmark registry source label must be Jira-native BEN registry.');
  if (!['ready', 'unavailable'].includes(payload.benchmarkReview.state)) throw new Error('Encrypted snapshot benchmarkReview state is invalid.');

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
  console.log(`Verified encrypted Jira snapshot with ${payload.issues.length} issues across ${[...observedProjects].sort().join(', ') || 'no active projects'}; benchmark registry ${payload.benchmarkReview.authority}/${payload.benchmarkReview.state}.`);
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const verifyIndex = process.argv.indexOf('--verify-output');
  if (verifyIndex >= 0) return verifyOutput(process.argv[verifyIndex + 1]);

  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG;
  const config = await readJson(configPath);
  benchmarkProjectKey(config);
  const baseUrl = normalizeBaseUrl(config.jiraBaseUrl);
  const email = requiredEnv('JIRA_EMAIL');
  const apiToken = requiredEnv('JIRA_API_TOKEN');
  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
  const outputPath = process.env.OUTPUT_PATH || DEFAULT_OUTPUT;
  const previousPath = process.env.PREVIOUS_PATH || '';
  const passphrase = requiredEnv('DASHBOARD_DATA_PASSPHRASE');
  const maxIssues = Number.isFinite(Number(config.maxIssues)) ? Number(config.maxIssues) : 100;

  const [issues, benchmarkReview] = await Promise.all([
    searchIssues(baseUrl, authHeader, config.projects, maxIssues),
    fetchJiraNativeBenchmarkRegistry(baseUrl, authHeader, config)
  ]);
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
  }));

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    projects: config.projects,
    issues: mapped,
    benchmarkReview
  };
  const previous = await readPreviousEnvelope(previousPath);
  const hash = contentHash(payload);
  const envelope = canReuseEnvelope(previous, hash, passphrase) ? previous : encryptPayload(payload, passphrase);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  console.log(`Wrote encrypted Jira Flight Control snapshot with ${mapped.length} issues and benchmark registry ${benchmarkReview.authority}/${benchmarkReview.state} to ${outputPath}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
