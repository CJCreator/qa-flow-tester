/**
 * BE-612 (REQ-033, REQ-048): the production runner's audit wiring. A RunnerServer built with the options cli.ts
 * passes (no helperAccess, no helperGrants, the real route table) and Helper sign-in configured in the
 * environment passes Helper grants and refusals through dispatch. Without Helper sign-in the Helper rows say it
 * is not set up and the owner keeps every row. The audit routes reach the one audit store, the key resolver,
 * Helper access, the saved AI setup and the owner test through RunnerServer.auditWiring, without a cast.
 * Temp folders only; the audit store is the local backend; no network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import type { AuditRequest } from '@qa/types';
import { AuditStore, KeyResolver, LocalAuditStoreBackend } from '@qa/core';
import { RunnerServer, type AuditWiring } from '../src/server.js';
import { createHelperAccess } from '../src/helpers/helper-access.js';
import { HELPER_COOKIE, newHelperSessionKey, signHelperSession } from '../src/helpers/helper-session.js';

const ACCESS = 'audit-wiring-key-0123456789';
const PROJECT = 'qa-audit-wiring';
const WEB_KEY = 'public-web-key';
const HELPER = 'priya@example.com';
const ON_PORT = 3746;
const OFF_PORT = 3747;
const REQUEST: AuditRequest = {
  url: 'https://salon.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

/** Helper sign-in settings in the environment, as the Cloud Run deploy sets them; the audit store stays local. */
function stubHelperEnv(projectId: string): void {
  vi.stubEnv('AUDIT_STORE_BUCKET', '');
  vi.stubEnv('FIREBASE_PROJECT_ID', projectId);
  vi.stubEnv('FIREBASE_WEB_API_KEY', WEB_KEY);
  vi.stubEnv('FIREBASE_AUTH_DOMAIN', '');
  vi.stubEnv('RUNNER_ACCESS_TOKEN', ACCESS);
}

/** The options packages/runner/src/cli.ts passes, with test folders (no UI build). */
function asCliBuildsIt(port: number, dir: string, accessToken: string | undefined): RunnerServer {
  return new RunnerServer({
    port,
    host: 'localhost',
    outputDir: path.join(dir, 'report'),
    dataDir: path.join(dir, 'data'),
    localhostAlias: undefined,
    allowedOrigins: undefined,
    accessToken,
    beta: false,
    stepTimeoutMs: undefined,
  });
}

function fakeReq(headers: Record<string, string>, remoteAddress: string): http.IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as http.IncomingMessage;
}

interface Answer {
  status: number;
  body: string;
  json: any;
}

function call(port: number, method: string, pathname: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, path: pathname, method, headers: { host: `localhost:${port}`, ...headers } },
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
    );
    req.on('error', reject);
    req.end();
  });
}

const owner = { 'x-qa-access': ACCESS };
const removeDir = (dir: string) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

