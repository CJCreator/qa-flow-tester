/**
 * REQ-020 (BE-509): GET and PATCH /api/audits/:id/edits. A real local store in a temp folder and a bare
 * http server that dispatches through resolveRoute, so path rules and handlers run as in the runner.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { AUDIT_API, type AuditRequest } from '@qa/types';
import { createAuditStore, createLocalAuditStoreBackend, pageContentName, type AuditStore } from '@qa/core';
import { resolveRoute, type Route } from '../src/routes/index.js';
import { auditEditsRoutes, updateEditsOverlay } from '../src/routes/audit-documents.js';
import { auditDocContents, auditDocResult, PATHS } from '../../core/tests/helpers/audit-doc-fixture.js';

let dir: string;
let store: AuditStore;
let routes: Route[];
let server: http.Server;
let port: number;

const REQUEST: AuditRequest = {
  url: 'https://shop.example.in/',
  limits: { maxPages: 20, maxDepth: 3, includePaths: [], excludePaths: [] },
  language: 'en',
} as unknown as AuditRequest;

interface Answer {
  status: number;
  json: any;
}

function call(method: string, rawPath: string, body?: unknown): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, json: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/** A finished version 1 with the fixture's result and Page Content. */
async function seedDone(): Promise<{ id: string; resultBefore: string }> {
  const v = await store.createAudit(REQUEST);
  const result = { ...auditDocResult(), auditId: v.auditId, version: v.version };
  await store.saveResult(v.auditId, v.version, result);
  for (const content of auditDocContents()) {
    await store.writeVersionJson(v.auditId, v.version, pageContentName(content.urlPath), content);
  }
  await store.updateVersion(v.auditId, v.version, { status: 'done' });
  return { id: v.auditId, resultBefore: JSON.stringify(await store.getResult(v.auditId, v.version)) };
}

const editsPath = (id: string, query = '') => `/api/audits/${id}/edits${query}`;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-edits-'));
  store = createAuditStore(createLocalAuditStoreBackend(dir));
  routes = auditEditsRoutes({ store });
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const match = resolveRoute(routes, req.method || 'GET', url.pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"Not found"}');
      return;
    }
    void match.route.handle({ server: undefined as never, req, res, url, params: match.params });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('edits route rows', () => {
  it('declares view for getEdits and edit for patchEdits', () => {
    const get = routes.find((r) => r.method === 'GET');
    const patch = routes.find((r) => r.method === 'PATCH');
    expect(get?.path).toBe(AUDIT_API.getEdits.path);
    expect(get?.access).toBe('view');
    expect(patch?.path).toBe(AUDIT_API.patchEdits.path);
    expect(patch?.access).toBe('edit');
  });
});

