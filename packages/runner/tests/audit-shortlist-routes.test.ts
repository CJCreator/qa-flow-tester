/**
 * BE-602 (REQ-023): the Shortlist rows (getShortlist, putShortlist, listShortlist), called with a mock
 * request and response against a real store on a temp folder.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, matchAuditPath, SHORTLIST_OUTCOMES } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend } from '@qa/core';
import { auditShortlistRoutes } from '../src/routes/audit-shortlist.js';
import type { AuditCaller } from '../src/routes/audit-store.js';
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

const REQUEST = {
  url: 'https://example.com/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en' as const,
};

let dir: string;
let store: AuditStore;
let caller: AuditCaller;
let rows: Route[];

type Key = 'getShortlist' | 'putShortlist' | 'listShortlist';

async function call(key: Key, pathname: string, opts: { search?: string; body?: unknown; raw?: string } = {}) {
  const { method, path: pattern } = AUDIT_API[key];
  const row = rows.find((r) => r.method === method && r.path === pattern)!;
  const params = (matchAuditPath(pattern, pathname) ?? {}) as Record<string, string>;
  const payload = opts.raw ?? (opts.body === undefined ? '' : JSON.stringify(opts.body));
  const req = Object.assign(Readable.from(payload ? [payload] : []), { method, headers: {} }) as unknown as http.IncomingMessage;
  const res = new MockResponse();
  await row.handle({
    server: undefined as never,
    req,
    res: res as unknown as http.ServerResponse,
    url: new URL(`http://localhost${pathname}${opts.search ?? ''}`),
    params,
  });
  return res;
}

const shortlistPath = (id: string) => `/api/audits/${id}/shortlist`;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-shortlist-routes-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir));
  caller = { owner: true };
  rows = auditShortlistRoutes({ store, caller: () => caller });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Shortlist rows', () => {
  it('each row equals its AUDIT_API entry: method, path, access', () => {
    expect(rows).toHaveLength(3);
    for (const key of ['getShortlist', 'putShortlist', 'listShortlist'] as const) {
      const entry = AUDIT_API[key];
      const matches = rows.filter((r) => r.method === entry.method && r.path === entry.path);
      expect(matches).toHaveLength(1);
      expect(matches[0].access).toBe(entry.access);
    }
  });

  it('put saves mark, notes, outcome and outcome note and returns the entry; get returns it', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const put = await call('putShortlist', shortlistPath(auditId), {
      body: { mark: 'pitch', notes: 'Owner is Mr Rao', outcome: 'Meeting set', outcomeNote: 'Tuesday 4pm' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().entry).toMatchObject({
      auditId,
      mark: 'pitch',
      notes: 'Owner is Mr Rao',
      outcome: 'Meeting set',
      outcomeNote: 'Tuesday 4pm',
    });
    const get = await call('getShortlist', shortlistPath(auditId));
    expect(get.statusCode).toBe(200);
    expect(get.json().entry).toEqual(put.json().entry);
  });

  it('put changes only the fields sent; null clears a mark or outcome', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    await call('putShortlist', shortlistPath(auditId), { body: { mark: 'skip', notes: 'n', outcome: 'Won' } });
    const res = await call('putShortlist', shortlistPath(auditId), { body: { mark: null, outcome: null } });
    expect(res.json().entry).toMatchObject({ mark: null, outcome: null, notes: 'n' });
  });

  it('get on an audit with no entry reads as an empty entry; unknown audit is 404', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const empty = await call('getShortlist', shortlistPath(auditId));
    expect(empty.statusCode).toBe(200);
    expect(empty.json().entry).toMatchObject({ auditId, mark: null, notes: '', outcome: null, outcomeNote: '' });
    for (const key of ['getShortlist', 'putShortlist'] as const) {
      const res = await call(key, shortlistPath('audit_zzzzz'), { body: { mark: 'pitch' } });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('ERR_AUDIT_NOT_FOUND');
    }
  });

  it('put refuses invalid values with 400 ERR_INVALID_REQUEST and a message naming the field', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    const cases: Array<[unknown, RegExp]> = [
      [{ mark: 'maybe' }, /mark/],
      [{ outcome: 'Ghosted' }, /outcome/],
      [{ notes: 5 }, /notes/],
      [{ notes: 'x'.repeat(4001) }, /notes/],
      [{ outcomeNote: 'y'.repeat(1001) }, /outcome note/],
    ];
    for (const [body, field] of cases) {
      const res = await call('putShortlist', shortlistPath(auditId), { body });
      expect(res.statusCode, JSON.stringify(body).slice(0, 30)).toBe(400);
      expect(res.json().code).toBe('ERR_INVALID_REQUEST');
      expect(res.json().error).toMatch(field);
    }
    for (const raw of ['not json', '[1]', 'null', '"s"']) {
      const res = await call('putShortlist', shortlistPath(auditId), { raw });
      expect(res.statusCode, raw).toBe(400);
      expect(res.json().code).toBe('ERR_INVALID_REQUEST');
    }
    expect((await store.getShortlist(auditId))).toBeNull();
  });

  it('put accepts every outcome on the fixed list', async () => {
    const { auditId } = await store.createAudit(REQUEST);
    for (const outcome of SHORTLIST_OUTCOMES) {
      const res = await call('putShortlist', shortlistPath(auditId), { body: { outcome } });
      expect(res.statusCode).toBe(200);
      expect(res.json().entry.outcome).toBe(outcome);
    }
  });

  it('list filters by mark and outcome, and refuses invalid filters with 400', async () => {
    const a = (await store.createAudit(REQUEST)).auditId;
    const b = (await store.createAudit(REQUEST)).auditId;
    const c = (await store.createAudit(REQUEST)).auditId;
    await store.putShortlist(a, { mark: 'pitch', outcome: 'Won' });
    await store.putShortlist(b, { mark: 'pitch', outcome: 'Lost' });
    await store.putShortlist(c, { mark: 'skip', outcome: 'Won' });
    const ids = async (search: string) =>
      (await call('listShortlist', '/api/shortlist', { search })).json().entries.map((e: any) => e.auditId).sort();
    expect(await ids('')).toEqual([a, b, c].sort());
    expect(await ids('?mark=pitch')).toEqual([a, b].sort());
    expect(await ids('?outcome=Won')).toEqual([a, c].sort());
    expect(await ids('?mark=pitch&outcome=Won')).toEqual([a]);
    const sample = (await call('listShortlist', '/api/shortlist', { search: '?mark=skip' })).json().entries[0];
    expect(sample).toMatchObject({ auditId: c, url: 'https://example.com/', host: 'example.com' });
    for (const search of ['?mark=maybe', '?outcome=Ghosted']) {
      const res = await call('listShortlist', '/api/shortlist', { search });
      expect(res.statusCode, search).toBe(400);
      expect(res.json().code).toBe('ERR_INVALID_REQUEST');
    }
  });

  it('Helper: view reads and lists only granted audits; put needs edit', async () => {
    const a = (await store.createAudit(REQUEST)).auditId;
    const b = (await store.createAudit(REQUEST)).auditId;
    await store.putShortlist(a, { mark: 'pitch' });
    await store.putShortlist(b, { mark: 'pitch' });
    await store.grantHelper(a, 'helper@example.com', ['view']);
    caller = { owner: false, helperEmail: 'helper@example.com' };
    expect((await call('getShortlist', shortlistPath(a))).statusCode).toBe(200);
    expect((await call('getShortlist', shortlistPath(b))).statusCode).toBe(404);
    const list = await call('listShortlist', '/api/shortlist');
    expect(list.json().entries.map((e: any) => e.auditId)).toEqual([a]);

    const denied = await call('putShortlist', shortlistPath(a), { body: { mark: 'skip' } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('ERR_FORBIDDEN');
    expect((await call('putShortlist', shortlistPath(b), { body: { mark: 'skip' } })).statusCode).toBe(404);
    expect((await store.getShortlist(a))?.mark).toBe('pitch');

    await store.grantHelper(a, 'helper@example.com', ['view', 'edit']);
    const ok = await call('putShortlist', shortlistPath(a), { body: { mark: 'skip' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().entry.mark).toBe('skip');
  });

  it('Helper permissions: an edit-only grant reads and saves; an export-only grant reads but cannot save; a view-only grant cannot save', async () => {
    const a = (await store.createAudit(REQUEST)).auditId;
    await store.putShortlist(a, { mark: 'pitch' });
    caller = { owner: false, helperEmail: 'editor@example.com' };
    await store.grantHelper(a, 'editor@example.com', ['edit']);
    expect((await call('getShortlist', shortlistPath(a))).statusCode).toBe(200);
    expect((await call('listShortlist', '/api/shortlist')).json().entries.map((e: any) => e.auditId)).toEqual([a]);
    const saved = await call('putShortlist', shortlistPath(a), { body: { mark: 'skip' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().entry.mark).toBe('skip');

    caller = { owner: false, helperEmail: 'exporter@example.com' };
    await store.grantHelper(a, 'exporter@example.com', ['export']);
    expect((await call('getShortlist', shortlistPath(a))).statusCode).toBe(200);
    const exporterPut = await call('putShortlist', shortlistPath(a), { body: { mark: 'pitch' } });
    expect(exporterPut.statusCode).toBe(403);
    expect(exporterPut.json().code).toBe('ERR_FORBIDDEN');

    caller = { owner: false, helperEmail: 'viewer@example.com' };
    await store.grantHelper(a, 'viewer@example.com', ['view']);
    const viewerPut = await call('putShortlist', shortlistPath(a), { body: { mark: 'pitch' } });
    expect(viewerPut.statusCode).toBe(403);
    expect(viewerPut.json().code).toBe('ERR_FORBIDDEN');
    expect((await store.getShortlist(a))?.mark).toBe('skip');
  });

  it('a store failure answers a fixed sentence with no path or stack', async () => {
    const failing = {
      readAuditRecord: async () => {
        throw new Error(`EACCES ${dir}/x at Object.<anonymous> (store.js:2:3)`);
      },
    } as unknown as AuditStore;
    rows = auditShortlistRoutes({ store: failing, caller: () => caller });
    const res = await call('getShortlist', shortlistPath('audit_12345'));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(dir);
    expect(res.body).not.toMatch(/EACCES|at Object|\.js:/);
  });
});
