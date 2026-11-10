/**
 * REQ-048 (BE-102): RunnerServer dispatch matches the route table before the access-key gate, then applies
 * each row's access level and beta policy. A test-only table stands in for the audit rows still to come.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';
import type { AuditRequest, DiscoveryDraft, ReviewPlan } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import { RunnerServer } from '../src/server.js';
import type { StoredPlanRecord } from '../src/session/plan-store.js';
import { sendJson, type Route, type RouteContext } from '../src/routes/index.js';
import { createHelperAccess, helperSettingsFromEnv, type HelperAccess } from '../src/helpers/index.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';

const KEYED_PORT = 3651;
const BETA_PORT = 3652;
const KEY = 'k3y-route-access-0123456789';
const scratch = path.join(process.cwd(), '.tmp-route-access-server');

const AUDIT_ID = 'audit_12345';
const LINK_ID = 'L'.repeat(22);

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(
  port: number,
  method: string,
  rawPath: string,
  headers: Record<string, string> = {},
  json?: unknown
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const payload = json === undefined ? undefined : JSON.stringify(json);
    const sent = payload
      ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }
      : {};
    const req = http.request(
      { host: 'localhost', port, path: rawPath, method, headers: { host: `localhost:${port}`, ...sent, ...headers } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** A handler that says which row answered and with what parameters. */
function reply(row: string) {
  return (c: RouteContext) => sendJson(c.res, 200, { row, params: c.params ?? null });
}

const testRoutes: readonly Route[] = [
  { method: 'GET', path: '/api/t/no-access', beta: 'allow', handle: reply('no-access') },
  { method: 'GET', path: '/api/t/owner', access: 'owner', beta: 'allow', handle: reply('owner') },
  { method: 'GET', path: '/api/t/owner-closed', access: 'owner', handle: reply('owner-closed') },
  { method: 'GET', path: '/s/:linkId', access: 'public', beta: 'allow', handle: reply('shared') },
  { method: 'GET', path: '/p/:linkId', access: 'public', handle: reply('public-closed') },
  { method: 'GET', path: '/api/t/audits/:id', access: 'view', handle: reply('audit-view') },
  { method: 'GET', path: '/api/t/audits/:id/export', access: 'export', handle: reply('audit-export') },
  { method: 'POST', path: '/api/t/helper/session', access: 'sign-in', handle: reply('sign-in') },
];

/** Test hook: a request with `x-test-helper: view` holds 'view' on audit_12345 only. */
const helperGrants = (req: http.IncomingMessage, params: Readonly<Record<string, string>>) =>
  req.headers['x-test-helper'] === 'view' && params.id === AUDIT_ID ? (['view'] as const) : [];