describe('RunnerServer.auditWiring: the typed surface the audit routes use (BE-612)', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-wiring-'));
    stubHelperEnv(PROJECT);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await removeDir(scratch);
  });

  it('is a local run only when not a beta copy and bound to this computer (ADR 0042)', () => {
    const build = (host: string, beta: boolean, dir: string) =>
      new RunnerServer({
        port: ON_PORT,
        host,
        outputDir: path.join(scratch, dir, 'report'),
        dataDir: path.join(scratch, dir, 'data'),
        localhostAlias: undefined,
        allowedOrigins: undefined,
        accessToken: ACCESS,
        beta,
        stepTimeoutMs: undefined,
      });
    expect(build('localhost', false, 'a').auditWiring.localRun).toBe(true);
    expect(build('127.0.0.1', false, 'b').auditWiring.localRun).toBe(true);
    expect(build('0.0.0.0', false, 'c').auditWiring.localRun).toBe(false);
    expect(build('localhost', true, 'd').auditWiring.localRun).toBe(false);
  });

  it('is one read-only object per runner with one audit store, shared by Helper access', async () => {
    const server = asCliBuildsIt(ON_PORT, scratch, ACCESS);
    const wiring: AuditWiring = server.auditWiring;

    expect(server.auditWiring).toBe(wiring);
    expect(Object.isFrozen(wiring)).toBe(true);
    expect(wiring.dataDir).toBe(path.resolve(scratch, 'data'));
    expect(wiring.store).toBeInstanceOf(AuditStore);
    expect(wiring.store.backend).toBeInstanceOf(LocalAuditStoreBackend);
    expect((wiring.store.backend as LocalAuditStoreBackend).root.startsWith(wiring.dataDir)).toBe(true);
    expect(wiring.helperAccess.enabled).toBe(true);
    expect(wiring.helperAccess.store).toBe(wiring.store);

    // A grant written through the routes' store is what Helper access reads.
    const { auditId } = await wiring.store.createAudit(REQUEST);
    await wiring.store.grantHelper(auditId, HELPER, ['view']);
    expect((await wiring.helperAccess.store.grantsFor(HELPER)).map((g) => g.auditId)).toEqual([auditId]);

    // Each runner has its own.
    const other = asCliBuildsIt(OFF_PORT, path.join(scratch, 'other'), ACCESS);
    expect(other.auditWiring.store).not.toBe(wiring.store);
  });

  it("hands over the runner's key resolver and the saved AI setup without the bookkeeping fields", async () => {
    const keys = new KeyResolver(scratch);
    const server = new RunnerServer({
      dataDir: path.join(scratch, 'data'),
      outputDir: path.join(scratch, 'report'),
      keyResolver: keys,
    });
    const wiring = server.auditWiring;
    expect(wiring.keys).toBe(keys);

    expect(await wiring.readAiModels()).toEqual({});
    await fs.mkdir(wiring.dataDir, { recursive: true });
    await fs.writeFile(
      path.join(wiring.dataDir, '.qa-ai-models.json'),
      JSON.stringify({
        provider: 'openrouter',
        text: 'm/text',
        vision: null,
        chosenBy: 'person',
        chosenAt: '2026-11-03T09:00:00.000Z',
      }),
      'utf8'
    );
    const setup = await wiring.readAiModels();
    expect(setup).toEqual({ provider: 'openrouter', text: 'm/text', vision: null });
    expect(setup).not.toHaveProperty('chosenBy');
    expect(setup).not.toHaveProperty('chosenAt');
  });

  it('isOwnerRequest: the access key in a header or cookie; with no key set, this computer only (DEC-004)', () => {
    const keyed = asCliBuildsIt(ON_PORT, scratch, ACCESS).auditWiring;
    expect(keyed.isOwnerRequest(fakeReq({ 'x-qa-access': ACCESS }, '203.0.113.5'))).toBe(true);
    expect(keyed.isOwnerRequest(fakeReq({ cookie: `qa_access=${ACCESS}` }, '203.0.113.5'))).toBe(true);
    expect(keyed.isOwnerRequest(fakeReq({ 'x-qa-access': `${ACCESS}x` }, '127.0.0.1'))).toBe(false);
    expect(keyed.isOwnerRequest(fakeReq({}, '127.0.0.1'))).toBe(false);

    const local = asCliBuildsIt(ON_PORT, path.join(scratch, 'local'), undefined).auditWiring;
    expect(local.isOwnerRequest(fakeReq({}, '127.0.0.1'))).toBe(true);
    expect(local.isOwnerRequest(fakeReq({}, '::1'))).toBe(true);
    expect(local.isOwnerRequest(fakeReq({}, '203.0.113.5'))).toBe(false);
    // Helper sign-in needs this runner's own key, even with RUNNER_ACCESS_TOKEN in the environment.
    expect(local.helperAccess.enabled).toBe(false);
    expect(local.helperAccess.store).toBe(local.store);
  });

  it('keeps a given helperAccess (test seam) for dispatch and the routes', () => {
    const given = createHelperAccess({
      projectId: PROJECT,
      accessToken: ACCESS,
      store: new AuditStore(new LocalAuditStoreBackend(path.join(scratch, 'given'))),
    });
    const server = new RunnerServer({
      dataDir: path.join(scratch, 'data'),
      outputDir: path.join(scratch, 'report'),
      accessToken: ACCESS,
      helperAccess: given,
    });
    expect(server.auditWiring.helperAccess).toBe(given);
  });
});

