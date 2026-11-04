/**
 * T-68: on a copy with an access key, a verified Helper session (no key) loads the wizard page, its assets and
 * a reduced GET /api/runner/status, and nothing else outside the route table (ADR 0037 D-005). T-71: the AI
 * settings answer says where the key is kept, never the key.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { KeyResolver, type SecretStore } from '@qa/core';
import { createHelperAccess } from '../src/helpers/helper-access.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';
import { RunnerServer } from '../src/server.js';

const KEYED_PORT = 3571;
const LOCAL_PORT = 3572;
const BETA_PORT = 3573;
const ACCESS = 'wizard-access-key-0123456789';
// A fake key, joined at runtime so the build's secret scan (scripts/scan-build-secrets.mjs) does not match the source.
const SECRET = ['sk-or', 'secret-material-9876543210'].join('-');
const SUB = 'uid-1';

class MemoryStore implements SecretStore {
  secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
}

interface Answer {
  status: number;
  body: string;
  json: any;
}

function get(port: number, rawPath: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Answer> {
  return new Promise((resolve, reject) => {
    http
      .request(
        { host: 'localhost', port, path: rawPath, method, headers: { host: `localhost:${port}`, ...headers } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            let json: unknown;
            try {
              json = JSON.parse(body);
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode || 0, body, json });
          });
        }
      )
      .on('error', reject)
      .end();
  });
}

let scratch: string;
let keyed: RunnerServer;
let local: RunnerServer;
let beta: RunnerServer;
let good: string;
let expired: string;
let forged: string;

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-helper-wizard-'));
  const ui = path.join(scratch, 'ui');
  await fs.mkdir(path.join(ui, 'assets'), { recursive: true });
  await fs.writeFile(path.join(ui, 'index.html'), '<!doctype html><title>wizard</title>');
  await fs.writeFile(path.join(ui, 'assets', 'app.js'), 'console.log(1)');
  const apps = [{ base: '/', dir: ui, name: 'Wizard' }];

  const store = { grantsFor: async () => [] };
  const access = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store });
  const now = new Date();
  const who = { email: 'priya@example.com', sub: SUB };
  good = `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), who, now)}`;
  expired = `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), who, new Date(now.getTime() - 3 * 86_400_000))}`;
  const other = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store });
  forged = `${HELPER_COOKIE}=${signHelperSession(other.sessionKey(), who, now)}`;

  const keys = new MemoryStore();
  keys.secrets.set('openrouter', SECRET);
  keyed = new RunnerServer({
    port: KEYED_PORT,
    outputDir: path.join(scratch, 'keyed-report'),
    dataDir: path.join(scratch, 'keyed-data'),
    accessToken: ACCESS,
    helperAccess: access,
    ui: apps,
    keyResolver: new KeyResolver(path.join(scratch, 'keyed-data'), keys),
  });
  local = new RunnerServer({
    port: LOCAL_PORT,
    outputDir: path.join(scratch, 'local-report'),
    dataDir: path.join(scratch, 'local-data'),
    ui: apps,
  });
  beta = new RunnerServer({
    port: BETA_PORT,
    outputDir: path.join(scratch, 'beta-report'),
    dataDir: path.join(scratch, 'beta-data'),
    accessToken: ACCESS,
    helperAccess: access,
    ui: apps,
    beta: true,
  });
  await keyed.start();
  await beta.start();
  await local.start();
});

afterAll(async () => {
  await keyed?.stop();
  await local?.stop();
  await beta?.stop();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('T-68: a Helper session loads the hosted wizard', () => {
  it('serves the page, an asset and a reduced status to a Helper without the key', async () => {
    const cookie = { cookie: good };
    expect((await get(KEYED_PORT, '/', cookie)).status).toBe(200);
    expect((await get(KEYED_PORT, '/reports', cookie)).status).toBe(200);
    expect((await get(KEYED_PORT, '/assets/app.js', cookie)).status).toBe(200);
    expect((await get(KEYED_PORT, '/', cookie, 'HEAD')).status).toBe(200);
    const status = await get(KEYED_PORT, '/api/runner/status', cookie);
    expect(status.status).toBe(200);
    expect(status.json).toEqual({
      isRunning: false,
      hasReport: false,
      lastRunError: null,
      lastErrorCode: null,
      phase: 'idle',
      hasPlan: false,
      runId: null,
      targetUrl: null,
      reportRunId: null,
      beta: false,
      helper: true,
    });
  });

  it('refuses no cookie, an expired cookie and a cookie from another instance', async () => {
    const refused: Array<Record<string, string>> = [
      {},
      { cookie: expired },
      { cookie: forged },
      { cookie: `${HELPER_COOKIE}=garbage` },
    ];
    for (const headers of refused) {
      for (const p of ['/', '/assets/app.js', '/api/runner/status']) {
        expect((await get(KEYED_PORT, p, headers)).status, p).toBe(401);
      }
    }
  });

  it('does not open anything else: owner endpoints, writes, other API paths', async () => {
    const cookie = { cookie: good };
    for (const p of ['/api/ai/settings', '/api/runner/plan', '/api/report', '/api/runs', '/api/settings/defaults']) {
      const r = await get(KEYED_PORT, p, cookie);
      expect([401, 403], p).toContain(r.status);
    }
    expect((await get(KEYED_PORT, '/api/runner/status', cookie, 'POST')).status).toBe(401);
    expect((await get(KEYED_PORT, '/', cookie, 'POST')).status).toBe(401);
    expect((await get(KEYED_PORT, '/api/ai/settings', cookie, 'POST')).status).toBe(401);
  });

  it('gives the owner the full status without a helper field', async () => {
    const status = await get(KEYED_PORT, '/api/runner/status', { 'x-qa-access': ACCESS, cookie: good });
    expect(status.status).toBe(200);
    expect(status.json).not.toHaveProperty('helper');
  });

  it('leaves local use with no key unchanged', async () => {
    const status = await get(LOCAL_PORT, '/api/runner/status');
    expect(status.status).toBe(200);
    expect(status.json).not.toHaveProperty('helper');
    expect((await get(LOCAL_PORT, '/')).status).toBe(200);
    // a Helper cookie means nothing here
    expect((await get(LOCAL_PORT, '/api/runner/status', { cookie: good })).json).not.toHaveProperty('helper');
  });
});

describe('T-71: the AI settings say where the key is kept', () => {
  it('adds keySource when a key is set, and never the key', async () => {
    const answer = await get(KEYED_PORT, '/api/ai/settings', { 'x-qa-access': ACCESS });
    expect(answer.status).toBe(200);
    expect(answer.json.configured).toBe(true);
    expect(['cli', 'keychain', 'byok_file', 'env']).toContain(answer.json.keySource);
    expect(answer.body).not.toContain(SECRET);
    expect(answer.json).not.toHaveProperty('apiKey');
    expect(answer.json).not.toHaveProperty('key');
  });

  it('omits keySource when no key is configured', async () => {
    const answer = await get(LOCAL_PORT, '/api/ai/settings');
    if (!answer.json.configured) expect(answer.json).not.toHaveProperty('keySource');
  });
});

describe('T-68 on the hosted copy (access key and beta)', () => {
  it('serves a Helper the page, an asset and the reduced status with beta and helper true', async () => {
    const cookie = { cookie: good };
    expect((await get(BETA_PORT, '/', cookie)).status).toBe(200);
    expect((await get(BETA_PORT, '/assets/app.js', cookie)).status).toBe(200);
    const status = await get(BETA_PORT, '/api/runner/status', cookie);
    expect(status.status).toBe(200);
    expect(status.json).toEqual({
      isRunning: false,
      hasReport: false,
      lastRunError: null,
      lastErrorCode: null,
      phase: 'idle',
      hasPlan: false,
      runId: null,
      targetUrl: null,
      reportRunId: null,
      beta: true,
      helper: true,
    });
  });

  it('refuses no cookie, and keeps owner rows closed to a Helper', async () => {
    for (const p of ['/', '/assets/app.js', '/api/runner/status']) {
      expect((await get(BETA_PORT, p)).status, p).toBe(401);
    }
    const cookie = { cookie: good };
    expect([401, 403]).toContain((await get(BETA_PORT, '/api/audits', cookie, 'POST')).status);
    expect([401, 403]).toContain((await get(BETA_PORT, '/api/audit-settings', cookie)).status);
    expect([401, 403]).toContain((await get(BETA_PORT, '/api/ai/settings', cookie)).status);
  });
});
