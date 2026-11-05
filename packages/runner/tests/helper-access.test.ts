/**
 * REQ-033 (BE-606): per-audit Helper access. Grants are read from a real audit store (local backend in a
 * temp folder) on every request, so a removed grant ends access on the next request (AC-2). The last test
 * runs the resolver through the real RunnerServer dispatch (BE-102) with a test-only 'view' row.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createHmac, hkdfSync, randomBytes } from 'crypto';
import type { AuditRequest } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import {
  allows,
  createHelperAccess,
  grantedPermissions,
  parseOwnerEmails,
  type HelperAccess,
} from '../src/helpers/helper-access.js';
import { AuditDailyLimiter } from '../src/helpers/audit-limit.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';
import { RunnerServer } from '../src/server.js';
import { sendJson, type Route } from '../src/routes/index.js';

const ACCESS = 'helper-access-key-0123456789';
const NOW = new Date('2026-11-03T09:00:00.000Z');
const REQUEST: AuditRequest = {
  url: 'https://salon.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};
const HELPER = 'priya@example.com';
const SUB = 'google-uid-priya';

let dir: string;
let store: AuditStore;
let access: HelperAccess;
let auditA: string;
let auditB: string;

function reqWith(cookie?: string): http.IncomingMessage {
  return { headers: cookie ? { cookie } : {}, socket: {} } as unknown as http.IncomingMessage;
}

function helperCookie(email = HELPER, at = NOW, by: HelperAccess = access): string {
  return `${HELPER_COOKIE}=${signHelperSession(by.sessionKey(), { email, sub: SUB }, at)}`;
}

/** A cookie with any claims, MACed under `key` (to test what HelperAccess accepts). */
function cookieSignedWith(key: Buffer, claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${HELPER_COOKIE}=${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

/** The pre-DEC-011 key anyone holding the access key could compute (F-045). */
const oldAccessDerivedKey = (accessToken: string) =>
  Buffer.from(hkdfSync('sha256', accessToken, 'qa-helper-session', 'qa helper session cookie v1', 32));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-helper-access-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir), { now: () => NOW });
  access = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store, now: () => NOW });
  auditA = (await store.createAudit(REQUEST)).auditId;
  auditB = (await store.createAudit({ ...REQUEST, url: 'https://gym.example/' })).auditId;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Helper access (REQ-033)', () => {
  it('is on only when both FIREBASE_PROJECT_ID and RUNNER_ACCESS_TOKEN are set', async () => {
    expect(access.enabled).toBe(true);
    expect(createHelperAccess({ projectId: 'proj', store }).enabled).toBe(false);
    expect(createHelperAccess({ accessToken: ACCESS, store }).enabled).toBe(false);
    expect(createHelperAccess({ projectId: ' ', accessToken: ACCESS, store }).enabled).toBe(false);
    const off = createHelperAccess({ projectId: 'proj', store });
    expect(off.verifier).toBeNull();
    expect(off.session(reqWith(helperCookie()))).toBeNull();
    expect(await off.helperGrants(reqWith(helperCookie()), { id: auditA })).toEqual([]);
  });

  it("'edit' and 'export' include 'view'", () => {
    expect([...grantedPermissions({ permissions: ['edit'] })].sort()).toEqual(['edit', 'view']);
    expect([...grantedPermissions({ permissions: ['export'] })].sort()).toEqual(['export', 'view']);
    expect([...grantedPermissions({ permissions: ['view'] })]).toEqual(['view']);
    expect(allows({ permissions: ['edit'] }, 'view')).toBe(true);
    expect(allows({ permissions: ['export'] }, 'view')).toBe(true);
    expect(allows({ permissions: ['view'] }, 'edit')).toBe(false);
    expect(allows({ permissions: [] }, 'view')).toBe(false);
  });

  it('grants only on the audit given to the Helper, with its permissions', async () => {
    await store.grantHelper(auditA, HELPER, ['edit']);
    await store.grantHelper(auditB, 'someone@example.com', ['view', 'export']);
    const req = reqWith(helperCookie());
    expect((await access.helperGrants(req, { id: auditA })).sort()).toEqual(['edit', 'view']);
    expect(await access.helperGrants(req, { id: auditB })).toEqual([]);
    expect(await access.helperGrants(req, {})).toEqual([]);
    expect(await access.helperGrants(reqWith(), { id: auditA })).toEqual([]);
  });

  it('a tampered or expired cookie is no Helper', async () => {
    await store.grantHelper(auditA, HELPER, ['view']);
    const cookie = helperCookie();
    const forged = Buffer.from(JSON.stringify({ email: HELPER, sub: SUB, exp: 9_999_999_999 })).toString('base64url');
    const tampered = `${HELPER_COOKIE}=${forged}.${cookie.split('.')[1]}`;
    expect(await access.helperGrants(reqWith(tampered), { id: auditA })).toEqual([]);
    const old = helperCookie(HELPER, new Date(NOW.getTime() - 8 * 3600 * 1000));
    expect(await access.helperGrants(reqWith(old), { id: auditA })).toEqual([]);
    expect(await access.refusal(reqWith(old), 'owner', {})).toBeNull();
  });

  it('refusals: 404 for an audit not given, 403 for owner rows or a missing permission', async () => {
    await store.grantHelper(auditA, HELPER, ['view']);
    const req = reqWith(helperCookie());
    expect(await access.refusal(req, 'view', { id: auditB })).toEqual({
      status: 404,
      code: 'ERR_AUDIT_NOT_FOUND',
      error: expect.any(String),
    });
    expect(await access.refusal(req, 'view', { id: 'audit_unknown1' })).toMatchObject({
      status: 404,
      code: 'ERR_AUDIT_NOT_FOUND',
    });
    expect(await access.refusal(req, 'edit', { id: auditA })).toMatchObject({ status: 403, code: 'ERR_FORBIDDEN' });
    expect(await access.refusal(req, 'export', { id: auditA })).toMatchObject({ status: 403, code: 'ERR_FORBIDDEN' });
    expect(await access.refusal(req, 'view', { id: auditA })).toBeNull();
    const paramSets: Record<string, string>[] = [{}, { id: auditA }, { id: auditB }];
    for (const params of paramSets) {
      expect(await access.refusal(req, 'owner', params)).toMatchObject({ status: 403, code: 'ERR_FORBIDDEN' });
    }
    // Not a Helper: the dispatch keeps its own refusal.
    expect(await access.refusal(reqWith(), 'owner', {})).toBeNull();
    expect(await access.refusal(reqWith(), 'view', { id: auditB })).toBeNull();
  });

  it('AC-2: a removed grant ends access on the next request, without signing out', async () => {
    await store.grantHelper(auditA, HELPER, ['export']);
    const req = reqWith(helperCookie());
    expect(await access.helperGrants(req, { id: auditA })).toContain('export');
    await store.removeHelper(auditA, HELPER);
    expect(await access.helperGrants(req, { id: auditA })).toEqual([]);
    expect(await access.refusal(req, 'view', { id: auditA })).toMatchObject({
      status: 404,
      code: 'ERR_AUDIT_NOT_FOUND',
    });
    expect(access.session(req)?.email).toBe(HELPER); // still signed in
  });

  it('a deleted audit ends access', async () => {
    await store.grantHelper(auditA, HELPER, ['view']);
    await store.deleteAudit(auditA);
    expect(await access.helperGrants(reqWith(helperCookie()), { id: auditA })).toEqual([]);
  });
});