describe('Helper sign-in configured: a runner built as cli.ts builds it (REQ-033)', () => {
  let scratch: string;
  let server: RunnerServer;
  let wiring: AuditWiring;
  let auditA: string;
  let auditB: string;
  let cookie: string;

  beforeAll(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-wiring-on-'));
    stubHelperEnv(PROJECT);
    server = asCliBuildsIt(ON_PORT, scratch, ACCESS);
    wiring = server.auditWiring;
    await server.start();
    auditA = (await wiring.store.createAudit(REQUEST)).auditId;
    auditB = (await wiring.store.createAudit({ ...REQUEST, url: 'https://gym.example/' })).auditId;
    // The real clock: the server reads the cookie now.
    cookie = `${HELPER_COOKIE}=${signHelperSession(wiring.helperAccess.sessionKey(), { email: HELPER, sub: 'uid-1' }, new Date())}`;
  });

  afterAll(async () => {
    await server?.stop();
    vi.unstubAllEnvs();
    await removeDir(scratch);
  });

  beforeEach(async () => {
    for (const id of [auditA, auditB])
      for (const g of await wiring.store.listHelpers(id)) await wiring.store.removeHelper(id, g.email);
  });

  it('the Helper status row says Helper sign-in is on, with the public Firebase settings', async () => {
    const status = await call(ON_PORT, 'GET', '/api/helper/status');
    expect(status.status).toBe(200);
    expect(status.json).toEqual({
      enabled: true,
      firebase: { apiKey: WEB_KEY, authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT },
    });
  });

  it('a Helper uses a view row of a granted audit and is refused for an audit not granted', async () => {
    await wiring.store.grantHelper(auditA, HELPER, ['view']);

    const granted = await call(ON_PORT, 'GET', `/api/audits/${auditA}`, { cookie });
    expect(granted.status).toBe(200);
    expect(granted.json.summary.auditId).toBe(auditA);

    const notGranted = await call(ON_PORT, 'GET', `/api/audits/${auditB}`, { cookie });
    expect(notGranted.status).toBe(404);
    expect(notGranted.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    expect(notGranted.body).not.toContain(auditB);

    // The id-less list row: only the Helper's own audits.
    const list = await call(ON_PORT, 'GET', '/api/audits', { cookie });
    expect(list.status).toBe(200);
    expect(list.json.audits.map((a: { auditId: string }) => a.auditId)).toEqual([auditA]);

    // The sign-in session row reads the same grants.
    const session = await call(ON_PORT, 'GET', '/api/helper/session', { cookie });
    expect(session.status).toBe(200);
    expect(session.json.email).toBe(HELPER);
    expect(session.json.grants.map((g: { auditId: string }) => g.auditId)).toEqual([auditA]);
  });

  it('refuses a view-only Helper on edit and owner rows, and ends access when the grant is removed', async () => {
    await wiring.store.grantHelper(auditA, HELPER, ['view']);

    const edit = await call(ON_PORT, 'PATCH', `/api/audits/${auditA}/edits`, { cookie });
    expect(edit.status).toBe(403);
    expect(edit.json.code).toBe('ERR_FORBIDDEN');

    const remove = await call(ON_PORT, 'DELETE', `/api/audits/${auditA}`, { cookie });
    expect(remove.status).toBe(403);
    expect(remove.json.code).toBe('ERR_FORBIDDEN');
    expect(await wiring.store.getAudit(auditA)).not.toBeNull();

    await wiring.store.removeHelper(auditA, HELPER);
    const after = await call(ON_PORT, 'GET', `/api/audits/${auditA}`, { cookie });
    expect(after.status).toBe(404);
    expect(after.json.code).toBe('ERR_AUDIT_NOT_FOUND');
  });

  it('keeps the owner and the access-key gate as they were', async () => {
    const noKey = await call(ON_PORT, 'GET', `/api/audits/${auditA}`);
    expect(noKey.status).toBe(401);
    expect(noKey.json.code).toBe('ERR_ACCESS_KEY');

    const asOwner = await call(ON_PORT, 'GET', `/api/audits/${auditB}`, owner);
    expect(asOwner.status).toBe(200);
    expect(asOwner.json.summary.auditId).toBe(auditB);
  });
});

describe('Helper sign-in not configured: owner behaviour unchanged (REQ-033)', () => {
  let scratch: string;
  let server: RunnerServer;
  let wiring: AuditWiring;
  let auditA: string;

  beforeAll(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-wiring-off-'));
    stubHelperEnv('');
    server = asCliBuildsIt(OFF_PORT, scratch, ACCESS);
    wiring = server.auditWiring;
    await server.start();
    auditA = (await wiring.store.createAudit(REQUEST)).auditId;
    await wiring.store.grantHelper(auditA, HELPER, ['view']);
  });

  afterAll(async () => {
    await server?.stop();
    vi.unstubAllEnvs();
    await removeDir(scratch);
  });

  it('the Helper rows say Helper sign-in is not set up', async () => {
    expect(wiring.helperAccess.enabled).toBe(false);
    expect(wiring.helperAccess.store).toBe(wiring.store);

    const status = await call(OFF_PORT, 'GET', '/api/helper/status');
    expect(status.status).toBe(200);
    expect(status.json).toEqual({ enabled: false });

    const session = await call(OFF_PORT, 'GET', '/api/helper/session');
    expect(session.status).toBe(404);
    expect(session.json.code).toBe('ERR_HELPERS_OFF');
  });

  it('a Helper cookie grants nothing and gets the access-key refusal; the owner keeps every row', async () => {
    const cookie = `${HELPER_COOKIE}=${signHelperSession(newHelperSessionKey(), { email: HELPER, sub: 'uid-1' }, new Date())}`;

    const view = await call(OFF_PORT, 'GET', `/api/audits/${auditA}`, { cookie });
    expect(view.status).toBe(401);
    expect(view.json.code).toBe('ERR_ACCESS_KEY');

    const remove = await call(OFF_PORT, 'DELETE', `/api/audits/${auditA}`, { cookie });
    expect(remove.status).toBe(401);

    const asOwner = await call(OFF_PORT, 'GET', `/api/audits/${auditA}`, owner);
    expect(asOwner.status).toBe(200);
    expect(asOwner.json.summary.auditId).toBe(auditA);

    const list = await call(OFF_PORT, 'GET', '/api/audits', owner);
    expect(list.status).toBe(200);
    expect(list.json.audits.map((a: { auditId: string }) => a.auditId)).toEqual([auditA]);
  });
});
