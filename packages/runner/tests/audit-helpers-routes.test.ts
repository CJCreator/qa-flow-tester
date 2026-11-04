/**
 * REQ-033 (BE-606): the Helper rows (AUDIT_API listHelpers, grantHelper, removeHelper, helperStatus,
 * helperSignIn, helperSession, helperSignOut) through a real RunnerServer with a temp audit store. Google's
 * key download is a fake fetch serving a locally generated RSA key: no network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createHmac, generateKeyPairSync, hkdfSync, sign } from 'crypto';
import { AUDIT_API, type AuditRequest } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import { auditHelperRoutes } from '../src/routes/audit-helpers.js';
import { createHelperAccess, type HelperAccess } from '../src/helpers/helper-access.js';
import { HELPER_COOKIE } from '../src/helpers/helper-session.js';
import type { KeysFetch } from '../src/helpers/firebase-token.js';
import { RunnerServer } from '../src/server.js';

const ON_PORT = 3688;
const NO_PROJECT_PORT = 3689;
const NO_KEY_PORT = 3690;
const ACCESS = 'helper-routes-key-0123456789';
const PROJECT = 'qa-helpers-routes';
const KID = 'kid-routes';
const REQUEST: AuditRequest = {
  url: 'https://salon.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keysFetch: KeysFetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => (n.toLowerCase() === 'cache-control' ? 'max-age=3600' : null) },
  json: async () => ({ [KID]: publicKey.export({ type: 'spki', format: 'pem' }).toString() }),
});

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function idToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', kid: KID })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    exp: now + 3600,
    iat: now - 5,
    auth_time: now - 5,
    sub: 'uid-1',
    email: 'Priya@Example.com',
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...overrides,
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: any;
}

function call(
  port: number,
  method: string,
  pathname: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {}
): Promise<Answer> {
  const payload =
    opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: pathname,
        method,
        headers: {
          host: `localhost:${port}`,
          ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
          ...opts.headers,
        },
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
          resolve({ status: res.statusCode || 0, headers: res.headers, body, json });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const owner = { 'x-qa-access': ACCESS };
const helpersPath = (id: string) => `/api/audits/${id}/helpers`;
function sessionCookie(answer: Answer): string {
  const set = answer.headers['set-cookie']?.[0] ?? '';
  return set.split(';')[0]!;
}
/** The claims a `qa_helper=<payload>.<mac>` cookie carries (read without checking the MAC). */
function cookieClaims(cookie: string): Record<string, unknown> {
  const payload = cookie.slice(HELPER_COOKIE.length + 1).split('.')[0]!;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
/** A cookie with any claims, MACed under `key`. */
function cookieSignedWith(key: Buffer, claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${HELPER_COOKIE}=${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

let scratch: string;
let store: AuditStore;
let access: HelperAccess;
let auditA: string;
let auditB: string;
const servers: RunnerServer[] = [];

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-helper-routes-'));
  store = new AuditStore(new LocalAuditStoreBackend(path.join(scratch, 'store')));
  auditA = (await store.createAudit(REQUEST)).auditId;
  auditB = (await store.createAudit({ ...REQUEST, url: 'https://gym.example/' })).auditId;

  access = createHelperAccess({
    projectId: PROJECT,
    accessToken: ACCESS,
    webApiKey: 'public-web-key',
    store,
    fetch: keysFetch,
  });
  const noProject = createHelperAccess({ accessToken: ACCESS, store, fetch: keysFetch });
  const noKey = createHelperAccess({ projectId: PROJECT, store, fetch: keysFetch });

  const make = (port: number, a: HelperAccess, accessToken?: string) =>
    new RunnerServer({
      port,
      outputDir: path.join(scratch, `report-${port}`),
      dataDir: path.join(scratch, `data-${port}`),
      accessToken,
      routes: auditHelperRoutes({ store, access: a }),
      helperGrants: a.helperGrants,
    });
  servers.push(make(ON_PORT, access, ACCESS), make(NO_PROJECT_PORT, noProject, ACCESS), make(NO_KEY_PORT, noKey));
  for (const s of servers) await s.start();
});

afterAll(async () => {
  for (const s of servers) await s.stop();
  await fs.rm(scratch, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const id of [auditA, auditB]) for (const g of await store.listHelpers(id)) await store.removeHelper(id, g.email);
});

describe('Helper rows match AUDIT_API (REQ-033)', () => {
  it("each row's method, path and access equal its AUDIT_API entry", () => {
    const rows = auditHelperRoutes({ store, access });
    const names = [
      'listHelpers',
      'grantHelper',
      'removeHelper',
      'helperStatus',
      'helperSignIn',
      'helperSession',
      'helperSignOut',
    ] as const;
    expect(rows).toHaveLength(names.length);
    names.forEach((name, i) => {
      const e = AUDIT_API[name];
      expect({ method: rows[i]!.method, path: rows[i]!.path, access: rows[i]!.access }).toEqual({
        method: e.method,
        path: e.path,
        access: e.access,
      });
      expect(rows[i]!.beta).toBe('closed');
    });
  });
});

describe('Helper sign-in is off without FIREBASE_PROJECT_ID or RUNNER_ACCESS_TOKEN', () => {
  for (const port of [NO_PROJECT_PORT, NO_KEY_PORT]) {
    it(`status says disabled and the session rows answer 404 ERR_HELPERS_OFF (port ${port})`, async () => {
      const status = await call(port, 'GET', '/api/helper/status');
      expect(status.status).toBe(200);
      expect(status.json).toEqual({ enabled: false });
      for (const method of ['POST', 'GET', 'DELETE']) {
        const answer = await call(
          port,
          method,
          '/api/helper/session',
          method === 'POST' ? { body: { idToken: idToken() } } : {}
        );
        expect(answer.status).toBe(404);
        expect(answer.json.code).toBe('ERR_HELPERS_OFF');
        expect(answer.headers['set-cookie']).toBeUndefined();
      }
    });
  }
});

describe('Helper sign-in and session (REQ-033)', () => {
  it('status is enabled and carries the public Firebase web settings', async () => {
    const status = await call(ON_PORT, 'GET', '/api/helper/status');
    expect(status.json).toEqual({
      enabled: true,
      firebase: { apiKey: 'public-web-key', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT },
    });
  });

  it('signs in with a valid token: only this Helper grants, a strict cookie, the token nowhere', async () => {
    await store.grantHelper(auditA, 'priya@example.com', ['view']);
    await store.grantHelper(auditB, 'someone@example.com', ['edit']);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const token = idToken();
    try {
      const answer = await call(ON_PORT, 'POST', '/api/helper/session', { body: { idToken: token } });
      expect(answer.status).toBe(200);
      expect(answer.json).toEqual({
        email: 'priya@example.com',
        grants: [{ auditId: auditA, email: 'priya@example.com', permissions: ['view'], grantedAt: expect.any(String) }],
      });
      expect(answer.body).not.toContain(token);
      expect(answer.body).not.toContain(token.split('.')[2]!);
      const setCookie = answer.headers['set-cookie']?.[0] ?? '';
      expect(setCookie).toMatch(new RegExp(`^${HELPER_COOKIE}=`));
      for (const attr of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) expect(setCookie).toContain(attr);
      expect(setCookie).not.toContain('Secure');
      expect(setCookie).not.toContain(token);
      expect(answer.headers['cache-control']).toBe('no-store');
      for (const spy of spies)
        for (const args of spy.mock.calls) expect(args.map(String).join(' ')).not.toContain(token);

      const viaHttps = await call(ON_PORT, 'POST', '/api/helper/session', {
        body: { idToken: idToken() },
        headers: { 'x-forwarded-proto': 'https' },
      });
      expect(viaHttps.headers['set-cookie']?.[0]).toContain('; Secure');

      // The cookie is bound to the verified Google account id (DEC-011).
      expect(cookieClaims(sessionCookie(answer))).toEqual({
        email: 'priya@example.com',
        sub: 'uid-1',
        exp: expect.any(Number),
      });

      // GET /api/helper/session: the signed-in Helper and only their grants.
      const session = await call(ON_PORT, 'GET', '/api/helper/session', { headers: { cookie: sessionCookie(answer) } });
      expect(session.status).toBe(200);
      expect(session.json.email).toBe('priya@example.com');
      expect(session.json.grants.map((g: { auditId: string }) => g.auditId)).toEqual([auditA]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('F-045: refuses a session forged with the access key, from another HelperAccess, or with a changed sub', async () => {
    await store.grantHelper(auditA, 'priya@example.com', ['view', 'edit', 'export']);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const oldKey = Buffer.from(hkdfSync('sha256', ACCESS, 'qa-helper-session', 'qa helper session cookie v1', 32));
    const other = createHelperAccess({ projectId: PROJECT, accessToken: ACCESS, store, fetch: keysFetch });

    const signIn = await call(ON_PORT, 'POST', '/api/helper/session', { body: { idToken: idToken() } });
    const real = sessionCookie(signIn);
    const [, mac] = real.slice(HELPER_COOKIE.length + 1).split('.') as [string, string];
    const otherSub = Buffer.from(JSON.stringify({ ...cookieClaims(real), sub: 'uid-2' })).toString('base64url');

    const refused = [
      // Anyone given the access key could compute the old key.
      cookieSignedWith(oldKey, { email: 'priya@example.com', sub: 'uid-1', exp }),
      cookieSignedWith(oldKey, { email: 'priya@example.com', exp }),
      // Same access key and project, another instance: another random key.
      cookieSignedWith(other.sessionKey(), { email: 'priya@example.com', sub: 'uid-1', exp }),
      // This runner's key, but no Google account id.
      cookieSignedWith(access.sessionKey(), { email: 'priya@example.com', exp }),
      // The real cookie with another account id.
      `${HELPER_COOKIE}=${otherSub}.${mac}`,
    ];
    for (const cookie of refused) {
      const session = await call(ON_PORT, 'GET', '/api/helper/session', { headers: { cookie } });
      expect(session.status).toBe(401);
      expect(session.json.code).toBe('ERR_SIGN_IN_FAILED');
      expect(session.body).not.toContain('priya@example.com');
      const req = { headers: { cookie }, socket: {} } as unknown as http.IncomingMessage;
      expect(await access.helperGrants(req, { id: auditA })).toEqual([]);
    }

    // The real sign-in cookie still works.
    const ok = await call(ON_PORT, 'GET', '/api/helper/session', { headers: { cookie: real } });
    expect(ok.status).toBe(200);
    expect(ok.json.email).toBe('priya@example.com');
  });

  it('refuses a bad token with 401 ERR_SIGN_IN_FAILED and sets no cookie', async () => {
    const bad = [
      { idToken: idToken({ aud: 'other' }) },
      { idToken: idToken({ email_verified: false }) },
      { idToken: idToken({ firebase: { sign_in_provider: 'password' } }) },
      { idToken: idToken({ exp: Math.floor(Date.now() / 1000) - 10 }) },
      { idToken: 'not-a-token' },
      { idToken: 42 },
      {},
      'not json',
    ];
    for (const body of bad) {
      const answer = await call(ON_PORT, 'POST', '/api/helper/session', { body });
      expect(answer.status).toBe(401);
      expect(answer.json.code).toBe('ERR_SIGN_IN_FAILED');
      expect(answer.headers['set-cookie']).toBeUndefined();
      if (typeof body === 'object' && typeof body.idToken === 'string') expect(answer.body).not.toContain(body.idToken);
    }
  });

  it('GET session without a valid cookie is refused; sign-out clears the cookie', async () => {
    const none = await call(ON_PORT, 'GET', '/api/helper/session');
    expect(none.status).toBe(401);
    expect(none.json.code).toBe('ERR_SIGN_IN_FAILED');
    const forged = await call(ON_PORT, 'GET', '/api/helper/session', {
      headers: { cookie: `${HELPER_COOKIE}=e30.AAAA` },
    });
    expect(forged.status).toBe(401);

    const out = await call(ON_PORT, 'DELETE', '/api/helper/session');
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ signedOut: true });
    const cleared = out.headers['set-cookie']?.[0] ?? '';
    expect(cleared).toMatch(new RegExp(`^${HELPER_COOKIE}=;`));
    expect(cleared).toContain('Max-Age=0');
  });
});

describe('Owner manages Helpers (REQ-033)', () => {
  it('PUT validates and lower-cases the email and permissions and returns HelperGrantReply', async () => {
    const answer = await call(ON_PORT, 'PUT', helpersPath(auditA), {
      headers: owner,
      body: { email: '  Priya@Example.COM ', permissions: ['export', 'view', 'export'] },
    });
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      helper: {
        auditId: auditA,
        email: 'priya@example.com',
        permissions: ['view', 'export'],
        grantedAt: expect.any(String),
      },
    });

    for (const body of [
      { email: 'not-an-email', permissions: ['view'] },
      { email: 'a@example.com', permissions: [] },
      { email: 'a@example.com', permissions: ['owner'] },
      { email: 42, permissions: ['view'] },
      ['array'],
    ]) {
      const refused = await call(ON_PORT, 'PUT', helpersPath(auditA), { headers: owner, body });
      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe('ERR_INVALID_REQUEST');
    }
    const notJson = await call(ON_PORT, 'PUT', helpersPath(auditA), { headers: owner, body: '{' });
    expect(notJson.status).toBe(400);

    const unknown = await call(ON_PORT, 'PUT', helpersPath('audit_unknown1'), {
      headers: owner,
      body: { email: 'a@example.com', permissions: ['view'] },
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('ERR_AUDIT_NOT_FOUND');
  });

  it('GET lists the audit grants; DELETE removes one', async () => {
    await store.grantHelper(auditA, 'priya@example.com', ['view']);
    await store.grantHelper(auditA, 'arun@example.com', ['edit']);
    await store.grantHelper(auditB, 'other@example.com', ['view']);

    const list = await call(ON_PORT, 'GET', helpersPath(auditA), { headers: owner });
    expect(list.status).toBe(200);
    expect(list.json.helpers.map((h: { email: string }) => h.email)).toEqual(['arun@example.com', 'priya@example.com']);

    const removed = await call(
      ON_PORT,
      'DELETE',
      `${helpersPath(auditA)}?email=${encodeURIComponent('Priya@example.com')}`,
      { headers: owner }
    );
    expect(removed.status).toBe(200);
    expect(removed.json).toEqual({ removed: true });
    expect((await store.listHelpers(auditA)).map((h) => h.email)).toEqual(['arun@example.com']);

    const noEmail = await call(ON_PORT, 'DELETE', helpersPath(auditA), { headers: owner });
    expect(noEmail.status).toBe(400);
    expect(noEmail.json.code).toBe('ERR_INVALID_REQUEST');

    const unknown = await call(ON_PORT, 'GET', helpersPath('audit_unknown1'), { headers: owner });
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('ERR_AUDIT_NOT_FOUND');
  });

  it('the owner rows need the access key; a signed-in Helper is refused (403 ERR_FORBIDDEN from the resolver)', async () => {
    await store.grantHelper(auditA, 'priya@example.com', ['view', 'edit', 'export']);
    const signIn = await call(ON_PORT, 'POST', '/api/helper/session', { body: { idToken: idToken() } });
    const cookie = sessionCookie(signIn);

    for (const [method, body] of [
      ['GET', undefined],
      ['PUT', { email: 'friend@example.com', permissions: ['view'] }],
      ['DELETE', undefined],
    ] as const) {
      const pathname = method === 'DELETE' ? `${helpersPath(auditA)}?email=priya%40example.com` : helpersPath(auditA);
      const answer = await call(ON_PORT, method, pathname, { headers: { cookie }, body });
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(answer.body).not.toContain('priya@example.com');
    }
    // Nothing changed.
    expect((await store.listHelpers(auditA)).map((h) => h.email)).toEqual(['priya@example.com']);

    // The answer the dispatch is to give a signed-in Helper on an owner row.
    const req = { headers: { cookie }, socket: {} } as unknown as http.IncomingMessage;
    expect(await access.refusal(req, AUDIT_API.grantHelper.access, { id: auditA })).toMatchObject({
      status: 403,
      code: 'ERR_FORBIDDEN',
    });
  });
});
