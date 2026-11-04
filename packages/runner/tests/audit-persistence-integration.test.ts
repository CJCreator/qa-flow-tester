/**
 * QA-600 (REQ-028, REQ-029, REQ-033, REQ-023, Q-30, D-004): saved Website Audits through the real runner dispatch.
 * A RunnerServer with the production route table on a temp data folder, called over HTTP. Audits are seeded through
 * the runner's own store. Helper sign-in uses a locally generated RSA key and a fake key download, so nothing
 * reaches the network. Fixed ports 3841-3844 (no other test file uses them).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { generateKeyPairSync, sign } from 'crypto';
import type { AuditRequest, ShareLink } from '@qa/types';
import {
  AuditStore,
  LocalAuditStoreBackend,
  pageContentName,
  selectAuditStoreBackend,
} from '@qa/core';
import { RunnerServer } from '../src/server.js';
import { createHelperAccess } from '../src/helpers/helper-access.js';
import type { KeysFetch } from '../src/helpers/firebase-token.js';
import { auditDocContents, auditDocResult } from '../../core/tests/helpers/audit-doc-fixture.js';

const ACCESS = 'persistence-key-0123456789';
const PROJECT = 'qa-persistence-test';
const HELPER = 'priya@example.com';
const KID = 'kid-qa600';
const PORT_LOCAL = 3841;
const PORT_BETA = 3842;
const PORT_HELPER = 3843;
const PORT_RESTART = 3844;
const owner = { 'x-qa-access': ACCESS };
const REQUEST: AuditRequest = {
  url: 'https://salon.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: any;
}

function call(port: number, method: string, pathname: string, headers: Record<string, string> = {}, body?: unknown): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: pathname,
        method,
        headers: {
          host: `localhost:${port}`,
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, body: text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const removeDir = (dir: string) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesUnder(full)));
    else out.push(full);
  }
  return out;
}

function newRunner(port: number, dir: string, extra: { beta?: boolean; helperAccess?: ReturnType<typeof createHelperAccess> } = {}): RunnerServer {
  return new RunnerServer({
    port,
    host: 'localhost',
    outputDir: path.join(dir, 'report'),
    dataDir: path.join(dir, 'data'),
    accessToken: ACCESS,
    beta: extra.beta ?? false,
    helperAccess: extra.helperAccess,
  });
}

/** A finished version of an audit, with the fixture result and Page Content. */
async function finish(store: AuditStore, auditId: string, version: number): Promise<void> {
  await store.saveResult(auditId, version, { ...auditDocResult(), auditId, version });
  for (const content of auditDocContents()) {
    await store.writeVersionJson(auditId, version, pageContentName(content.urlPath), content);
  }
  await store.updateVersion(auditId, version, { status: 'done', finishedAt: '2026-11-03T10:00:00.000Z' });
}

async function seedDone(store: AuditStore, url = REQUEST.url): Promise<string> {
  const v = await store.createAudit({ ...REQUEST, url });
  await finish(store, v.auditId, 1);
  return v.auditId;
}

let scratch: string;
let running: RunnerServer[];

async function start(server: RunnerServer): Promise<RunnerServer> {
  running.push(server);
  await server.start();
  return server;
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-persistence-'));
  running = [];
  vi.stubEnv('AUDIT_STORE_BUCKET', '');
  vi.stubEnv('FIREBASE_PROJECT_ID', '');
  vi.stubEnv('FIREBASE_WEB_API_KEY', '');
  vi.stubEnv('FIREBASE_AUTH_DOMAIN', '');
  vi.stubEnv('RUNNER_ACCESS_TOKEN', '');
});

afterEach(async () => {
  for (const s of running) await s.stop();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await removeDir(scratch);
});