describe('GET and PATCH /api/audits/:id/edits', () => {
  it('returns an empty overlay before any edit', async () => {
    const { id } = await seedDone();
    const res = await call('GET', editsPath(id));
    expect(res.status).toBe(200);
    expect(res.json.edits).toMatchObject({ findings: [], sections: [], removedPages: [], updatedAt: null });
  });

  it('saves finding text in the overlay and leaves the stored result untouched', async () => {
    const { id, resultBefore } = await seedDone();
    const result = await store.getResult(id, 1);
    const findingId = result!.findings[0].id;
    const patched = await call('PATCH', editsPath(id), { findings: [{ findingId, title: 'My own title' }] });
    expect(patched.status).toBe(200);
    expect(patched.json.edits.findings[0]).toMatchObject({ findingId, title: 'My own title' });

    const read = await call('GET', editsPath(id));
    expect(read.json.edits.findings[0].title).toBe('My own title');
    expect(JSON.stringify(await store.getResult(id, 1))).toBe(resultBefore);
    expect((await store.getVersion(id, 1))?.edited).toBe(true);
  });

  it('lists a removed page and brings it back with restorePages', async () => {
    const { id } = await seedDone();
    const removed = await call('PATCH', editsPath(id), { removePages: [PATHS.team] });
    expect(removed.json.edits.removedPages).toEqual([PATHS.team]);
    expect((await call('GET', editsPath(id))).json.edits.removedPages).toEqual([PATHS.team]);
    const restored = await call('PATCH', editsPath(id), { restorePages: [PATHS.team] });
    expect(restored.json.edits.removedPages).toEqual([]);
  });

  it('keeps both changes when a PATCH and updateEditsOverlay run at the same moment', async () => {
    const { id } = await seedDone();
    const findingId = (await store.getResult(id, 1))!.findings[0].id;
    // The slow mutate holds its read of the overlay while the PATCH arrives: an unqueued
    // read-modify-write would save its stale copy over the PATCH.
    const accepted = updateEditsOverlay(store, id, 1, async (current) => {
      await new Promise((r) => setTimeout(r, 250));
      return { ...current, removedPages: [...current.removedPages, PATHS.team] };
    });
    const patched = call('PATCH', editsPath(id), { findings: [{ findingId, title: 'Patched title' }] });
    const [, patchRes] = await Promise.all([accepted, patched]);
    expect(patchRes.status).toBe(200);

    const read = await call('GET', editsPath(id));
    expect(read.json.edits.removedPages).toEqual([PATHS.team]);
    expect(read.json.edits.findings[0]).toMatchObject({ findingId, title: 'Patched title' });
    expect((await store.getVersion(id, 1))?.edited).toBe(true);
  });

  it('saves a Section edit that names a real Section', async () => {
    const { id } = await seedDone();
    const res = await call('PATCH', editsPath(id), { sections: [{ urlPath: PATHS.home, sectionId: 's2', text: 'New copy.' }] });
    expect(res.status).toBe(200);
    expect(res.json.edits.sections[0]).toMatchObject({ urlPath: PATHS.home, sectionId: 's2', text: 'New copy.' });
  });

  it('refuses a running version with 409 and stores nothing', async () => {
    const v = await store.createAudit(REQUEST);
    const res = await call('PATCH', editsPath(v.auditId), { removePages: ['/'] });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('ERR_AUDIT_RUNNING');
    expect(await store.readVersionJson(v.auditId, 1, 'edits')).toBeNull();
  });

  it('answers 404 for an unknown audit or version, and no match for a bad id', async () => {
    const unknown = await call('PATCH', editsPath('Unknown_audit_id_1'), { removePages: [] });
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    const { id } = await seedDone();
    const noVersion = await call('PATCH', editsPath(id, '?version=9'), { removePages: [] });
    expect(noVersion.status).toBe(404);
    expect(noVersion.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    const badId = await call('PATCH', '/api/audits/bad%20id/edits', { removePages: [] });
    expect(badId.status).toBe(404);
    expect(badId.json.code).toBeUndefined();
    expect((await call('GET', editsPath(id, '?version=abc'))).status).toBe(400);
  });

  it('refuses unknown findings, pages and Sections with 400 and stores nothing', async () => {
    const { id } = await seedDone();
    const bodies = [
      { findings: [{ findingId: 'AF-999', title: 'x' }] },
      { removePages: ['/not-a-page'] },
      { restorePages: ['/not-a-page'] },
      { sections: [{ urlPath: PATHS.home, sectionId: 's99', text: 'x' }] },
      { sections: [{ urlPath: '/not-a-page', sectionId: 's1', text: 'x' }] },
      { removePages: [PATHS.home] },
      { removePages: 'nope' },
    ];
    for (const body of bodies) {
      const res = await call('PATCH', editsPath(id), body);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('ERR_INVALID_REQUEST');
    }
    expect((await call('PATCH', editsPath(id), '{not json')).status).toBe(400);
    expect(await store.readVersionJson(id, 1, 'edits')).toBeNull();
    expect((await store.getVersion(id, 1))?.edited).toBeUndefined();
  });
});