describe('Helper session key (F-045, DEC-011)', () => {
  it('a cookie signed with the old HKDF(access key) key is no Helper', async () => {
    await store.grantHelper(auditA, HELPER, ['edit']);
    const exp = Math.floor(NOW.getTime() / 1000) + 3600;
    // What a beta tester holding the access key could forge before DEC-011, in the new and the old cookie shape.
    for (const claims of [
      { email: HELPER, sub: SUB, exp },
      { email: HELPER, exp },
    ]) {
      const forged = reqWith(cookieSignedWith(oldAccessDerivedKey(ACCESS), claims));
      expect(access.session(forged)).toBeNull();
      expect(await access.helperGrants(forged, { id: auditA })).toEqual([]);
      expect(await access.refusal(forged, 'owner', {})).toBeNull();
    }
    expect(access.sessionKey().equals(oldAccessDerivedKey(ACCESS))).toBe(false);
  });

  it("two HelperAccess instances with the same access key refuse each other's cookies", async () => {
    await store.grantHelper(auditA, HELPER, ['view']);
    const other = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store, now: () => NOW });
    expect(other.sessionKey().length).toBe(32);
    expect(other.sessionKey().equals(access.sessionKey())).toBe(false);

    const mine = reqWith(helperCookie());
    const theirs = reqWith(helperCookie(HELPER, NOW, other));
    expect(access.session(mine)).toEqual({ email: HELPER, sub: SUB, exp: expect.any(Number) });
    expect(other.session(theirs)?.email).toBe(HELPER);
    expect(other.session(mine)).toBeNull();
    expect(access.session(theirs)).toBeNull();
    expect(await other.helperGrants(mine, { id: auditA })).toEqual([]);
    expect(await access.helperGrants(theirs, { id: auditA })).toEqual([]);
    expect(await access.helperGrants(mine, { id: auditA })).toEqual(['view']);
  });

  it('a cookie without a Google account id, or with a changed one, is no Helper', async () => {
    await store.grantHelper(auditA, HELPER, ['view']);
    const exp = Math.floor(NOW.getTime() / 1000) + 3600;
    const key = access.sessionKey();
    for (const claims of [
      { email: HELPER, exp },
      { email: HELPER, sub: '', exp },
      { email: HELPER, sub: 7, exp },
    ]) {
      const req = reqWith(cookieSignedWith(key, claims));
      expect(access.session(req)).toBeNull();
      expect(await access.helperGrants(req, { id: auditA })).toEqual([]);
    }
    const [payload, mac] = helperCookie()
      .slice(HELPER_COOKIE.length + 1)
      .split('.') as [string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const otherSub = Buffer.from(JSON.stringify({ ...claims, sub: 'google-uid-mallory' })).toString('base64url');
    const tampered = reqWith(`${HELPER_COOKIE}=${otherSub}.${mac}`);
    expect(access.session(tampered)).toBeNull();
    expect(await access.helperGrants(tampered, { id: auditA })).toEqual([]);
    // The untouched cookie still works: grants are found by email.
    expect(await access.helperGrants(reqWith(helperCookie()), { id: auditA })).toEqual(['view']);
  });

  it('takes an injected key (test seam) of at least 32 bytes, and makes none while off', () => {
    const key = randomBytes(32);
    const seeded = createHelperAccess({
      projectId: 'proj',
      accessToken: ACCESS,
      store,
      now: () => NOW,
      sessionKey: key,
    });
    expect(seeded.sessionKey().equals(key)).toBe(true);
    const cookie = `${HELPER_COOKIE}=${signHelperSession(key, { email: HELPER, sub: SUB }, NOW)}`;
    expect(seeded.session(reqWith(cookie))?.email).toBe(HELPER);
    expect(access.session(reqWith(cookie))).toBeNull();
    expect(() =>
      createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store, sessionKey: randomBytes(16) })
    ).toThrow();
    const off = createHelperAccess({ projectId: 'proj', store, sessionKey: key });
    expect(off.enabled).toBe(false);
    expect(() => off.sessionKey()).toThrow();
    expect(off.session(reqWith(cookie))).toBeNull();
  });

  it('identifies audit owners from AUDIT_OWNER_EMAILS and allows them on owner rows (T-86)', async () => {
    expect(parseOwnerEmails(' Alice@example.com , Bob@example.com ')).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
    expect(parseOwnerEmails(['User@example.com'])).toEqual(['user@example.com']);
    expect(parseOwnerEmails()).toEqual([]);

    const ownerEmail = 'owner@example.com';
    const otherEmail = 'stranger@example.com';
    const ownerAccess = createHelperAccess({
      projectId: 'proj',
      accessToken: ACCESS,
      store,
      auditOwnerEmails: [ownerEmail],
      now: () => NOW,
    });
    expect(ownerAccess.isAuditOwner(ownerEmail)).toBe(true);
    expect(ownerAccess.isAuditOwner('OWNER@EXAMPLE.COM')).toBe(true);
    expect(ownerAccess.isAuditOwner(otherEmail)).toBe(false);

    const ownerReq = reqWith(helperCookie(ownerEmail, NOW, ownerAccess));
    const otherReq = reqWith(helperCookie(otherEmail, NOW, ownerAccess));

    expect(await ownerAccess.refusal(ownerReq, 'owner', { id: auditA })).toBeNull();
    expect(await ownerAccess.refusal(otherReq, 'owner', { id: auditA })).toEqual({
      status: 403,
      code: 'ERR_FORBIDDEN',
      error: 'A Helper cannot do this.',
    });
  });

  it('AuditDailyLimiter caps starts per email per UTC day (T-86)', () => {
    let now = Date.parse('2026-11-05T10:00:00Z');
    const limiter = new AuditDailyLimiter({ limit: 2, now: () => now });

    expect(limiter.claim('owner@example.com')).toEqual({ allowed: true });
    expect(limiter.claim('owner@example.com')).toEqual({ allowed: true });
    const blocked = limiter.claim('owner@example.com');
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toContain('used your 2 audit starts');

    // Different email has their own limit
    expect(limiter.claim('other@example.com')).toEqual({ allowed: true });

    // Next day resets
    now += 86_400_000;
    expect(limiter.claim('owner@example.com')).toEqual({ allowed: true });
  });
});

