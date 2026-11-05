/**
 * ADR 0039: the schedule rows and the Cloud Scheduler tick, through the real RunnerServer dispatch.
 * Tokens are signed with a local RSA key; Google's key download is a fake fetch.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';
import { generateKeyPairSync, sign, type JsonWebKey } from 'crypto';
import { AuditStore, LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import { RunnerServer } from '../src/server.js';
import { GoogleOidcVerifier } from '../src/helpers/google-oidc-token.js';
import type { KeysFetch } from '../src/helpers/firebase-token.js';
import { createHelperAccess, helperSettingsFromEnv } from '../src/helpers/index.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';
import type { CheckupSchedule, ScheduleStore } from '../src/scheduler.js';

const SA = 'qa-scheduler@proj.iam.gserviceaccount.com';
const AUD = 'https://qa.example.run.app';
const KEY = 'k3y-schedule-routes-0123456789';
const scratch = path.join(process.cwd(), '.tmp-schedule-routes');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', alg: 'RS256' };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

function token(): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: AUD,
    exp: now + 600,
    iat: now - 5,
    email: SA,
    email_verified: true,
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function verifier(): GoogleOidcVerifier {
  const fetch: KeysFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'max-age=600' },
    json: async () => ({ keys: [jwk] }),
  });
  return new GoogleOidcVerifier({ serviceAccountEmail: SA, audiences: () => [AUD], fetch });
}

function memoryStore(initial: CheckupSchedule[] = []): ScheduleStore & { list: CheckupSchedule[] } {
  const store = {
    list: initial,
    read: async () => JSON.parse(JSON.stringify(store.list)) as CheckupSchedule[],
    write: async (l: CheckupSchedule[]) => {
      store.list = JSON.parse(JSON.stringify(l));
    },
  };
  return store;
}

function sched(over: Partial<CheckupSchedule>): CheckupSchedule {
  return {
    id: 'sched_1_aaaaa',
    name: 'N',
    targetUrl: 'http://localhost:3050',
    cadence: 'daily',
    hour: 2,
    preset: 'quick',
    enabled: true,
    createdAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() - 5000).toISOString(),
    ...over,
  };
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(port: number, method: string, rawPath: string, headers: Record<string, string> = {}, json?: unknown) {
  return new Promise<Answer>((resolve, reject) => {
    const payload = json === undefined ? undefined : JSON.stringify(json);
    const sent = payload
      ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }
      : {};
    const req = http.request(
      { host: 'localhost', port, path: rawPath, method, headers: { host: `localhost:${port}`, ...sent, ...headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const bearer = () => ({ authorization: `Bearer ${token()}` });
const TICK = '/api/runner/schedules/tick';
const publicNet = { lookup: async () => ['93.184.216.34'], connect: async () => Promise.reject(new Error('no')) };

type Spyable = { runSchedule: (s: CheckupSchedule) => Promise<boolean>; checkupRun: { start: () => unknown } };

afterAll(async () => {
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('POST /api/runner/schedules/tick (non-beta)', () => {
  const PORT = 3761;
  const store = memoryStore([
    sched({ id: 'sched_1_due', name: 'due' }),
    sched({ id: 'sched_2_off', enabled: false }),
    sched({ id: 'sched_3_later', nextRunAt: new Date(Date.now() + 3_600_000).toISOString() }),
  ]);
  let server: RunnerServer;
  let run: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'a-report'),
      dataDir: path.join(scratch, 'a-data'),
      accessToken: KEY,
      scheduleStore: store,
      schedulerAuth: verifier(),
    });
    run = vi.spyOn(server as unknown as Spyable, 'runSchedule').mockResolvedValue(true) as never;
    await server.start();
  });
  afterAll(async () => {
    await server.stop();
  });

  it('runs only the enabled, due schedule once; an immediate repeat runs none', async () => {
    const first = await call(PORT, 'POST', TICK, bearer());
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ started: 1, failed: 0, skipped: 1, busy: false });
    expect(run).toHaveBeenCalledTimes(1);
    const again = JSON.parse((await call(PORT, 'POST', TICK, bearer())).body);
    expect(again.started).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reply has exactly four keys and leaks no token, account or key', async () => {
    const t = token();
    const res = await call(PORT, 'POST', TICK, { authorization: `Bearer ${t}` });
    expect(Object.keys(JSON.parse(res.body)).sort()).toEqual(['busy', 'failed', 'skipped', 'started']);
    for (const secret of [t, SA, KEY]) expect(res.body).not.toContain(secret);
  });

  it('is 401 ERR_SCHEDULER_AUTH without a token, and the access key alone is not the credential', async () => {
    const cases: Record<string, string>[] = [{}, { 'x-qa-access': KEY }, { authorization: 'Bearer nope' }];
    for (const headers of cases) {
      const res = await call(PORT, 'POST', TICK, headers);
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body).code).toBe('ERR_SCHEDULER_AUTH');
    }
  });
});

describe('the tick with SCHEDULER_SERVICE_ACCOUNT unset', () => {
  const PORT = 3762;
  let server: RunnerServer;
  beforeAll(async () => {
    delete process.env.SCHEDULER_SERVICE_ACCOUNT;
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'b-report'),
      dataDir: path.join(scratch, 'b-data'),
      scheduleStore: memoryStore(),
    });
    await server.start();
  });
  afterAll(async () => {
    await server.stop();
  });

  it('stays closed: 401 even with a bearer token', async () => {
    const res = await call(PORT, 'POST', TICK, bearer());
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).code).toBe('ERR_SCHEDULER_AUTH');
  });
});

describe('schedules on a beta copy', () => {
  const PORT = 3763;
  const store = memoryStore([sched({ id: 'sched_9_priv', targetUrl: 'http://10.0.0.5/' })]);
  let server: RunnerServer;
  let helperCookie: string;
  let startSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-sched-helper-'));
    const access = createHelperAccess({
      ...helperSettingsFromEnv({ FIREBASE_PROJECT_ID: 'proj', RUNNER_ACCESS_TOKEN: KEY }),
      store: new AuditStore(new LocalAuditStoreBackend(storeDir)),
    });
    helperCookie = `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), { email: 'h@example.com', sub: 'u1' }, new Date())}`;
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'c-report'),
      dataDir: path.join(scratch, 'c-data'),
      beta: true,
      accessToken: KEY,
      scheduleStore: store,
      schedulerAuth: verifier(),
      helperAccess: access,
      hostChecks: publicNet,
    });
    startSpy = vi.spyOn((server as unknown as Spyable).checkupRun, 'start') as never;
    await server.start();
  });
  afterAll(async () => {
    await server.stop();
  });

  it('a Helper session without the key is 403 ERR_FORBIDDEN on schedule creation', async () => {
    const res = await call(
      PORT,
      'POST',
      '/api/runner/schedules',
      { cookie: helperCookie },
      { targetUrl: 'https://example.com' }
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).code).toBe('ERR_FORBIDDEN');
  });

  it('refuses private targets at creation with 400 ERR_PRIVATE_TARGET', async () => {
    for (const targetUrl of ['http://10.0.0.5/', 'http://localhost:3000']) {
      const res = await call(PORT, 'POST', '/api/runner/schedules', { 'x-qa-access': KEY }, { targetUrl });
      expect(res.status, targetUrl).toBe(400);
      expect(JSON.parse(res.body).code).toBe('ERR_PRIVATE_TARGET');
    }
  });

  it('rejects out-of-range values', async () => {
    const res = await call(
      PORT,
      'POST',
      '/api/runner/schedules',
      { 'x-qa-access': KEY },
      { targetUrl: 'https://example.com', hour: 25 }
    );
    expect(res.status).toBe(400);
  });

  it('a valid token is served (not 403/429) with no session cookie, however often it calls', async () => {
    for (let i = 0; i < 12; i++) {
      const res = await call(PORT, 'POST', TICK, bearer());
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('a stored private-address schedule is not started and is marked failed', async () => {
    store.list = [sched({ id: 'sched_9_priv', targetUrl: 'http://10.0.0.5/' })];
    const res = await call(PORT, 'POST', TICK, bearer());
    expect(JSON.parse(res.body)).toMatchObject({ started: 0, failed: 1 });
    expect(startSpy).not.toHaveBeenCalled();
    expect(store.list[0].lastRunStatus).toBe('failed');
  });
});

describe('a due localhost schedule on a non-beta copy', () => {
  const PORT = 3764;
  it('still starts a read-only run (no AI, not owner)', async () => {
    const store = memoryStore([sched({ id: 'sched_5_loc' })]);
    const server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'd-report'),
      dataDir: path.join(scratch, 'd-data'),
      scheduleStore: store,
      schedulerAuth: verifier(),
    });
    const start = vi
      .spyOn((server as unknown as Spyable).checkupRun, 'start')
      .mockRejectedValue(new Error('stop here')) as never as ReturnType<typeof vi.fn>;
    await server.start();
    try {
      await call(PORT, 'POST', TICK, bearer());
      expect(start).toHaveBeenCalledTimes(1);
      const body = (start.mock.calls[0][0] as { body: Record<string, unknown> }).body;
      expect(body).toMatchObject({ useAI: false, owner: false, targetUrl: 'http://localhost:3050' });
    } finally {
      await server.stop();
    }
  });
});
