/**
 * BE-603 (REQ-028 AC-3): POST /api/audits/:id/rerun on a plain http server with a fake audit starter, a real
 * RunSlot and a real audit store in a temp folder: no Chromium, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, type AuditRequest } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend, type AuditAddressResult } from '@qa/core';
import {
  AUDIT_RERUN_RUNNING,
  createAuditRerunRoutes,
  type AuditRerunRouteDeps,
  type AuditStarter,
} from '../src/routes/audit-rerun.js';
import { AUDIT_START_FAILED } from '../src/routes/audit-crawl.js';
import { resolveRoute, type Route } from '../src/routes/route.js';
import { DefaultRunSlot } from '../src/session/run-slot.js';
import { AuditRuns } from '../src/session/audit-run.js';
import type { AuditCaller } from '../src/routes/audit-store.js';

const REQUEST: AuditRequest = {
  url: 'https://example.com/',
  limits: { maxPages: 7, maxDepth: 2, includePaths: ['/blog'], excludePaths: ['/admin'] },
  language: 'en',
};

let dir: string;
let store: AuditStore;
let slot: DefaultRunSlot;
let runs: AuditRuns;
let caller: AuditCaller;
let address: AuditAddressResult;
let addressCalls: string[];
let startCalls: Array<{ request: AuditRequest; version: number; slotKind: string | null }>;
let starter: AuditStarter;
let servers: http.Server[];
let auditId: string;

function deps(extra: Partial<AuditRerunRouteDeps> = {}): AuditRerunRouteDeps {
  return {
    store,
    caller: () => caller,
    slot: () => slot,
    runs,
    checkAddress: async (url) => {
      addressCalls.push(url);
      return address;
    },
    start: (services, input) => starter(services, input),
    ...extra,
  };
}

async function serve(rows: Route[]): Promise<string> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = resolveRoute(rows, req.method ?? 'GET', url.pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    Promise.resolve(match.route.handle({ server: undefined as never, req, res, url, params: match.params })).catch(
      () => {
        res.writeHead(500);
        res.end();
      }
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function rerun(base: string, id: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/api/audits/${id}/rerun`, { method: 'POST' });
  return { status: res.status, json: await res.json() };
}

function expectErrorReply(json: Record<string, unknown>, extraKeys: string[] = []): void {
  for (const key of Object.keys(json)) expect(['error', 'code', ...extraKeys]).toContain(key);
  expect(JSON.stringify(json)).not.toMatch(/\bat \w|stack|node:|ECONN/);
}

/** A saved audit whose version 1 has ended with `status`. */
async function savedAudit(status: 'done' | 'running' | 'failed' = 'done'): Promise<string> {
  const v1 = await store.createAudit(REQUEST);
  if (status !== 'running') {
    await store.updateVersion(v1.auditId, 1, { status, finishedAt: new Date().toISOString() });
  }
  return v1.auditId;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-rerun-route-'));
  store = new AuditStore(new LocalAuditStoreBackend(path.join(dir, 'store')));
  slot = new DefaultRunSlot();
  runs = new AuditRuns();
  caller = { owner: true };
  address = { ok: true, finalUrl: 'https://example.com/', status: 200 };
  addressCalls = [];
  startCalls = [];
  servers = [];
  // The fake starter records the call and lets the run end at once, as runAuditVersion does.
  starter = async (_services, { run, request, slot: s }) => {
    startCalls.push({ request, version: run.version, slotKind: s.kind });
    if (s.kind === 'audit') s.release();
    run.emit({ type: 'done', auditId: run.auditId, version: run.version });
  };
  auditId = await savedAudit();
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null)))));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('route row', () => {
  it('has the method, path and access of AUDIT_API.rerun (owner)', () => {
    const rows = createAuditRerunRoutes(deps());
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe(AUDIT_API.rerun.method);
    expect(rows[0].path).toBe(AUDIT_API.rerun.path);
    expect((rows[0] as Route & { access: string }).access).toBe(AUDIT_API.rerun.access);
    expect(AUDIT_API.rerun.access).toBe('owner');
  });
});

