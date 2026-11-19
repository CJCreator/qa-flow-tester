/**
 * T-434 (ADR 0050): a signed-in Google account is a way in to the Check-up routes of a beta copy in account
 * mode (RUNNER_SESSION_SECRET set). Pure checks first, then a real beta server.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { authorizeRoute, type RouteCaller } from '../src/routes/route.js';
import { accountMayReach } from '../src/routes/account-paths.js';
import { createHelperAccess, helperSettingsFromEnv, MIN_SESSION_SECRET_CHARS } from '../src/helpers/helper-access.js';
import {
  ACCOUNT_SESSION_SECONDS,
  HELPER_COOKIE,
  HELPER_SESSION_SECONDS,
  readHelperSessionValue,
  signHelperSession,
} from '../src/helpers/helper-session.js';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const ACCESS = 'account-access-key-0123456789';
const SECRET = 's'.repeat(MIN_SESSION_SECRET_CHARS + 8);
const WHO = { email: 'tester@example.com', sub: 'uid-9' };
const store = { grantsFor: async () => [] };

const STRANGER: RouteCaller = { hasAccessKey: false, beta: true };

describe('authorizeRoute: the account level', () => {
  it('lets the key and a signed-in account in, and refuses a stranger with ERR_ACCOUNT_REQUIRED', () => {
    expect(authorizeRoute({ access: 'account', beta: 'allow' }, { ...STRANGER, account: true })).toEqual({
      allow: true,
    });
    expect(authorizeRoute({ access: 'account', beta: 'allow' }, { ...STRANGER, hasAccessKey: true })).toEqual({
      allow: true,
    });
    expect(authorizeRoute({ access: 'account', beta: 'allow' }, STRANGER)).toMatchObject({
      allow: false,
      status: 401,
      code: 'ERR_ACCOUNT_REQUIRED',
    });
  });

  it('is closed on a beta copy unless the row allows beta', () => {
    expect(authorizeRoute({ access: 'account' }, { ...STRANGER, account: true })).toMatchObject({
      allow: false,
      code: 'ERR_BETA',
    });
  });

  it('never opens an owner row to an account', () => {
    expect(authorizeRoute({ access: 'owner', beta: 'allow' }, { ...STRANGER, account: true })).toMatchObject({
      allow: false,
      status: 401,
    });
  });
});

describe('accountMayReach: the inline Check-up paths', () => {
  it('lists the Check-up endpoints', () => {
    expect(accountMayReach('POST', '/api/runner/run')).toBe(true);
    expect(accountMayReach('GET', '/api/runner/status')).toBe(true);
    expect(accountMayReach('GET', '/api/runner/stream')).toBe(true);
    expect(accountMayReach('GET', '/api/runs/run-1/download/report.md')).toBe(true);
    expect(accountMayReach('GET', '/api/evidence/runs/run-1/a.png')).toBe(true);
    expect(accountMayReach('POST', '/api/runner/domain-proof')).toBe(true);
    expect(accountMayReach('POST', '/api/ai/settings')).toBe(true);
    expect(accountMayReach('POST', '/api/ai/openrouter/key')).toBe(true);
    expect(accountMayReach('POST', '/api/ai/openrouter/validate')).toBe(true);
  });

  it('keeps everything else on the access key', () => {
    expect(accountMayReach('GET', '/api/sites')).toBe(false);
    expect(accountMayReach('POST', '/api/settings/defaults')).toBe(false);
    expect(accountMayReach('POST', '/api/runner/baselines/accept')).toBe(false);
    expect(accountMayReach('POST', '/api/runner/benchmark')).toBe(false);
    expect(accountMayReach('POST', '/api/runner/spec-override')).toBe(false);
    expect(accountMayReach('GET', '/api/runner/run')).toBe(false);
    // Only what a visitor needs for their OWN key: no model lists, test-model, usage or free-model lookups.
    for (const p of [
      '/api/ai/gemini/models',
      '/api/ai/test-model',
      '/api/ai/usage',
      '/api/ai/openrouter/free-models',
      '/api/ai/other',
    ]) {
      expect(accountMayReach('GET', p), p).toBe(false);
      expect(accountMayReach('POST', p), p).toBe(false);
    }
  });
});

describe('HelperAccess in account mode', () => {
  it('turns on without an access key once a long enough session secret is set', () => {
    const on = createHelperAccess({ projectId: 'proj', sessionSecret: SECRET, store });
    expect(on.enabled).toBe(true);
    expect(on.accounts).toBe(true);
    expect(on.sessionSeconds).toBe(ACCOUNT_SESSION_SECONDS);
    const short = createHelperAccess({ projectId: 'proj', sessionSecret: 'too-short', store });
    expect(short.enabled).toBe(false);
    expect(short.accounts).toBe(false);
  });

  it('keeps today’s random key and 8 hours without the secret', () => {
    const a = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store });
    const b = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store });
    expect(a.accounts).toBe(false);
    expect(a.sessionSeconds).toBe(HELPER_SESSION_SECONDS);
    expect(a.sessionKey().equals(b.sessionKey())).toBe(false);
  });

  it('signs with a key that survives a restart: a new instance accepts the old cookie', () => {
    const first = createHelperAccess({ projectId: 'proj', sessionSecret: SECRET, store });
    const restarted = createHelperAccess({ projectId: 'proj', sessionSecret: SECRET, store });
    const other = createHelperAccess({ projectId: 'proj', sessionSecret: `${SECRET}x`, store });
    const now = new Date();
    const value = signHelperSession(first.sessionKey(), WHO, now, first.sessionSeconds, first.sessionSeconds);
    expect(readHelperSessionValue(restarted.sessionKey(), value, now, restarted.sessionSeconds)?.email).toBe(WHO.email);
    expect(readHelperSessionValue(other.sessionKey(), value, now, other.sessionSeconds)).toBeNull();
  });

  it('lasts 7 days for an account, and no cookie signed for longer is read', () => {
    const access = createHelperAccess({ projectId: 'proj', sessionSecret: SECRET, store });
    const now = new Date();
    const week = signHelperSession(access.sessionKey(), WHO, now, ACCOUNT_SESSION_SECONDS, ACCOUNT_SESSION_SECONDS);
    expect(readHelperSessionValue(access.sessionKey(), week, now, ACCOUNT_SESSION_SECONDS)).not.toBeNull();
    // The default reader (a copy without the secret) still refuses anything longer than 8 hours.
    expect(readHelperSessionValue(access.sessionKey(), week, now)).toBeNull();
    const later = new Date(now.getTime() + (ACCOUNT_SESSION_SECONDS + 5) * 1000);
    expect(readHelperSessionValue(access.sessionKey(), week, later, ACCOUNT_SESSION_SECONDS)).toBeNull();
  });

  it('reads RUNNER_SESSION_SECRET from the environment', () => {
    expect(helperSettingsFromEnv({ RUNNER_SESSION_SECRET: SECRET } as NodeJS.ProcessEnv).sessionSecret).toBe(SECRET);
  });
});

interface Answer {
  status: number;
  json: any;
  setCookie: string[];
}

function call(port: number, method: string, rawPath: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: rawPath,
        method,
        headers: { host: `localhost:${port}`, 'content-type': 'application/json', ...headers },
      },
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
          resolve({ status: res.statusCode || 0, json, setCookie: res.headers['set-cookie'] ?? [] });
        });
      }
    );
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

describe('a beta copy in account mode', () => {
  let scratch: string;
  let accountRunner: RunnerServer;
  let plainBeta: RunnerServer;
  let accountPort = 0;
  let plainPort = 0;
  let cookie: string;
  let cookieB: string;
  let plainCookie: string;

  beforeAll(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-account-access-'));
    const access = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, sessionSecret: SECRET, store });
    cookie = `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), WHO, access.now(), access.sessionSeconds, access.sessionSeconds)}`;
    cookieB = `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), { email: 'other@example.com', sub: 'uid-10' }, access.now(), access.sessionSeconds, access.sessionSeconds)}`;
    const noAccounts = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store });
    plainCookie = `${HELPER_COOKIE}=${signHelperSession(noAccounts.sessionKey(), WHO, noAccounts.now())}`;
    [accountPort, plainPort] = await Promise.all([freePort(), freePort()]);
    accountRunner = new RunnerServer({
      port: accountPort,
      outputDir: path.join(scratch, 'a-report'),
      dataDir: path.join(scratch, 'a-data'),
      accessToken: ACCESS,
      helperAccess: access,
      beta: true,
    });
    plainBeta = new RunnerServer({
      port: plainPort,
      outputDir: path.join(scratch, 'p-report'),
      dataDir: path.join(scratch, 'p-data'),
      accessToken: ACCESS,
      helperAccess: noAccounts,
      beta: true,
    });
    await accountRunner.start();
    await plainBeta.start();
  });

  afterAll(async () => {
    await accountRunner?.stop();
    await plainBeta?.stop();
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  });

  it('answers a stranger’s status with accounts true, account null and no run details', async () => {
    const status = await call(accountPort, 'GET', '/api/runner/status');
    expect(status.status).toBe(200);
    expect(status.json).toMatchObject({ accounts: true, account: null, isRunning: false, runId: null, beta: true });
  });

  it('answers a signed-in account the real status with its email', async () => {
    const status = await call(accountPort, 'GET', '/api/runner/status', { cookie });
    expect(status.status).toBe(200);
    expect(status.json.account).toBe(WHO.email);
    expect(status.json.accounts).toBe(true);
    expect(status.json.helper).toBeUndefined();
  });

  it('refuses a stranger a Check-up and lets an account reach it', async () => {
    const stranger = await call(accountPort, 'POST', '/api/runner/run');
    expect(stranger.status).toBe(401);
    const account = await call(accountPort, 'POST', '/api/runner/run', { cookie });
    // Reached the handler: it refuses the empty body (400/422), not the gate.
    expect([400, 422]).toContain(account.status);
  });

  it('lets an account into a plan row, and refuses a stranger there with ERR_ACCOUNT_REQUIRED', async () => {
    const stranger = await call(accountPort, 'GET', '/api/runner/plan');
    expect(stranger.status).toBe(401);
    expect(stranger.json.code).toBe('ERR_ACCOUNT_REQUIRED');
    const account = await call(accountPort, 'GET', '/api/runner/plan', { cookie });
    expect(account.status).not.toBe(401);
    expect(account.status).not.toBe(403);
  });

  it('keeps the owner-only paths closed to an account', async () => {
    for (const [method, p] of [
      ['GET', '/api/sites'],
      ['POST', '/api/settings/defaults'],
      ['POST', '/api/runner/benchmark'],
      ['GET', '/api/runner/schedules'],
      ['GET', '/api/audit-settings'],
      ['GET', '/api/ai/usage'],
      ['POST', '/api/ai/test-model'],
      ['GET', '/api/ai/gemini/models'],
      ['GET', '/api/ai/openrouter/free-models'],
      ['POST', '/api/runner/baselines/accept'],
      ['GET', '/api/baselines/x.png'],
      ['POST', '/api/runner/spec-override'],
      ['GET', '/api/runner/spec-overrides'],
      ['POST', '/api/runner/session/cleanup'],
    ] as const) {
      const answer = await call(accountPort, method, p, { cookie });
      expect([401, 403], `${method} ${p}`).toContain(answer.status);
    }
  });

  it('a key holder with no Google session is not asked to sign in: status says viaKey', async () => {
    const status = await call(accountPort, 'GET', '/api/runner/status', { 'x-qa-access': ACCESS });
    expect(status.json).toMatchObject({ accounts: true, account: null, viaKey: true });
    const anonymous = await call(accountPort, 'GET', '/api/runner/status');
    expect(anonymous.json.viaKey).toBeUndefined();
    const account = await call(accountPort, 'GET', '/api/runner/status', { cookie });
    expect(account.json.viaKey).toBeUndefined();
  });

  it('a browser session bound to one account is not handed to another account or to a signed-out visitor', async () => {
    const first = await call(accountPort, 'GET', '/api/runner/status', { cookie });
    const sessionCookie = first.setCookie.find((c) => c.startsWith('qa_session='))!;
    expect(sessionCookie).toBeTruthy();
    const pair = sessionCookie.split(';')[0];
    // Same account again: the session is kept (no new cookie).
    const same = await call(accountPort, 'GET', '/api/runner/status', { cookie: `${cookie}; ${pair}` });
    expect(same.setCookie.some((c) => c.startsWith('qa_session='))).toBe(false);
    // Another account on the same browser: a fresh session.
    const other = await call(accountPort, 'GET', '/api/runner/status', { cookie: `${cookieB}; ${pair}` });
    const replaced = other.setCookie.find((c) => c.startsWith('qa_session='));
    expect(replaced).toBeTruthy();
    expect(replaced!.split(';')[0]).not.toBe(pair);
    // The key (no account) on that browser also gets a fresh session, never the account's.
    const viaKey = await call(accountPort, 'GET', '/api/runner/status', { cookie: pair, 'x-qa-access': ACCESS });
    expect(viaKey.setCookie.some((c) => c.startsWith('qa_session='))).toBe(true);
  });

  it('still lets the access key through', async () => {
    const status = await call(accountPort, 'GET', '/api/runner/status', { 'x-qa-access': ACCESS });
    expect(status.status).toBe(200);
    const plan = await call(accountPort, 'GET', '/api/runner/plan', { 'x-qa-access': ACCESS });
    expect(plan.status).not.toBe(401);
  });

  it('is unchanged on a beta copy without the session secret: Helpers get the reduced status, no account', async () => {
    const stranger = await call(plainPort, 'GET', '/api/runner/status');
    expect(stranger.status).toBe(401);
    const helper = await call(plainPort, 'GET', '/api/runner/status', { cookie: plainCookie });
    expect(helper.json).toMatchObject({ helper: true, beta: true });
    expect(helper.json.accounts).toBeUndefined();
    expect((await call(plainPort, 'POST', '/api/runner/run', { cookie: plainCookie })).status).toBe(401);
  });
});