describe('Route dispatch enforces access levels and the beta policy (REQ-048)', () => {
  let keyed: RunnerServer;
  let beta: RunnerServer;

  beforeAll(async () => {
    keyed = new RunnerServer({
      port: KEYED_PORT,
      outputDir: path.join(scratch, 'keyed-report'),
      dataDir: path.join(scratch, 'keyed-data'),
      accessToken: KEY,
      routes: testRoutes,
      helperGrants,
    });
    beta = new RunnerServer({
      port: BETA_PORT,
      outputDir: path.join(scratch, 'beta-report'),
      dataDir: path.join(scratch, 'beta-data'),
      beta: true,
      routes: testRoutes,
      helperGrants,
    });
    await keyed.start();
    await beta.start();
  });

  afterAll(async () => {
    await keyed?.stop();
    await beta?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('AC-1: refuses a row registered without an access level, even with the key', async () => {
    const withKey = await call(KEYED_PORT, 'GET', '/api/t/no-access', { 'x-qa-access': KEY });
    expect(withKey.status).toBe(403);
    expect(JSON.parse(withKey.body)).toEqual({ error: expect.any(String), code: 'ERR_ROUTE_CLOSED' });

    const withoutKey = await call(KEYED_PORT, 'GET', '/api/t/no-access');
    expect(withoutKey.status).toBe(403);
    expect(withoutKey.body).not.toContain('no-access"');

    const onBeta = await call(BETA_PORT, 'GET', '/api/t/no-access');
    expect(onBeta.status).toBe(403);
    expect(JSON.parse(onBeta.body).code).toBe('ERR_ROUTE_CLOSED');
  });

  it("AC-3: an 'owner' row is refused without the access key and served with it", async () => {
    const refused = await call(KEYED_PORT, 'GET', '/api/t/owner');
    expect(refused.status).toBe(401);
    expect(JSON.parse(refused.body).error).toMatch(/access key/);

    const wrongKey = await call(KEYED_PORT, 'GET', '/api/t/owner', { 'x-qa-access': 'not-the-key' });
    expect(wrongKey.status).toBe(401);

    const served = await call(KEYED_PORT, 'GET', '/api/t/owner', { 'x-qa-access': KEY });
    expect(served.status).toBe(200);
    expect(JSON.parse(served.body)).toEqual({ row: 'owner', params: {} });

    const byCookie = await call(KEYED_PORT, 'GET', '/api/t/owner', { cookie: `qa_access=${encodeURIComponent(KEY)}` });
    expect(byCookie.status).toBe(200);
  });

  it("AC-4: a 'public' row is served without the key, with its parameter decoded", async () => {
    const served = await call(KEYED_PORT, 'GET', `/s/${LINK_ID}`);
    expect(served.status).toBe(200);
    expect(JSON.parse(served.body)).toEqual({ row: 'shared', params: { linkId: LINK_ID } });
  });

  it('AC-4: a malformed linkId does not match the public row (404), and does not open the gate', async () => {
    for (const bad of ['short', `${LINK_ID}%2F..`, `${LINK_ID}.html`, 'L'.repeat(129)]) {
      const withKey = await call(KEYED_PORT, 'GET', `/s/${bad}`, { 'x-qa-access': KEY });
      expect(withKey.status, bad).toBe(404);
      expect(JSON.parse(withKey.body), bad).toEqual({ error: 'Not found' });
      // Without the key it never reaches a row: the access-key gate answers as before.
      const withoutKey = await call(KEYED_PORT, 'GET', `/s/${bad}`);
      expect(withoutKey.status, bad).toBe(401);
      expect(withoutKey.body).not.toContain('"row"');
    }
  });

  it("view/export rows accept the key or a Helper grant of that permission, through the server's hook", async () => {
    const owner = await call(KEYED_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`, { 'x-qa-access': KEY });
    expect(owner.status).toBe(200);
    expect(JSON.parse(owner.body)).toEqual({ row: 'audit-view', params: { id: AUDIT_ID } });

    const helper = await call(KEYED_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`, { 'x-test-helper': 'view' });
    expect(helper.status).toBe(200);

    const noHelper = await call(KEYED_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`);
    expect(noHelper.status).toBe(401);
    expect(JSON.parse(noHelper.body).code).toBe('ERR_ACCESS_KEY');

    // A 'view' grant is not an 'export' grant, and a grant on one audit is not one on another.
    const exportAsViewer = await call(KEYED_PORT, 'GET', `/api/t/audits/${AUDIT_ID}/export`, {
      'x-test-helper': 'view',
    });
    expect(exportAsViewer.status).toBe(401);
    const otherAudit = await call(KEYED_PORT, 'GET', '/api/t/audits/audit_99999', { 'x-test-helper': 'view' });
    expect(otherAudit.status).toBe(401);
  });

  it("a 'sign-in' row is served without the key", async () => {
    const signIn = await call(KEYED_PORT, 'POST', '/api/t/helper/session');
    expect(signIn.status).toBe(200);
    expect(JSON.parse(signIn.body).row).toBe('sign-in');
  });

  it("AC-5: on a beta copy a row whose beta policy is not 'allow' is refused; a 'public' 'allow' row is served", async () => {
    const closedOwner = await call(BETA_PORT, 'GET', '/api/t/owner-closed');
    expect(closedOwner.status).toBe(403);
    expect(JSON.parse(closedOwner.body).code).toBe('ERR_BETA');

    const closedPublic = await call(BETA_PORT, 'GET', `/p/${LINK_ID}`);
    expect(closedPublic.status).toBe(403);
    expect(JSON.parse(closedPublic.body).code).toBe('ERR_BETA');

    const auditRow = await call(BETA_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`);
    expect(auditRow.status).toBe(403);
    expect(JSON.parse(auditRow.body).code).toBe('ERR_BETA');

    const shared = await call(BETA_PORT, 'GET', `/s/${LINK_ID}`);
    expect(shared.status).toBe(200);
    expect(JSON.parse(shared.body)).toEqual({ row: 'shared', params: { linkId: LINK_ID } });

    const allowed = await call(BETA_PORT, 'GET', '/api/t/owner');
    expect(allowed.status).toBe(200);
  });

  it('a beta caller with only the access key is not an audit owner', async () => {
    const ownerClosed = await call(BETA_PORT, 'GET', '/api/t/owner-closed');
    expect(ownerClosed.status).toBe(403);
    expect(JSON.parse(ownerClosed.body).code).toBe('ERR_BETA');

    const auditRow = await call(BETA_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`);
    expect(auditRow.status).toBe(403);
    expect(JSON.parse(auditRow.body).code).toBe('ERR_BETA');
  });

  it('T-94: 25 views of a Shared Link from one address all answer 200 (no beta session created)', async () => {
    for (let i = 0; i < 25; i++) {
      const res = await call(BETA_PORT, 'GET', `/s/${LINK_ID}`);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ row: 'shared', params: { linkId: LINK_ID } });
    }
  });

  it('D-005: on a beta copy, Helper sign-in and a granted Helper pass the beta policy', async () => {
    const signIn = await call(BETA_PORT, 'POST', '/api/t/helper/session');
    expect(signIn.status).toBe(200);

    const granted = await call(BETA_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`, { 'x-test-helper': 'view' });
    expect(granted.status).toBe(200);
    expect(JSON.parse(granted.body).row).toBe('audit-view');
  });

  it('paths outside the table keep the gate and the fallback as before', async () => {
    expect((await call(KEYED_PORT, 'GET', '/api/t/unknown')).status).toBe(401);
    const fallback = await call(KEYED_PORT, 'GET', '/api/t/unknown', { 'x-qa-access': KEY });
    expect(fallback.status).toBe(404);
    expect(JSON.parse(fallback.body)).toEqual({ error: 'Not found' });
  });
});

describe('DEC-004: with no access key set, only the local machine is the owner', () => {
  const LOCAL_PORT = 3653;
  const REMOTE_PORT = 3655;
  let local: RunnerServer;
  let remote: RunnerServer;

  beforeAll(async () => {
    local = new RunnerServer({
      port: LOCAL_PORT,
      outputDir: path.join(scratch, 'local-report'),
      dataDir: path.join(scratch, 'local-data'),
      routes: testRoutes,
    });
    remote = new RunnerServer({
      port: REMOTE_PORT,
      outputDir: path.join(scratch, 'remote-report'),
      dataDir: path.join(scratch, 'remote-data'),
      routes: testRoutes,
    });
    await local.start();
    await remote.start();
    // Every connection to this server reports a non-loopback peer (TEST-NET-3), as a request from another
    // machine would; the request still goes through the real dispatch.
    const httpServer = (remote as unknown as { server: http.Server }).server;
    httpServer.prependListener('connection', (socket) => {
      Object.defineProperty(socket, 'remoteAddress', { value: '203.0.113.7', configurable: true });
    });
  });

  afterAll(async () => {
    await local?.stop();
    await remote?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('no key + loopback request: the owner, served', async () => {
    const owner = await call(LOCAL_PORT, 'GET', '/api/t/owner');
    expect(owner.status).toBe(200);
    expect(JSON.parse(owner.body)).toEqual({ row: 'owner', params: {} });
    const view = await call(LOCAL_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`);
    expect(view.status).toBe(200);
  });

  it('no key + non-loopback request: refused with 401 ERR_ACCESS_KEY; public rows still served', async () => {
    const refused = await call(REMOTE_PORT, 'GET', '/api/t/owner');
    expect(refused.status).toBe(401);
    expect(JSON.parse(refused.body)).toEqual({ error: expect.stringMatching(/access key/), code: 'ERR_ACCESS_KEY' });
    expect(refused.body).not.toContain('"row"');

    const view = await call(REMOTE_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`);
    expect(view.status).toBe(401);
    expect(JSON.parse(view.body).code).toBe('ERR_ACCESS_KEY');

    const shared = await call(REMOTE_PORT, 'GET', `/s/${LINK_ID}`);
    expect(shared.status).toBe(200);
  });

  it('key set: the key is required even from the local machine', async () => {
    const keyedLocal = new RunnerServer({
      port: KEYED_LOOPBACK_PORT,
      outputDir: path.join(scratch, 'keyed-local-report'),
      dataDir: path.join(scratch, 'keyed-local-data'),
      accessToken: KEY,
      routes: testRoutes,
    });
    await keyedLocal.start();
    try {
      const refused = await call(KEYED_LOOPBACK_PORT, 'GET', '/api/t/owner');
      expect(refused.status).toBe(401);
      const view = await call(KEYED_LOOPBACK_PORT, 'GET', `/api/t/audits/${AUDIT_ID}`);
      expect(view.status).toBe(401);
      expect(JSON.parse(view.body).code).toBe('ERR_ACCESS_KEY');
      const served = await call(KEYED_LOOPBACK_PORT, 'GET', '/api/t/owner', { 'x-qa-access': KEY });
      expect(served.status).toBe(200);
    } finally {
      await keyedLocal.stop();
    }
  });
});

const KEYED_LOOPBACK_PORT = 3656;
const KEYED_LOCAL_CHECK_PORT = 3654;
const REQUEST: AuditRequest = {
  url: 'https://salon.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};
const HELPER = 'priya@example.com';

describe('Helper access through the RunnerServer dispatch (REQ-033 wiring, BE-102)', () => {
  let storeDir: string;
  let store: AuditStore;
  let access: HelperAccess;
  let server: RunnerServer;
  let auditA: string;
  let auditB: string;

  const helperRows: readonly Route[] = [
    ...testRoutes,
    { method: 'GET', path: '/api/t/audits', access: 'view', handle: reply('audit-list') },
    { method: 'GET', path: '/api/t/shortlist', access: 'view', handle: reply('shortlist') },
  ];

  function cookieFor(email: string): string {
    return `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), { email, sub: 'uid-1' }, new Date())}`;
  }

  beforeAll(async () => {
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-route-access-helper-'));
    store = new AuditStore(new LocalAuditStoreBackend(storeDir));
    access = createHelperAccess({
      ...helperSettingsFromEnv({ FIREBASE_PROJECT_ID: 'proj', RUNNER_ACCESS_TOKEN: KEY }),
      store,
    });
    auditA = (await store.createAudit(REQUEST)).auditId;
    auditB = (await store.createAudit({ ...REQUEST, url: 'https://gym.example/' })).auditId;
    await store.grantHelper(auditA, HELPER, ['view']);
    server = new RunnerServer({
      port: KEYED_LOCAL_CHECK_PORT,
      outputDir: path.join(scratch, 'helper-report'),
      dataDir: path.join(scratch, 'helper-data'),
      accessToken: KEY,
      routes: helperRows,
      helperAccess: access,
    });
    await server.start();
  });

  afterAll(async () => {
    await server?.stop();
    await fs.rm(storeDir, { recursive: true, force: true });
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('a signed-in Helper gets 200 on a granted audit', async () => {
    const granted = await call(KEYED_LOCAL_CHECK_PORT, 'GET', `/api/t/audits/${auditA}`, { cookie: cookieFor(HELPER) });
    expect(granted.status).toBe(200);
    expect(JSON.parse(granted.body)).toEqual({ row: 'audit-view', params: { id: auditA } });
  });

  it('a signed-in Helper gets 404 ERR_AUDIT_NOT_FOUND on an audit not granted', async () => {
    const other = await call(KEYED_LOCAL_CHECK_PORT, 'GET', `/api/t/audits/${auditB}`, { cookie: cookieFor(HELPER) });
    expect(other.status).toBe(404);
    expect(JSON.parse(other.body)).toEqual({ error: expect.any(String), code: 'ERR_AUDIT_NOT_FOUND' });
    expect(other.body).not.toContain('"row"');
  });

  it('a signed-in Helper gets 403 ERR_FORBIDDEN on an owner row and on an ungranted permission', async () => {
    const owner = await call(KEYED_LOCAL_CHECK_PORT, 'GET', '/api/t/owner', { cookie: cookieFor(HELPER) });
    expect(owner.status).toBe(403);
    expect(JSON.parse(owner.body)).toEqual({ error: expect.any(String), code: 'ERR_FORBIDDEN' });

    const exportRow = await call(KEYED_LOCAL_CHECK_PORT, 'GET', `/api/t/audits/${auditA}/export`, {
      cookie: cookieFor(HELPER),
    });
    expect(exportRow.status).toBe(403);
    expect(JSON.parse(exportRow.body).code).toBe('ERR_FORBIDDEN');
  });

  it('a signed-in Helper with a view grant gets 200 on the id-less list rows', async () => {
    for (const [rowPath, row] of [
      ['/api/t/audits', 'audit-list'],
      ['/api/t/shortlist', 'shortlist'],
    ]) {
      const list = await call(KEYED_LOCAL_CHECK_PORT, 'GET', rowPath, { cookie: cookieFor(HELPER) });
      expect(list.status, rowPath).toBe(200);
      expect(JSON.parse(list.body).row).toBe(row);
    }
  });

  it('a signed-in Helper without any grant is refused the list rows; no session keeps the key refusal', async () => {
    const noGrant = await call(KEYED_LOCAL_CHECK_PORT, 'GET', '/api/t/audits', {
      cookie: cookieFor('nobody@example.com'),
    });
    expect(noGrant.status).toBe(403);
    expect(JSON.parse(noGrant.body).code).toBe('ERR_FORBIDDEN');

    const anonymous = await call(KEYED_LOCAL_CHECK_PORT, 'GET', '/api/t/audits');
    expect(anonymous.status).toBe(401);
    expect(JSON.parse(anonymous.body).code).toBe('ERR_ACCESS_KEY');

    const anonymousOwner = await call(KEYED_LOCAL_CHECK_PORT, 'GET', '/api/t/owner');
    expect(anonymousOwner.status).toBe(401);
  });

  it('the owner with the key is served every row as before', async () => {
    for (const rowPath of ['/api/t/owner', '/api/t/audits', `/api/t/audits/${auditB}`]) {
      const served = await call(KEYED_LOCAL_CHECK_PORT, 'GET', rowPath, { 'x-qa-access': KEY });
      expect(served.status, rowPath).toBe(200);
    }
  });
});

const SLOT_PORT = 3657;

/** A Plan awaiting review for a reserved `.example` host, which no test ever reaches. */
function storedPlan(runId: string, host: string): StoredPlanRecord {
  const targetUrl = `http://${host}/`;
  const draft: DiscoveryDraft = {
    version: '1.0',
    productId: 'slot-test',
    targetUrl,
    timestamp: new Date().toISOString(),
    pages: [],
    forms: [],
    flows: [],
    sensitiveActions: [],
    ambiguityQuestions: [],
    exploration: { signedInAs: [], signInFailed: [], signInPages: [], notReached: [], notes: [] },
  };
  const plan: ReviewPlan = {
    runId,
    targetUrl,
    discoveredAt: new Date().toISOString(),
    pages: [],
    flows: [],
    questions: [],
    testCases: [],
    planPages: [],
    navigation: [],
    screenSizes: ['1440px'],
  };
  return {
    plan,
    status: 'awaiting-review',
    context: { runId, targetUrl, productId: 'slot-test', siteHost: host, draft },
  };
}

describe('F-030: a Website Audit or Competitive Benchmark in the run slot keeps the Plan closed (DEC-002, REQ-049)', () => {
  let server: RunnerServer;

  beforeAll(async () => {
    server = new RunnerServer({
      port: SLOT_PORT,
      outputDir: path.join(scratch, 'slot-report'),
      dataDir: path.join(scratch, 'slot-data'),
    });
    await server.start();
  });

  afterEach(async () => {
    // Back to a free slot, an idle Check-up and no stored Plan.
    server.session.run.release();
    server.session.run.release();
    await server.session.plan.clear();
  });

  afterAll(async () => {
    await server?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  for (const kind of ['audit', 'benchmark'] as const) {
    it(`${kind} holds the slot: the stored Plan is not marked awaiting review, and approving answers 409`, async () => {
      const run = server.session.run;
      await server.session.plan.save(storedPlan(`run-stored-${kind}`, `stored-${kind}.example`));
      expect(run.begin(`${kind}-1`, 'https://salon.example/', kind)).toBe(true);
      const generation = run.generation;

      const status = await call(SLOT_PORT, 'GET', '/api/runner/status');
      expect(status.status).toBe(200);
      expect(JSON.parse(status.body)).toMatchObject({ phase: 'idle', isRunning: false });
      expect(run.phase).toBe('idle');

      const plan = await call(SLOT_PORT, 'GET', '/api/runner/plan');
      expect(plan.status).toBe(404);
      expect(run.phase).toBe('idle');

      const approve = await call(SLOT_PORT, 'POST', '/api/runner/plan/approve', {}, {});
      expect(approve.status).toBe(409);
      expect(JSON.parse(approve.body)).toEqual({
        error: expect.stringMatching(/is in progress\. Try again when it has finished\.$/),
        code: 'ERR_RUN_IN_PROGRESS',
      });
      expect(run.phase).not.toBe('awaiting-review');
      expect(run.isRunning).toBe(false);
      expect(run.runId).toBeNull();
      expect(run.kind).toBe(kind);
      expect(run.generation).toBe(generation);
      expect(server.session.plan.currentRecord?.status).toBe('awaiting-review');

      // The Plan is kept: once the slot is free it is back for review, for the Check-up.
      run.release();
      const back = await call(SLOT_PORT, 'GET', '/api/runner/plan');
      expect(back.status).toBe(200);
      expect(JSON.parse(back.body).runId).toBe(`run-stored-${kind}`);
      expect(run.phase).toBe('awaiting-review');
      expect(run.kind).toBe('checkup');
    });

    it(`${kind} holds the slot: bringing back a kept Plan answers 409 ERR_RUN_IN_PROGRESS and changes nothing`, async () => {
      const run = server.session.run;
      const host = `kept-${kind}.example`;
      await server.session.plan.park(storedPlan(`run-kept-${kind}`, host));
      expect(run.begin(`${kind}-2`, 'https://salon.example/', kind)).toBe(true);
      const generation = run.generation;

      const resumed = await call(SLOT_PORT, 'POST', '/api/runner/waiting-plans', {}, { host });
      expect(resumed.status).toBe(409);
      expect(JSON.parse(resumed.body)).toEqual({
        error: expect.stringMatching(/is in progress\. Try again when it has finished\.$/),
        code: 'ERR_RUN_IN_PROGRESS',
      });
      expect(run.phase).toBe('idle');
      expect(run.isRunning).toBe(false);
      expect(run.runId).toBeNull();
      expect(run.targetUrl).toBeNull();
      expect(run.generation).toBe(generation);
      expect(run.kind).toBe(kind);
      expect(server.session.plan.currentRecord).toBeNull();
      expect(server.session.plan.parked.get(host)?.plan.runId).toBe(`run-kept-${kind}`);
      const list = await call(SLOT_PORT, 'GET', '/api/runner/waiting-plans');
      expect(JSON.parse(list.body).plans.map((p: { host: string }) => p.host)).toContain(host);

      await server.session.plan.unpark(host);
    });
  }

  it('with the slot free, bringing back a kept Plan claims the slot for the Check-up and sets the waiting one aside', async () => {
    const run = server.session.run;
    await server.session.plan.save(storedPlan('run-waiting-a', 'site-a.example'));
    await server.session.plan.park(storedPlan('run-kept-b', 'site-b.example'));
    expect((await call(SLOT_PORT, 'GET', '/api/runner/plan')).status).toBe(200);
    expect(run.phase).toBe('awaiting-review');
    const generation = run.generation;

    const resumed = await call(SLOT_PORT, 'POST', '/api/runner/waiting-plans', {}, { host: 'site-b.example' });
    expect(resumed.status).toBe(200);
    expect(JSON.parse(resumed.body)).toEqual({
      resumed: true,
      runId: 'run-kept-b',
      targetUrl: 'http://site-b.example/',
    });
    expect(run.kind).toBe('checkup');
    expect(run.phase).toBe('awaiting-review');
    expect(run.isRunning).toBe(true);
    expect(run.runId).toBe('run-kept-b');
    expect(run.targetUrl).toBe('http://site-b.example/');
    expect(run.generation).toBe(generation + 1);
    expect(server.session.plan.currentRecord?.plan.runId).toBe('run-kept-b');
    expect(server.session.plan.parked.get('site-a.example')?.plan.runId).toBe('run-waiting-a');
    // While the resumed Plan awaits review, an audit cannot take the slot.
    expect(run.begin('audit-3', 'https://salon.example/', 'audit')).toBe(false);

    await server.session.plan.unpark('site-a.example');
  });
});