describe('Helper access through the runner dispatch (REQ-033, BE-102)', () => {
  const PORT = 3687;
  let server: RunnerServer;
  let scratch: string;

  const rows: readonly Route[] = [
    {
      method: 'GET',
      path: '/api/t/audits/:id',
      access: 'view',
      handle: (c) => sendJson(c.res, 200, { audit: c.params?.id }),
    },
  ];

  function get(pathname: string, cookie?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: 'localhost',
          port: PORT,
          path: pathname,
          method: 'GET',
          headers: { host: `localhost:${PORT}`, ...(cookie ? { cookie } : {}) },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-helper-dispatch-'));
    // The real clock: the server reads the cookie now.
    access = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, store });
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      accessToken: ACCESS,
      routes: rows,
      helperGrants: access.helperGrants,
    });
    await server.start();
  });

  afterEach(async () => {
    await server?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('serves a granted audit to the Helper, refuses others, and ends access when the grant is removed', async () => {
    await store.grantHelper(auditA, HELPER, ['view']);
    const cookie = helperCookie(HELPER, new Date());

    const granted = await get(`/api/t/audits/${auditA}`, cookie);
    expect(granted.status).toBe(200);
    expect(JSON.parse(granted.body)).toEqual({ audit: auditA });

    const other = await get(`/api/t/audits/${auditB}`, cookie);
    expect(other.status).not.toBe(200);
    expect(other.body).not.toContain(auditB);

    expect((await get(`/api/t/audits/${auditA}`)).status).not.toBe(200);

    await store.removeHelper(auditA, HELPER);
    const after = await get(`/api/t/audits/${auditA}`, cookie);
    expect(after.status).not.toBe(200);
  });
});