describe('POST /api/audits/:id/rerun', () => {
  it('answers 202 and starts a run with the saved url, limits and language as the next version', async () => {
    const base = await serve(createAuditRerunRoutes(deps()));
    const { status, json } = await rerun(base, auditId);
    expect(status).toBe(202);
    expect(json).toEqual({ auditId, version: 2 });
    expect(addressCalls).toEqual([REQUEST.url]);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0].request).toEqual(REQUEST);
    expect(startCalls[0].version).toBe(2);
    expect(startCalls[0].slotKind).toBe('audit');
    expect(runs.get(auditId)?.version).toBe(2);

    const audit = await store.getAudit(auditId);
    expect(audit?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(audit?.versions[1]).toMatchObject({
      url: REQUEST.url,
      limits: REQUEST.limits,
      language: 'en',
      status: 'running',
    });
  });

  it('can be run again after a failed version, and adds versions in order', async () => {
    const failedId = await savedAudit('failed');
    const base = await serve(createAuditRerunRoutes(deps()));
    expect((await rerun(base, failedId)).json).toEqual({ auditId: failedId, version: 2 });
    await store.updateVersion(failedId, 2, { status: 'done', finishedAt: new Date().toISOString() });
    expect((await rerun(base, failedId)).json).toEqual({ auditId: failedId, version: 3 });
  });

  it.each([
    ['a Check-up', 'checkup' as const],
    ['a Competitive Benchmark', 'benchmark' as const],
    ['another Website Audit', 'audit' as const],
  ])('answers 409 ERR_RUN_IN_PROGRESS while %s holds the slot, and adds no version', async (_name, kind) => {
    expect(slot.begin('other-run', 'https://other.example/', kind)).toBe(true);
    const base = await serve(createAuditRerunRoutes(deps()));
    const { status, json } = await rerun(base, auditId);
    expect(status).toBe(409);
    expect(json.code).toBe('ERR_RUN_IN_PROGRESS');
    expectErrorReply(json, ['running']);
    expect(json.running).toEqual({ kind: expect.stringMatching(/^(checkup|audit)$/), href: expect.any(String) });
    expect(addressCalls).toEqual([]);
    expect(startCalls).toEqual([]);
    expect((await store.getAudit(auditId))?.versions).toHaveLength(1);
    expect(slot.kind).toBe(kind);
  });

  it('answers 404 ERR_AUDIT_NOT_FOUND for an unknown audit and for a malformed id', async () => {
    const base = await serve(createAuditRerunRoutes(deps()));
    const unknown = await rerun(base, 'A'.repeat(22));
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    expectErrorReply(unknown.json);
    const malformed = await rerun(base, 'x');
    expect(malformed.status).toBe(404);
    // A malformed id never reaches the handler: the router answers 404 itself.
    expect(slot.kind).toBeNull();
    expect(startCalls).toEqual([]);
  });

  it('adds the next version when the stored latest version says running but no live run exists', async () => {
    const staleId = await savedAudit('running');
    const base = await serve(createAuditRerunRoutes(deps()));
    const { status, json } = await rerun(base, staleId);
    expect(status).toBe(202);
    expect(json).toEqual({ auditId: staleId, version: 2 });
    expect(startCalls).toHaveLength(1);
  });

  it('adds the next version when the live run of the latest version has finished', async () => {
    const doneId = await savedAudit('running');
    runs.start(doneId, 1).emit({ type: 'done', auditId: doneId, version: 1 });
    const base = await serve(createAuditRerunRoutes(deps()));
    expect((await rerun(base, doneId)).status).toBe(202);
  });

  it('answers 409 ERR_AUDIT_RUNNING while the latest version is still running, and adds no version', async () => {
    const runningId = await savedAudit('running');
    runs.start(runningId, 1);
    const base = await serve(createAuditRerunRoutes(deps()));
    const { status, json } = await rerun(base, runningId);
    expect(status).toBe(409);
    expect(json).toEqual({ error: AUDIT_RERUN_RUNNING, code: 'ERR_AUDIT_RUNNING' });
    expect((await store.getAudit(runningId))?.versions).toHaveLength(1);
    expect(slot.kind).toBeNull();
    expect(startCalls).toEqual([]);
  });

  it('refuses a caller who is not the owner with 403 and does nothing', async () => {
    caller = { owner: false, helperEmail: 'helper@example.com' };
    const base = await serve(createAuditRerunRoutes(deps()));
    const { status, json } = await rerun(base, auditId);
    expect(status).toBe(403);
    expect(json.code).toBe('ERR_FORBIDDEN');
    expect(startCalls).toEqual([]);
    expect((await store.getAudit(auditId))?.versions).toHaveLength(1);
  });

  it('checks the saved address again: private 400, unreachable 422, no version added', async () => {
    const base = await serve(createAuditRerunRoutes(deps()));
    address = { ok: false, code: 'ERR_PRIVATE_ADDRESS', reason: 'That address is private.' };
    const priv = await rerun(base, auditId);
    expect(priv.status).toBe(400);
    expect(priv.json.code).toBe('ERR_PRIVATE_ADDRESS');
    address = { ok: false, code: 'ERR_UNREACHABLE', reason: 'The site could not be reached.' };
    const down = await rerun(base, auditId);
    expect(down.status).toBe(422);
    expect(down.json.code).toBe('ERR_UNREACHABLE');
    expect((await store.getAudit(auditId))?.versions).toHaveLength(1);
    expect(slot.kind).toBeNull();
  });

  it('marks the new version failed with fixed wording and releases the slot when the start throws', async () => {
    starter = () => {
      throw new Error('boom: secret internals');
    };
    const base = await serve(createAuditRerunRoutes(deps()));
    const { status, json } = await rerun(base, auditId);
    expect(status).toBe(500);
    expect(json).toEqual({ error: AUDIT_START_FAILED });
    const v2 = (await store.getAudit(auditId))?.versions[1];
    expect(v2).toMatchObject({ version: 2, status: 'failed', error: AUDIT_START_FAILED });
    expect(slot.kind).toBeNull();
    // The slot is free: a new re-run is accepted.
    starter = async (_s, { run, slot: s }) => {
      if (s.kind === 'audit') s.release();
      run.emit({ type: 'done', auditId: run.auditId, version: run.version });
    };
    expect((await rerun(base, auditId)).status).toBe(202);
  });

  it('marks the new version failed and releases the slot when the version cannot be registered as a run', async () => {
    const brokenRuns = {
      start: () => {
        throw new Error('nope');
      },
      get: () => undefined,
    } as unknown as AuditRuns;
    const base = await serve(createAuditRerunRoutes(deps({ runs: brokenRuns })));
    const { status, json } = await rerun(base, auditId);
    expect(status).toBe(500);
    expect(json).toEqual({ error: AUDIT_START_FAILED });
    expect((await store.getAudit(auditId))?.versions[1]).toMatchObject({ status: 'failed', error: AUDIT_START_FAILED });
    expect(slot.kind).toBeNull();
  });

  it('marks the version failed and frees the slot when the starter rejects after the 202', async () => {
    starter = async () => {
      throw new Error('late failure');
    };
    const base = await serve(createAuditRerunRoutes(deps()));
    expect((await rerun(base, auditId)).status).toBe(202);
    // The slot is freed after the version is marked failed. Poll only the slot: reading the version file
    // while it is written makes the rename fail on Windows.
    const until = Date.now() + 10000;
    while (slot.kind !== null && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    expect((await store.getAudit(auditId))?.versions[1]).toMatchObject({ status: 'failed', error: AUDIT_START_FAILED });
    expect(slot.kind).toBeNull();
  });
});