describe('REQ-028 AC-1/AC-2: saved audits survive a runner restart', () => {
  it('lists and opens a finished audit, and one with two versions, after stop and start on the same data folder', async () => {
    const first = await start(newRunner(PORT_RESTART, scratch));
    const single = await seedDone(first.auditWiring.store, 'https://one.example/');
    const double = await seedDone(first.auditWiring.store, 'https://two.example/');
    const v2 = await first.auditWiring.store.addVersion(double);
    expect(v2.version).toBe(2);
    await finish(first.auditWiring.store, double, 2);

    const before = await call(PORT_RESTART, 'GET', '/api/audits', owner);
    expect(before.status).toBe(200);
    expect(before.json.audits.map((a: { auditId: string }) => a.auditId).sort()).toEqual([single, double].sort());

    await first.stop();
    running = [];
    const second = await start(newRunner(PORT_RESTART, scratch));
    expect(second.auditWiring.store).not.toBe(first.auditWiring.store);

    const list = await call(PORT_RESTART, 'GET', '/api/audits', owner);
    expect(list.status).toBe(200);
    const byId = new Map<string, any>(list.json.audits.map((a: any) => [a.auditId, a]));
    expect([...byId.keys()].sort()).toEqual([single, double].sort());
    expect(byId.get(single).versions.map((v: { version: number }) => v.version)).toEqual([1]);
    expect(byId.get(double).versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);

    const openSingle = await call(PORT_RESTART, 'GET', `/api/audits/${single}`, owner);
    expect(openSingle.status).toBe(200);
    expect(openSingle.json.version.status).toBe('done');
    expect(openSingle.json.result).not.toBeNull();

    for (const version of [1, 2]) {
      const open = await call(PORT_RESTART, 'GET', `/api/audits/${double}?version=${version}`, owner);
      expect(open.status).toBe(200);
      expect(open.json.version.version).toBe(version);
      expect(open.json.version.status).toBe('done');
      expect(open.json.result.version).toBe(version);
    }
  });
});

describe('REQ-029 AC-1: local files, no Google host', () => {
  it('saves and lists in local files and makes no call to a Google host', async () => {
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      fetched.push(String(input instanceof Request ? input.url : input));
      return realFetch(input as never, init);
    });

    const server = await start(newRunner(PORT_LOCAL, scratch));
    const { store } = server.auditWiring;
    expect(store.backend).toBeInstanceOf(LocalAuditStoreBackend);
    const id = await seedDone(store);

    const list = await call(PORT_LOCAL, 'GET', '/api/audits', owner);
    expect(list.status).toBe(200);
    expect(list.json.audits.map((a: { auditId: string }) => a.auditId)).toEqual([id]);

    const files = await filesUnder(path.join(scratch, 'data', 'audit-store'));
    expect(files.some((f) => f.includes(id))).toBe(true);

    // The backend selection with no cloud variable: the injected fetch is never called.
    const injected: string[] = [];
    const backend = selectAuditStoreBackend({
      dataDir: path.join(scratch, 'data2'),
      env: {},
      fetch: async (input) => {
        injected.push(String(input));
        throw new Error('no network expected');
      },
    });
    expect(backend).toBeInstanceOf(LocalAuditStoreBackend);
    const other = new AuditStore(backend);
    await seedDone(other);
    expect((await other.listAudits()).length).toBe(1);
    expect(injected).toEqual([]);

    const google = /(^|\.)(google|googleapis|gstatic|firebaseio|firebaseapp|googleusercontent)\.com(:|\/|$)/i;
    expect(fetched.filter((u) => google.test(u.replace(/^[a-z]+:\/\//i, '')))).toEqual([]);
  });
});

describe('REQ-023: Shortlist over HTTP', () => {
  it('a mark, notes and outcome saved with PUT come back with the audit in GET /api/audits', async () => {
    const server = await start(newRunner(PORT_LOCAL, scratch));
    const id = await seedDone(server.auditWiring.store);

    const put = await call(PORT_LOCAL, 'PUT', `/api/audits/${id}/shortlist`, owner, {
      mark: 'pitch',
      notes: 'Owner answers WhatsApp after 6 pm.',
      outcome: 'Interested',
      outcomeNote: 'Asked for a quote.',
    });
    expect(put.status).toBe(200);

    const list = await call(PORT_LOCAL, 'GET', '/api/audits', owner);
    const entry = list.json.audits.find((a: { auditId: string }) => a.auditId === id).shortlist;
    expect(entry).toMatchObject({
      auditId: id,
      mark: 'pitch',
      notes: 'Owner answers WhatsApp after 6 pm.',
      outcome: 'Interested',
      outcomeNote: 'Asked for a quote.',
    });

    // The same after a restart.
    await server.stop();
    running = [];
    await start(newRunner(PORT_LOCAL, scratch));
    const again = await call(PORT_LOCAL, 'GET', '/api/audits', owner);
    expect(again.json.audits[0].shortlist).toMatchObject({ mark: 'pitch', outcome: 'Interested' });

    const bad = await call(PORT_LOCAL, 'PUT', `/api/audits/${id}/shortlist`, owner, { outcome: 'Maybe' });
    expect(bad.status).toBe(400);
  });
});

describe('Q-30: DELETE /api/audits/:id removes everything', () => {
  it('leaves no file of the audit, and its Shared Links answer 410 or 404', async () => {
    const server = await start(newRunner(PORT_LOCAL, scratch));
    const { store } = server.auditWiring;
    const id = await seedDone(store);
    const keep = await seedDone(store, 'https://keep.example/');
    await store.grantHelper(id, HELPER, ['view']);
    await call(PORT_LOCAL, 'PUT', `/api/audits/${id}/shortlist`, owner, { mark: 'pitch', notes: 'private note' });

    const created = await call(PORT_LOCAL, 'POST', `/api/audits/${id}/share`, owner, { kind: 'pitch', language: 'en', version: 1 });
    expect(created.status).toBe(201);
    const link = created.json.link as ShareLink;
    expect((await call(PORT_LOCAL, 'GET', `/s/${link.id}`)).status).toBe(200);

    const root = path.join(scratch, 'data', 'audit-store');
    const before = await filesUnder(root);
    expect(before.some((f) => f.includes(id))).toBe(true);

    const del = await call(PORT_LOCAL, 'DELETE', `/api/audits/${id}`, owner);
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ deleted: true });

    const after = await filesUnder(root);
    expect(after.filter((f) => f.includes(id))).toEqual([]);
    // Nothing left that still names the audit (grant, Shortlist and Shared Link records included).
    for (const file of after) expect(await fs.readFile(file, 'utf8')).not.toContain(id);
    expect(after.some((f) => f.includes(keep))).toBe(true);

    const shared = await call(PORT_LOCAL, 'GET', `/s/${link.id}`);
    expect([404, 410]).toContain(shared.status);
    const open = await call(PORT_LOCAL, 'GET', `/api/audits/${id}`, owner);
    expect(open.status).toBe(404);
    const list = await call(PORT_LOCAL, 'GET', '/api/audits', owner);
    expect(list.json.audits.map((a: { auditId: string }) => a.auditId)).toEqual([keep]);
  });
});

