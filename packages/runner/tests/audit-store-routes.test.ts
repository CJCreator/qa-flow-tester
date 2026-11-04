/**
 * BE-602 (REQ-028): the saved Website Audit rows (list, get, remove). The factory takes the store and the
 * caller, so these run without server.ts: each handler is called with a mock request and response.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, type AuditResult } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend } from '@qa/core';
import { auditStoreRoutes, mayUseAudit, type AuditCaller } from '../src/routes/audit-store.js';
import { matchAuditPath } from '@qa/types';
import type { Route } from '../src/routes/route.js';

class MockResponse {
  statusCode = 200;
  body = '';
  writeHead(status: number) {
    this.statusCode = status;
  }
  end(chunk?: string) {
    if (chunk) this.body += chunk;
  }
  json(): any {
    return JSON.parse(this.body);
  }
}

const OWNER: AuditCaller = { owner: true };
const REQUEST = {
  url: 'https://example.com/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en' as const,
};

let dir: string;
let store: AuditStore;
let caller: AuditCaller;

function routes(extra: { isRunning?: (id: string) => boolean } = {}): Route[] {
  return auditStoreRoutes({ store, caller: () => caller, ...extra });
}

async function call(rows: Route[], key: 'list' | 'get' | 'remove', pathname: string, search = '') {
  const { method, path: pattern } = AUDIT_API[key];
  const row = rows.find((r) => r.method === method && r.path === pattern)!;
  const params = (matchAuditPath(pattern, pathname) ?? {}) as Record<string, string>;
  const res = new MockResponse();
  await row.handle({
    server: undefined as never,
    req: { method, headers: {} } as http.IncomingMessage,
    res: res as unknown as http.ServerResponse,
    url: new URL(`http://localhost${pathname}${search}`),
    params,
  });
  return res;
}

function resultFor(auditId: string, version: number): AuditResult {
  return { auditId, version, url: REQUEST.url, pages: [], findings: [] } as unknown as AuditResult;
}

async function finishedAudit(): Promise<string> {
  const v1 = await store.createAudit(REQUEST);
  await store.saveResult(v1.auditId, 1, resultFor(v1.auditId, 1));
  await store.updateVersion(v1.auditId, 1, { status: 'done', finishedAt: '2026-11-03T00:00:00.000Z' });
  return v1.auditId;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-routes-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir));
  caller = OWNER;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('audit store rows', () => {
  it('each row equals its AUDIT_API entry: method, path, access', () => {
    const rows = routes();
    expect(rows).toHaveLength(3);
    for (const key of ['list', 'get', 'remove'] as const) {
      const entry = AUDIT_API[key];
      const matches = rows.filter((r) => r.method === entry.method && r.path === entry.path);
      expect(matches).toHaveLength(1);
      expect(matches[0].access).toBe(entry.access);
    }
    expect(AUDIT_API.remove.access).toBe('owner');
  });

  it('list: owner sees every audit with versions oldest first and the Shortlist entry', async () => {
    const id = await finishedAudit();
    await store.addVersion(id);
    await store.putShortlist(id, { mark: 'pitch', outcome: 'Interested' });
    const other = await store.createAudit(REQUEST);
    const res = await call(routes(), 'list', '/api/audits');
    expect(res.statusCode).toBe(200);
    const audits = res.json().audits;
    expect(audits.map((a: any) => a.auditId).sort()).toEqual([id, other.auditId].sort());
    const mine = audits.find((a: any) => a.auditId === id);
    expect(mine.versions.map((v: any) => v.version)).toEqual([1, 2]);
    expect(mine.shortlist).toMatchObject({ mark: 'pitch', outcome: 'Interested' });
  });

  it('list: a Helper sees only the audits granted to them (edit includes view; other Helpers excluded)', async () => {
    const a = await finishedAudit();
    const b = await finishedAudit();
    const c = await finishedAudit();
    await store.grantHelper(a, 'helper@example.com', ['view']);
    await store.grantHelper(b, 'helper@example.com', ['edit']);
    await store.grantHelper(c, 'other@example.com', ['view']);
    caller = { owner: false, helperEmail: 'helper@example.com' };
    const res = await call(routes(), 'list', '/api/audits');
    expect(
      res
        .json()
        .audits.map((x: any) => x.auditId)
        .sort()
    ).toEqual([a, b].sort());
    caller = { owner: false };
    expect((await call(routes(), 'list', '/api/audits')).json().audits).toEqual([]);
  });

  it('view rows: an edit-only or export-only grant can use the audit (edit and export include view)', async () => {
    const e = await finishedAudit();
    const x = await finishedAudit();
    const v = await finishedAudit();
    await store.grantHelper(e, 'editor@example.com', ['edit']);
    await store.grantHelper(x, 'exporter@example.com', ['export']);
    await store.grantHelper(v, 'viewer@example.com', ['view']);

    caller = { owner: false, helperEmail: 'editor@example.com' };
    expect((await call(routes(), 'list', '/api/audits')).json().audits.map((a: any) => a.auditId)).toEqual([e]);
    expect((await call(routes(), 'get', `/api/audits/${e}`)).statusCode).toBe(200);
    expect((await call(routes(), 'get', `/api/audits/${x}`)).statusCode).toBe(404);

    caller = { owner: false, helperEmail: 'exporter@example.com' };
    expect((await call(routes(), 'list', '/api/audits')).json().audits.map((a: any) => a.auditId)).toEqual([x]);
    expect((await call(routes(), 'get', `/api/audits/${x}`)).statusCode).toBe(200);
    expect((await call(routes(), 'get', `/api/audits/${v}`)).statusCode).toBe(404);

    caller = { owner: false, helperEmail: 'viewer@example.com' };
    expect((await call(routes(), 'get', `/api/audits/${v}`)).statusCode).toBe(200);
  });

  it('mayUseAudit: a view-only grant cannot use an edit row; edit-only and export-only grants can use a view row', async () => {
    const id = await finishedAudit();
    const viewer: AuditCaller = { owner: false, helperEmail: 'viewer@example.com' };
    await store.grantHelper(id, 'viewer@example.com', ['view']);
    expect(await mayUseAudit(store, viewer, id, 'view')).toBe(true);
    expect(await mayUseAudit(store, viewer, id, 'edit')).toBe(false);

    const editor: AuditCaller = { owner: false, helperEmail: 'editor@example.com' };
    await store.grantHelper(id, 'editor@example.com', ['edit']);
    expect(await mayUseAudit(store, editor, id, 'view')).toBe(true);
    expect(await mayUseAudit(store, editor, id, 'edit')).toBe(true);

    const exporter: AuditCaller = { owner: false, helperEmail: 'exporter@example.com' };
    await store.grantHelper(id, 'exporter@example.com', ['export']);
    expect(await mayUseAudit(store, exporter, id, 'view')).toBe(true);
    expect(await mayUseAudit(store, exporter, id, 'export')).toBe(true);
    expect(await mayUseAudit(store, exporter, id, 'edit')).toBe(false);
  });

  it('get: the latest version by default, with result and an empty edit overlay', async () => {
    const id = await finishedAudit();
    const res = await call(routes(), 'get', `/api/audits/${id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version.version).toBe(1);
    expect(body.result.auditId).toBe(id);
    expect(body.edits).toMatchObject({ findings: [], updatedAt: null });
    expect(body.summary.auditId).toBe(id);
  });

  it('get: a version asked for, a running version has no result, saved edits are returned', async () => {
    const id = await finishedAudit();
    await store.addVersion(id);
    await store.writeVersionJson(id, 1, 'edits', {
      findings: [],
      sections: [],
      removedPages: ['/x'],
      recommendations: [],
      proposal: {},
      updatedAt: 't',
    });
    const v1 = (await call(routes(), 'get', `/api/audits/${id}`, '?version=1')).json();
    expect(v1.version.version).toBe(1);
    expect(v1.edits.removedPages).toEqual(['/x']);
    const latest = (await call(routes(), 'get', `/api/audits/${id}`)).json();
    expect(latest.version.version).toBe(2);
    expect(latest.version.status).toBe('running');
    expect(latest.result).toBeNull();
  });

  it('get: unknown audit or version is 404 ERR_AUDIT_NOT_FOUND; malformed version is 400', async () => {
    const id = await finishedAudit();
    const unknown = await call(routes(), 'get', '/api/audits/audit_zzzzz');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('ERR_AUDIT_NOT_FOUND');
    const noVersion = await call(routes(), 'get', `/api/audits/${id}`, '?version=9');
    expect(noVersion.statusCode).toBe(404);
    expect(noVersion.json().code).toBe('ERR_AUDIT_NOT_FOUND');
    for (const bad of ['abc', '0', '-1', '1.5', '', '1e3', '99999999']) {
      const res = await call(routes(), 'get', `/api/audits/${id}`, `?version=${bad}`);
      expect(res.statusCode, bad).toBe(400);
      expect(res.json().code).toBe('ERR_INVALID_REQUEST');
    }
  });

  it('get: a Helper without view gets the same 404 as a missing audit', async () => {
    const id = await finishedAudit();
    caller = { owner: false, helperEmail: 'helper@example.com' };
    expect((await call(routes(), 'get', `/api/audits/${id}`)).statusCode).toBe(404);
    await store.grantHelper(id, 'helper@example.com', ['view']);
    expect((await call(routes(), 'get', `/api/audits/${id}`)).statusCode).toBe(200);
  });

  it('remove: deletes versions, Shortlist, Shared Links and Helper grants, and answers { deleted: true }', async () => {
    const id = await finishedAudit();
    await store.putShortlist(id, { notes: 'call Mr Rao' });
    await store.grantHelper(id, 'helper@example.com', ['view']);
    const link = await store.createShare(id, { version: 1, kind: 'pitch', language: 'en' });
    const res = await call(routes(), 'remove', `/api/audits/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
    expect(await store.getAudit(id)).toBeNull();
    expect(await store.getShortlist(id)).toBeNull();
    expect(await store.getResult(id, 1)).toBeNull();
    expect(await store.grantsFor('helper@example.com')).toEqual([]);
    expect((await store.resolveShare(link.id)).status).toBe('gone');
    expect((await call(routes(), 'get', `/api/audits/${id}`)).statusCode).toBe(404);
    expect((await call(routes(), 'remove', `/api/audits/${id}`)).statusCode).toBe(404);
  });

  it('remove: 409 ERR_AUDIT_RUNNING while a version runs, and nothing is deleted', async () => {
    const v1 = await store.createAudit(REQUEST); // status 'running'
    const res = await call(routes(), 'remove', `/api/audits/${v1.auditId}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ERR_AUDIT_RUNNING');
    expect(await store.getAudit(v1.auditId)).not.toBeNull();
    const finished = await finishedAudit();
    const viaHook = await call(routes({ isRunning: (x) => x === finished }), 'remove', `/api/audits/${finished}`);
    expect(viaHook.statusCode).toBe(409);
  });

  it('remove: a Helper is refused 403 ERR_FORBIDDEN and nothing is deleted', async () => {
    const id = await finishedAudit();
    await store.grantHelper(id, 'helper@example.com', ['view', 'edit', 'export']);
    caller = { owner: false, helperEmail: 'helper@example.com' };
    const res = await call(routes(), 'remove', `/api/audits/${id}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ERR_FORBIDDEN');
    expect(await store.getAudit(id)).not.toBeNull();
  });

  it('refusals carry a fixed message and code, never a path, stack or store detail', async () => {
    const failing = {
      listAudits: async () => {
        throw new Error(`ENOENT: open '${dir}/secret/path' at Object.<anonymous> (file.js:1:1)`);
      },
    } as unknown as AuditStore;
    const rows = auditStoreRoutes({ store: failing, caller: () => OWNER });
    const res = await call(rows, 'list', '/api/audits');
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(dir);
    expect(res.body).not.toMatch(/ENOENT|at Object|\.js:/);
    expect(typeof res.json().error).toBe('string');
  });
});
