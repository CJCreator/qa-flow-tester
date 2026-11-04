/**
 * BE-611: GET /api/audits/:id/content and /file. A real local store in a temp folder and a bare http server
 * that dispatches through resolveRoute.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { AUDIT_API, type AuditRequest } from '@qa/types';
import { createAuditStore, createLocalAuditStoreBackend, pageContentName, type AuditStore } from '@qa/core';
import { resolveRoute, type Route } from '../src/routes/index.js';
import { auditContentRoutes } from '../src/routes/audit-content.js';
import type { AuditCaller } from '../src/routes/audit-store.js';
import { auditDocContents, auditDocResult } from '../../core/tests/helpers/audit-doc-fixture.js';

let dir: string;
let store: AuditStore;
let routes: Route[];
let server: http.Server;
let port: number;
let caller: AuditCaller = { owner: true };
let failRead = false;

const REQUEST: AuditRequest = {
  url: 'https://shop.example.in/',
  limits: { maxPages: 20, maxDepth: 3, includePaths: [], excludePaths: [] },
  language: 'en',
} as unknown as AuditRequest;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json: any;
}

function get(rawPath: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const json = (res.headers['content-type'] ?? '').startsWith('application/json')
          ? JSON.parse(body.toString('utf8'))
          : null;
        resolve({ status: res.statusCode || 0, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function seed(): Promise<{ id: string; pagePath: string }> {
  const v = await store.createAudit(REQUEST);
  const result = { ...auditDocResult(), auditId: v.auditId, version: v.version };
  await store.saveResult(v.auditId, v.version, result);
  const contents = auditDocContents();
  for (const content of contents) {
    await store.writeVersionJson(v.auditId, v.version, pageContentName(content.urlPath), content);
  }
  await store.putVersionFile(v.auditId, v.version, 'screenshots/top.png', PNG);
  await store.updateVersion(v.auditId, v.version, { status: 'done' });
  return { id: v.auditId, pagePath: contents[0].urlPath };
}

const content = (id: string, query: string) => `/api/audits/${id}/content${query}`;
const file = (id: string, query: string) => `/api/audits/${id}/file${query}`;
const q = (p: string, extra = '') => `?path=${encodeURIComponent(p)}${extra}`;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-content-'));
  store = createAuditStore(createLocalAuditStoreBackend(dir));
  routes = auditContentRoutes({ store, caller: () => caller });
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

describe('route rows', () => {
  it('takes method, path and access from AUDIT_API, with no beta policy', () => {
    for (const name of ['content', 'file'] as const) {
      const row = routes.find((r) => r.path === AUDIT_API[name].path) as Route & { method: string; access: string };
      expect(row.method).toBe(AUDIT_API[name].method);
      expect(row.access).toBe(AUDIT_API[name].access);
      expect(row.access).toBe('view');
      expect((row as { beta?: string }).beta).not.toBe('allow');
    }
    expect(routes).toHaveLength(2);
  });
});

describe('GET content', () => {
  it('answers the Page Content to the owner, latest version by default', async () => {
    const { id, pagePath } = await seed();
    caller = { owner: true };
    const res = await get(content(id, q(pagePath)));
    expect(res.status).toBe(200);
    expect(res.json.content.urlPath).toBe(pagePath);
    expect((await get(content(id, q(pagePath, '&version=1')))).status).toBe(200);
  });

  it('answers a Helper with a grant and refuses one without', async () => {
    const { id, pagePath } = await seed();
    await store.grantHelper(id, 'helper@example.com', ['view']);
    caller = { owner: false, helperEmail: 'helper@example.com' };
    expect((await get(content(id, q(pagePath)))).status).toBe(200);
    caller = { owner: false, helperEmail: 'nobody@example.com' };
    const refused = await get(content(id, q(pagePath)));
    expect(refused.status).toBe(404);
    expect(refused.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    caller = { owner: true };
  });

  it('answers 404 for an unknown audit, version or page', async () => {
    const { id, pagePath } = await seed();
    for (const url of [
      content('AbCdEf12_-', q(pagePath)),
      content(id, q(pagePath, '&version=9')),
      content(id, q('/no-such-page')),
    ]) {
      const res = await get(url);
      expect(res.status).toBe(404);
      expect(res.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    }
  });

  it('answers 400 for a missing or invalid path or version', async () => {
    const { id, pagePath } = await seed();
    for (const url of [
      content(id, ''),
      content(id, '?path='),
      content(id, '?path=no-slash'),
      content(id, `?path=${encodeURIComponent('/a\nb')}`),
      content(id, q(pagePath, '&version=0')),
      content(id, q(pagePath, '&version=abc')),
    ]) {
      const res = await get(url);
      expect(res.status, url).toBe(400);
      expect(res.json.code).toBe('ERR_INVALID_REQUEST');
    }
  });
});

describe('GET file', () => {
  it('answers the screenshot bytes with safe headers', async () => {
    const { id } = await seed();
    const res = await get(file(id, q('screenshots/top.png')));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(new Uint8Array(res.body)).toEqual(PNG);
  });

  it('refuses a Helper without a grant', async () => {
    const { id } = await seed();
    caller = { owner: false, helperEmail: 'nobody@example.com' };
    expect((await get(file(id, q('screenshots/top.png')))).status).toBe(404);
    caller = { owner: true };
  });

  it('refuses unsafe paths and never reads outside the version folder', async () => {
    const { id } = await seed();
    for (const p of [
      '/etc/passwd.png',
      '../v1/screenshots/top.png',
      'screenshots/../top.png',
      'screenshots\\top.png',
      'screenshots%2Ftop.png',
      'screenshots/top.json',
      'result.json',
      'screenshots//top.png',
      '',
    ]) {
      const res = await get(file(id, q(p)));
      expect([400, 404], p).toContain(res.status);
    }
    expect((await get(file(id, ''))).status).toBe(400);
    expect((await get(file(id, '?path=screenshots%252Ftop.png'))).status).toBe(400);
  });

  it('answers 404 for a file the version did not record, or an unknown audit or version', async () => {
    const { id } = await seed();
    expect((await get(file(id, q('screenshots/other.png')))).status).toBe(404);
    expect((await get(file(id, q('screenshots/top.png', '&version=7')))).status).toBe(404);
    expect((await get(file('AbCdEf12_-', q('screenshots/top.png')))).status).toBe(404);
    expect((await get(file(id, q('screenshots/top.png', '&version=x')))).status).toBe(400);
  });
});

describe('store failures', () => {
  it('answers 500 with a fixed sentence and no internals', async () => {
    const { id, pagePath } = await seed();
    const original = store.readVersionJson.bind(store);
    store.readVersionJson = (async () => {
      failRead = true;
      throw new Error('ENOENT /secret/disk/path');
    }) as typeof store.readVersionJson;
    try {
      const res = await get(content(id, q(pagePath)));
      expect(failRead).toBe(true);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.json)).not.toContain('secret');
      expect(typeof res.json.error).toBe('string');
    } finally {
      store.readVersionJson = original;
    }
  });
});