describe('D-004: with an access key on a beta copy, only Shared Links are public', () => {
  it('serves GET /s/:linkId without the key and refuses list, get, Shortlist, share and preview routes', async () => {
    // The owner makes the link on the same data folder before the copy is shared as a beta (Shared Link rows are
    // the only audit rows a beta copy serves, so the link is made first); every later request carries no key.
    const owned = await start(newRunner(PORT_BETA, scratch));
    const id = await seedDone(owned.auditWiring.store);
    const created = await call(PORT_BETA, 'POST', `/api/audits/${id}/share`, owner, { kind: 'pitch', language: 'en', version: 1 });
    expect(created.status).toBe(201);
    const linkId = (created.json.link as ShareLink).id;
    await owned.stop();
    running = [];
    const beta = await start(newRunner(PORT_BETA, scratch, { beta: true }));
    expect(beta.auditWiring.dataDir).toBe(owned.auditWiring.dataDir);
    const page = await call(PORT_BETA, 'GET', `/s/${linkId}`);
    expect(page.status).toBe(200);
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');

    const refused: Array<[string, string, unknown?]> = [
      ['GET', '/api/audits'],
      ['GET', `/api/audits/${id}`],
      ['GET', `/api/audits/${id}/shortlist`],
      ['PUT', `/api/audits/${id}/shortlist`, { mark: 'skip' }],
      ['GET', '/api/shortlist'],
      ['GET', `/api/audits/${id}/share`],
      ['POST', `/api/audits/${id}/share`, { kind: 'pitch', language: 'en' }],
      ['DELETE', `/api/audits/${id}/share/${linkId}`],
      ['GET', `/api/audits/${id}/preview`],
      ['POST', `/api/audits/${id}/preview`, {}],
    ];
    for (const [method, url, body] of refused) {
      const res = await call(PORT_BETA, method, url, {}, body);
      expect(res.status, `${method} ${url}`).toBe(401);
      // Owner rows are refused by the access-key gate, view rows by the table; both ask for the access key.
      expect(res.json?.error, `${method} ${url}`).toContain('access key');
    }
  });
});