describe('Hosted audits for the signed-in owner on a beta copy (T-86, ADR 0042)', () => {
  const BETA_PORT = 3698;
  const OWNER_EMAIL = 'owner@example.com';
  const OTHER_EMAIL = 'stranger@example.com';
  let betaServer: RunnerServer;
  let betaScratch: string;
  let betaAccess: HelperAccess;

  const betaRows: readonly Route[] = [
    {
      method: 'GET',
      path: '/api/t/audits/:id',
      access: 'view',
      handle: (c) => sendJson(c.res, 200, { audit: c.params?.id }),
    },
    {
      method: 'POST',
      path: '/api/t/owner',
      access: 'owner',
      handle: (c) => sendJson(c.res, 200, { ok: true }),
    },
    {
      method: 'POST',
      path: '/api/t/start',
      access: 'owner',
      handle: async (c) => {
        const caller = c.server.isAuditOwner(c.req)
          ? { owner: true, helperEmail: betaAccess.session(c.req)?.email }
          : { owner: false };
        if (c.server.auditWiring.claimAuditLimit && caller.helperEmail) {
          const claim = c.server.auditWiring.claimAuditLimit(caller.helperEmail);
          if (!claim.allowed) {
            return sendJson(c.res, 429, { error: claim.error, code: 'ERR_BETA_LIMIT' });
          }
        }
        sendJson(c.res, 202, { started: true });
      },
    },
  ];

  function call(
    method: string,
    pathname: string,
    cookie?: string,
    accessKey?: string
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { host: `localhost:${BETA_PORT}` };
      if (cookie) headers.cookie = cookie;
      if (accessKey) headers['x-qa-access'] = accessKey;
      const req = http.request(
        {
          host: 'localhost',
          port: BETA_PORT,
          path: pathname,
          method,
          headers,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  function betaCookie(email: string): string {
    return `${HELPER_COOKIE}=${signHelperSession(betaAccess.sessionKey(), { email, sub: 'uid-test' }, new Date())}`;
  }

  beforeEach(async () => {
    betaScratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-beta-owner-'));
    betaAccess = createHelperAccess({
      projectId: 'proj',
      accessToken: ACCESS,
      store,
      auditOwnerEmails: [OWNER_EMAIL],
    });
    betaServer = new RunnerServer({
      port: BETA_PORT,
      outputDir: path.join(betaScratch, 'report'),
      dataDir: path.join(betaScratch, 'data'),
      accessToken: ACCESS,
      beta: true,
      routes: betaRows,
      helperAccess: betaAccess,
      auditOwnerEmails: [OWNER_EMAIL],
      auditDailyLimit: 2,
    });
    await betaServer.start();
  });

  afterEach(async () => {
    await betaServer?.stop();
    await fs.rm(betaScratch, { recursive: true, force: true });
  });

  it('an allow-listed email passes owner checks and another email is refused on beta', async () => {
    const ownerCookie = betaCookie(OWNER_EMAIL);
    const otherCookie = betaCookie(OTHER_EMAIL);

    // Allow-listed owner passes owner route
    const ownerRes = await call('POST', '/api/t/owner', ownerCookie);
    expect(ownerRes.status).toBe(200);
    expect(JSON.parse(ownerRes.body)).toEqual({ ok: true });

    // Non-owner helper is refused on owner route with 403 ERR_FORBIDDEN
    const otherRes = await call('POST', '/api/t/owner', otherCookie);
    expect(otherRes.status).toBe(403);
    expect(JSON.parse(otherRes.body).code).toBe('ERR_FORBIDDEN');

    // Unauthenticated caller is refused with 401
    const anonRes = await call('POST', '/api/t/owner');
    expect(anonRes.status).toBe(401);
  });

  it('reports auditOwner: true on /api/runner/status for allow-listed owner', async () => {
    const ownerRes = await call('GET', '/api/runner/status', betaCookie(OWNER_EMAIL));
    expect(ownerRes.status).toBe(200);
    const ownerStatus = JSON.parse(ownerRes.body);
    expect(ownerStatus.auditOwner).toBe(true);
    expect(ownerStatus.helper).toBe(true);
    expect(ownerStatus.beta).toBe(true);

    const otherRes = await call('GET', '/api/runner/status', betaCookie(OTHER_EMAIL));
    expect(otherRes.status).toBe(200);
    const otherStatus = JSON.parse(otherRes.body);
    expect(otherStatus.auditOwner).toBe(false);
    expect(otherStatus.helper).toBe(true);

    const keyRes = await call('GET', '/api/runner/status', undefined, ACCESS);
    expect(keyRes.status).toBe(200);
    expect(JSON.parse(keyRes.body).auditOwner).toBe(true);

    const anonRes = await call('GET', '/api/runner/status');
    expect(anonRes.status).toBe(401);
  });

  it('Helper permissions are unchanged on beta: granted audit is served, ungranted refused', async () => {
    await store.grantHelper(auditA, OTHER_EMAIL, ['view']);
    const otherCookie = betaCookie(OTHER_EMAIL);

    const granted = await call('GET', `/api/t/audits/${auditA}`, otherCookie);
    expect(granted.status).toBe(200);

    const ungranted = await call('GET', `/api/t/audits/${auditB}`, otherCookie);
    expect(ungranted.status).toBe(404);
  });

  it('daily limit triggers ERR_BETA_LIMIT when cap is reached', async () => {
    const ownerCookie = betaCookie(OWNER_EMAIL);

    const run1 = await call('POST', '/api/t/start', ownerCookie);
    expect(run1.status).toBe(202);

    const run2 = await call('POST', '/api/t/start', ownerCookie);
    expect(run2.status).toBe(202);

    const run3 = await call('POST', '/api/t/start', ownerCookie);
    expect(run3.status).toBe(429);
    const err = JSON.parse(run3.body);
    expect(err.code).toBe('ERR_BETA_LIMIT');
    expect(err.error).toContain('used your 2 audit starts');
  });
});
