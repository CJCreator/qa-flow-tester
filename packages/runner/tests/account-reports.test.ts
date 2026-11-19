/**
 * T-437 (ADR 0050): Check-up reports are copied to the bucket (local backend here) under the account, read back
 * after the local folder is gone, readable only by that account or the owner, and expire by lifecycle rule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import { AccountReports, reportKey } from '../src/account-reports.js';
import { accountHash } from '../src/account-usage.js';
import { createHelperAccess, MIN_SESSION_SECRET_CHARS } from '../src/helpers/helper-access.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const summary = (runId: string, timestamp: string) => ({
  runId,
  targetUrl: 'https://example.com',
  host: 'example.com',
  timestamp,
  durationMs: 1000,
  ready: true,
  stamp: 'ready',
  reason: 'ok',
  counts: { blocker: 0, major: 0, minor: 0, info: 0 },
});

async function runFolder(dir: string, runId: string, timestamp: string): Promise<string> {
  const run = path.join(dir, runId);
  await fs.mkdir(path.join(run, 'evidence'), { recursive: true });
  await fs.mkdir(path.join(run, 'auth'), { recursive: true });
  await fs.writeFile(path.join(run, 'report.json'), JSON.stringify({ runId, findings: [] }));
  await fs.writeFile(path.join(run, 'summary.json'), JSON.stringify(summary(runId, timestamp)));
  await fs.writeFile(path.join(run, 'report.md'), '# report');
  await fs.writeFile(path.join(run, 'evidence', 'shot 1.png'), 'png');
  await fs.writeFile(path.join(run, 'evidence', 'shot-2.png'), 'png2');
  await fs.writeFile(path.join(run, 'auth', 'admin.json'), 'cookies');
  return run;
}

let scratch: string;
beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-account-reports-'));
});
afterAll(async () => {
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
});

describe('AccountReports', () => {
  it('copies a run folder under reports/<hash>/<runId>/, skipping saved sign-ins and unsafe names', async () => {
    const backend = new LocalAuditStoreBackend(path.join(scratch, 'one'));
    const reports = new AccountReports(backend);
    const dir = await runFolder(path.join(scratch, 'runs1'), 'run-100', '2026-11-19T10:00:00.000Z');
    await reports.archive('Tester@example.com', 'run-100', dir, (rel) => rel.startsWith('auth/'));
    const hash = accountHash('tester@example.com');
    const keys = await backend.list(`reports/${hash}/run-100`);
    expect(keys).toContain(reportKey(hash, 'run-100', 'report.json'));
    expect(keys).toContain(reportKey(hash, 'run-100', 'evidence/shot-2.png'));
    expect(keys.some((k) => k.includes('auth/'))).toBe(false);
    expect(keys.some((k) => k.includes('shot 1'))).toBe(false);
    expect(keys.every((k) => !k.includes('tester'))).toBe(true);
  });

  it('lists and reads back only the account’s own runs; the owner can locate any', async () => {
    const backend = new LocalAuditStoreBackend(path.join(scratch, 'two'));
    const reports = new AccountReports(backend);
    const base = path.join(scratch, 'runs2');
    await reports.archive('a@x.com', 'run-1', await runFolder(base, 'run-1', '2026-11-18T10:00:00.000Z'));
    await reports.archive('a@x.com', 'run-2', await runFolder(base, 'run-2', '2026-11-19T10:00:00.000Z'));
    await reports.archive('b@x.com', 'run-3', await runFolder(base, 'run-3', '2026-11-19T11:00:00.000Z'));
    expect((await reports.list('a@x.com')).map((r) => r.runId)).toEqual(['run-2', 'run-1']);
    expect((await reports.list('b@x.com')).map((r) => r.runId)).toEqual(['run-3']);
    expect(await reports.has('a@x.com', 'run-3')).toBe(false);
    expect(await reports.locate('run-3')).toBe(accountHash('b@x.com'));
    expect(await reports.locate('run-9')).toBeNull();
    const bytes = await reports.read(accountHash('a@x.com'), 'run-1', 'report.md');
    expect(Buffer.from(bytes!).toString()).toBe('# report');
  });

  it('refuses an unsafe run id and never throws on a failing store', async () => {
    const failing = {
      getJson: async () => Promise.reject(new Error('down')),
      putBytes: async () => Promise.reject(new Error('down')),
      getBytes: async () => Promise.reject(new Error('down')),
      list: async () => Promise.reject(new Error('down')),
    };
    const reports = new AccountReports(failing);
    expect(await reports.archive('a@x.com', '../x', scratch)).toBe(0);
    expect(await reports.list('a@x.com')).toEqual([]);
    expect(await reports.has('a@x.com', 'run-1')).toBe(false);
    expect(await reports.read(accountHash('a@x.com'), 'run-1', 'report.json')).toBeNull();
    expect(await reports.locate('run-1')).toBeNull();
  });
});

describe('lifecycle rule', () => {
  it('deletes only objects under reports/ after 30 days', async () => {
    const rule = JSON.parse(await fs.readFile(path.join(process.cwd(), 'scripts', 'bucket-lifecycle.json'), 'utf8'));
    expect(rule.lifecycle.rule).toEqual([
      { action: { type: 'Delete' }, condition: { age: 30, matchesPrefix: ['reports/'] } },
    ]);
  });
});

const ACCESS = 'reports-access-key-0123456789';
const SECRET = 'r'.repeat(MIN_SESSION_SECRET_CHARS + 4);

function get(port: number, rawPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get({ host: 'localhost', port, path: rawPath, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      })
      .on('error', reject);
  });
}

describe('the runner reads saved reports after the local folder is gone', () => {
  let runner: RunnerServer;
  let port = 0;
  const cookie: Record<string, string> = {};

  beforeAll(async () => {
    const dataDir = path.join(scratch, 'data3');
    const access = createHelperAccess({
      projectId: 'proj',
      accessToken: ACCESS,
      sessionSecret: SECRET,
      store: { grantsFor: async () => [] },
    });
    for (const who of ['a@x.com', 'b@x.com']) {
      cookie[who] =
        `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), { email: who, sub: `u-${who}` }, access.now(), access.sessionSeconds, access.sessionSeconds)}`;
    }
    // The same data folder the runner will use, so its audit store is where we archive.
    const backend = new LocalAuditStoreBackend(dataDir);
    const reports = new AccountReports(backend);
    const base = path.join(scratch, 'runs3');
    await reports.archive('a@x.com', 'run-500', await runFolder(base, 'run-500', '2026-11-19T10:00:00.000Z'));
    port = await freePort();
    runner = new RunnerServer({
      port,
      outputDir: path.join(scratch, 'out3'),
      dataDir,
      accessToken: ACCESS,
      helperAccess: access,
      beta: true,
      hostChecks: { lookup: async () => ['93.184.216.34'], connect: async () => Promise.reject(new Error('no')) },
    });
    await runner.start();
  });

  afterAll(async () => {
    await runner?.stop();
  });

  it('lists the account’s saved run, and not another account’s', async () => {
    const mine = await get(port, '/api/runs', { cookie: cookie['a@x.com'] });
    expect(JSON.parse(mine.body).runs.map((r: { runId: string }) => r.runId)).toEqual(['run-500']);
    const other = await get(port, '/api/runs', { cookie: cookie['b@x.com'] });
    expect(JSON.parse(other.body).runs).toEqual([]);
  });

  it('serves the report, a download and an evidence file to that account only', async () => {
    const own = { cookie: cookie['a@x.com'] };
    expect(JSON.parse((await get(port, '/api/runs/run-500', own)).body).runId).toBe('run-500');
    const dl = await get(port, '/api/runs/run-500/download/report.md', own);
    expect(dl.status).toBe(200);
    expect(dl.body).toBe('# report');
    const shot = await get(port, '/api/evidence/runs/run-500/evidence/shot-2.png', own);
    expect(shot.status).toBe(200);
    expect(shot.body).toBe('png2');
    const theirs = { cookie: cookie['b@x.com'] };
    expect((await get(port, '/api/runs/run-500', theirs)).status).toBe(404);
    expect((await get(port, '/api/runs/run-500/download/report.md', theirs)).status).toBe(404);
    expect((await get(port, '/api/evidence/runs/run-500/evidence/shot-2.png', theirs)).status).toBe(404);
  });

  it('lets the owner (access key) read it too', async () => {
    const answer = await get(port, '/api/runs/run-500', { 'x-qa-access': ACCESS });
    expect(answer.status).toBe(200);
  });
});