describe('REQ-033 AC-1/AC-2: a Helper over HTTP with a test-signed token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

  function idToken(email: string, sub = 'google-user-1'): string {
    const nowS = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      exp: nowS + 3600,
      iat: nowS - 10,
      auth_time: nowS - 10,
      sub,
      email,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com', identities: {} },
    })}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  }

  it('lists and opens only the granted audit, is refused for others and owner rows, and loses access when the grant is removed', async () => {
    const keyDownloads: string[] = [];
    const fakeKeys: KeysFetch = async (url) => {
      keyDownloads.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'cache-control' ? 'public, max-age=3600' : null) },
        json: async () => ({ [KID]: publicPem }),
      };
    };
    // The grant source is the runner's own audit store, reached after the server exists.
    // eslint-disable-next-line prefer-const -- read by the closure below before it is assigned
    let server!: RunnerServer;
    const access = createHelperAccess({
      projectId: PROJECT,
      accessToken: ACCESS,
      fetch: fakeKeys,
      store: { grantsFor: (email) => server.auditWiring.store.grantsFor(email) },
    });
    server = await start(newRunner(PORT_HELPER, scratch, { helperAccess: access }));
    const { store } = server.auditWiring;
    const auditA = await seedDone(store, 'https://a.example/');
    const auditB = await seedDone(store, 'https://b.example/');

    // The owner grants A over HTTP.
    const grant = await call(PORT_HELPER, 'PUT', `/api/audits/${auditA}/helpers`, owner, { email: HELPER, permissions: ['view'] });
    expect(grant.status).toBe(200);

    // Sign in with a token signed by the test key.
    const bad = await call(PORT_HELPER, 'POST', '/api/helper/session', {}, { idToken: 'not-a-token' });
    expect(bad.status).toBe(401);
    const signIn = await call(PORT_HELPER, 'POST', '/api/helper/session', {}, { idToken: idToken(HELPER) });
    expect(signIn.status).toBe(200);
    expect(signIn.json.email).toBe(HELPER);
    expect(keyDownloads.length).toBeGreaterThan(0);
    const setCookie = ([] as string[]).concat(signIn.headers['set-cookie'] ?? []);
    expect(setCookie[0]).toMatch(/^qa_helper=/);
    expect(setCookie[0]).toMatch(/HttpOnly/i);
    const cookie = { cookie: setCookie[0].split(';')[0] };

    const list = await call(PORT_HELPER, 'GET', '/api/audits', cookie);
    expect(list.status).toBe(200);
    expect(list.json.audits.map((a: { auditId: string }) => a.auditId)).toEqual([auditA]);

    const openA = await call(PORT_HELPER, 'GET', `/api/audits/${auditA}`, cookie);
    expect(openA.status).toBe(200);
    expect(openA.json.summary.auditId).toBe(auditA);

    const openB = await call(PORT_HELPER, 'GET', `/api/audits/${auditB}`, cookie);
    expect(openB.status).toBe(404);
    expect(openB.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    expect(openB.body).not.toContain(auditB);

    // Owner rows: 403 for a signed-in Helper, nothing changed.
    const ownerRows: Array<[string, string, unknown?]> = [
      ['DELETE', `/api/audits/${auditA}`],
      ['GET', `/api/audits/${auditA}/helpers`],
      ['PUT', `/api/audits/${auditA}/helpers`, { email: 'x@example.com', permissions: ['view'] }],
      ['POST', `/api/audits/${auditA}/share`, { kind: 'pitch', language: 'en' }],
      ['GET', '/api/audit-settings'],
    ];
    for (const [method, url, body] of ownerRows) {
      const res = await call(PORT_HELPER, method, url, cookie, body);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.json.code, `${method} ${url}`).toBe('ERR_FORBIDDEN');
    }
    expect(await store.getAudit(auditA)).not.toBeNull();
    expect((await store.listHelpers(auditA)).map((g) => g.email)).toEqual([HELPER]);

    // A view-only Helper cannot edit the Shortlist.
    const edit = await call(PORT_HELPER, 'PUT', `/api/audits/${auditA}/shortlist`, cookie, { mark: 'pitch' });
    expect(edit.status).toBe(403);

    // A cookie alone is not the access key: no cookie, no access.
    const anonymous = await call(PORT_HELPER, 'GET', `/api/audits/${auditA}`);
    expect(anonymous.status).toBe(401);

    // The owner removes the grant: the next request for A is refused.
    const removed = await call(PORT_HELPER, 'DELETE', `/api/audits/${auditA}/helpers?email=${encodeURIComponent(HELPER)}`, owner);
    expect(removed.status).toBe(200);
    const after = await call(PORT_HELPER, 'GET', `/api/audits/${auditA}`, cookie);
    expect(after.status).toBe(404);
    expect(after.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    const listAfter = await call(PORT_HELPER, 'GET', '/api/audits', cookie);
    // With no grant left the signed-in Helper holds nothing: the list row is refused.
    expect(listAfter.status).toBe(403);
    expect(listAfter.json.code).toBe('ERR_FORBIDDEN');
  });
});
