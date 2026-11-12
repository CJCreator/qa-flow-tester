/**
 * T-299: on the hosted copy a scheduled Check-up has no visitor session, so its report belongs to the copy's
 * owners (a sign-in with an AUDIT_OWNER_EMAILS account). A key-only tester and a non-owner Helper never see it,
 * and a run a tester started themselves stays theirs alone.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { AuditStore, LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import { RunnerServer } from '../src/server.js';
import { createHelperAccess } from '../src/helpers/index.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';
import type { CheckupSchedule, ScheduleStore } from '../src/scheduler.js';
import { freePort } from './helpers/free-port.js';

const KEY = 'k3y-scheduled-owner-0123456789';
const OWNER = 'owner@example.com';
const OTHER = 'helper@example.com';
const RUN = 'run-1700000000000';
const OWN_RUN = 'run-1700000000001';
const scratch = path.join(process.cwd(), '.tmp-beta-scheduled-run-owner');
const publicNet = { lookup: async () => ['93.184.216.34'], connect: async () => Promise.reject(new Error('no')) };

function memoryStore(initial: CheckupSchedule[]): ScheduleStore {
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

let PORT = 0;

function call(rawPath: string, cookie?: string, withKey = true): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: rawPath,
        method: 'GET',
        headers: {
          host: `localhost:${PORT}`,
          ...(withKey ? { 'x-qa-access': KEY } : {}),
          ...(cookie ? { cookie } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

interface Caller {
  cookie: string;
  id: string;
}

/** A caller keeps the qa_session cookie of its first answer (so the per-address session limit is not hit). */
async function newCaller(helperEmail?: string): Promise<Caller> {
  const first = await call('/api/runner/status');
  const session = (first.headers['set-cookie']?.find((c) => c.startsWith('qa_session=')) || '').split(';')[0];
  const id = session.slice('qa_session='.length);
  if (!helperEmail) return { cookie: session, id };
  const signed = signHelperSession(access.sessionKey(), { email: helperEmail, sub: `sub-${helperEmail}` }, new Date());
  return { cookie: `${session}; ${HELPER_COOKIE}=${signed}`, id };
}

const listed = async (c: Caller): Promise<string[]> => {
  const res = await call('/api/runs', c.cookie);
  expect(res.status).toBe(200);
  const body = JSON.parse(res.body) as { runs?: Array<{ runId: string }> } | Array<{ runId: string }>;
  return (Array.isArray(body) ? body : (body.runs ?? [])).map((r) => r.runId);
};

type Inside = {
  runOwners: Map<string, string>;
  checkupRun: { start: unknown; waitFor: unknown };
};

let access: ReturnType<typeof createHelperAccess>;
let server: RunnerServer;

async function writeRun(runId: string): Promise<void> {
  const dir = path.join(scratch, 'report', 'runs', runId);
  await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'summary.json'),
    JSON.stringify({
      runId,
      targetUrl: 'https://example.com/',
      host: 'example.com',
      timestamp: new Date().toISOString(),
      ready: true,
      stamp: 'Ready to release',
      durationMs: 1000,
      counts: {},
    })
  );
  await fs.writeFile(
    path.join(dir, 'report.json'),
    JSON.stringify({ runId, targetUrl: 'https://example.com/', findings: [] })
  );
}

describe('On the hosted copy a scheduled run opens for the copys owners only (T-299)', () => {
  let owner: Caller;
  let tester: Caller;
  let helper: Caller;

  beforeAll(async () => {
    PORT = await freePort();
    const store = new AuditStore(new LocalAuditStoreBackend(path.join(scratch, 'audits')));
    access = createHelperAccess({ projectId: 'proj', accessToken: KEY, store, auditOwnerEmails: [OWNER] });
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      beta: true,
      accessToken: KEY,
      hostChecks: publicNet,
      scheduleStore: memoryStore([sched({ id: 'sched_1_due', targetUrl: 'https://example.com/' })]),
      helperAccess: access,
      auditOwnerEmails: [OWNER],
    });
    const inside = server as unknown as Inside;
    vi.spyOn(inside.checkupRun as { start: () => unknown }, 'start').mockResolvedValue({
      runId: RUN,
      awaitingReview: false,
    } as never);
    vi.spyOn(inside.checkupRun as { waitFor: () => unknown }, 'waitFor').mockResolvedValue(undefined as never);
    await server.start();

    await writeRun(RUN);
    await writeRun(OWN_RUN);

    owner = await newCaller(OWNER);
    tester = await newCaller();
    helper = await newCaller(OTHER);
    inside.runOwners.set(OWN_RUN, tester.id);

    const tick = await server.runScheduleTick();
    expect(tick.started).toBe(1);
    expect(inside.runOwners.get(RUN)).not.toBe(tester.id);
  });

  afterAll(async () => {
    await server?.stop();
    vi.restoreAllMocks();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('lists and opens the scheduled run for an owner signed in with an owner email', async () => {
    expect(await listed(owner)).toContain(RUN);
    expect((await call(`/api/runs/${RUN}`, owner.cookie)).status).toBe(200);
  });

  it('hides it from a tester who holds only the key', async () => {
    expect(await listed(tester)).not.toContain(RUN);
    const res = await call(`/api/runs/${RUN}`, tester.cookie);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).code).toBe('ERR_NOT_YOURS');
  });

  it('hides it from a Helper who is not an owner', async () => {
    expect(await listed(helper)).not.toContain(RUN);
    expect((await call(`/api/runs/${RUN}`, helper.cookie)).status).toBe(404);
  });

  it('keeps a run a tester started themselves theirs alone, from the owner too', async () => {
    expect(await listed(tester)).toContain(OWN_RUN);
    expect(await listed(owner)).not.toContain(OWN_RUN);
    expect((await call(`/api/runs/${OWN_RUN}`, owner.cookie)).status).toBe(404);
  });
});
