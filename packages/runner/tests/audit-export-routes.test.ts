/**
 * BE-510: GET /api/audits/:id/export, /pitch and /owner. A real local store in a temp folder and a bare http
 * server that dispatches through resolveRoute. The PDF printer is a stub (the real one is QA-500). fetch is a
 * spy: no route may make an outbound call (REQ-019 AC-4).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { AUDIT_API, EXPORT_CONTENT_TYPES, type AuditRequest } from '@qa/types';
import { createAuditStore, createLocalAuditStoreBackend, pageContentName, type AuditStore } from '@qa/core';
import { resolveRoute, type Route } from '../src/routes/index.js';
import { auditExportRoutes } from '../src/routes/audit-export.js';
import { auditSettingsStoreOn } from '../src/routes/audit-settings.js';
import { auditDocContents, auditDocResult } from '../../core/tests/helpers/audit-doc-fixture.js';

let dir: string;
let store: AuditStore;
let routes: Route[];
let server: http.Server;
let port: number;
const printed: string[] = [];
const fetchSpy = vi.fn();

const REQUEST: AuditRequest = {
  url: 'https://shop.example.in/',
  limits: { maxPages: 20, maxDepth: 3, includePaths: [], excludePaths: [] },
  language: 'en',
} as unknown as AuditRequest;

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
  json: any;
}

function get(rawPath: string, atPort: number = port): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: atPort, path: rawPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const text = body.toString('utf8');
        let json: any = null;
        if ((res.headers['content-type'] ?? '').startsWith('application/json')) json = JSON.parse(text);
        resolve({ status: res.statusCode || 0, headers: res.headers, body, text, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function seedDone(): Promise<string> {
  const v = await store.createAudit(REQUEST);
  const result = { ...auditDocResult(), auditId: v.auditId, version: v.version };
  await store.saveResult(v.auditId, v.version, result);
  for (const content of auditDocContents()) {
    await store.writeVersionJson(v.auditId, v.version, pageContentName(content.urlPath), content);
  }
  await store.updateVersion(v.auditId, v.version, { status: 'done' });
  return v.auditId;
}

const exportPath = (id: string, query = '') => `/api/audits/${id}/export${query}`;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy);
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'));
  const backend = createLocalAuditStoreBackend(dir);
  store = createAuditStore(backend);
  routes = auditExportRoutes({
    store,
    settings: auditSettingsStoreOn(backend),
    exportOptions: {
      renderPdf: async (html: string) => {
        printed.push(html);
        return Buffer.from('%PDF-1.4 stub');
      },
    },
  });
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
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('route rows', () => {
  it('declares export access on export, pitch and owner', () => {
    for (const name of ['export', 'pitch', 'owner'] as const) {
      const row = routes.find((r) => r.path === AUDIT_API[name].path);
      expect(row?.method).toBe('GET');
      expect(row?.access).toBe('export');
    }
    expect(routes).toHaveLength(3);
  });
});

describe('GET export', () => {
  it('returns the bundle as a zip with the five documents, site.json and README.md', async () => {
    const id = await seedDone();
    const res = await get(exportPath(id, '?format=bundle'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(EXPORT_CONTENT_TYPES.bundle);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.zip"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
    const names = res.body.toString('latin1');
    for (const n of [
      '01-structure.md',
      '02-content.md',
      '03-findings.md',
      '04-improvement-roadmap.md',
      '05-proposal.md',
      'site.json',
      'README.md',
    ]) {
      expect(names).toContain(n);
    }
  });

  it.each([
    ['md', 'text/markdown'],
    ['html', 'text/html'],
    ['pdf', 'application/pdf'],
    ['docx', 'wordprocessingml'],
  ])('sends %s with its content type and an attachment name', async (format, type) => {
    const id = await seedDone();
    const res = await get(exportPath(id, `?format=${format}`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(EXPORT_CONTENT_TYPES[format as 'md']);
    expect(res.headers['content-type']).toContain(type);
    expect(res.headers['content-disposition']).toMatch(
      new RegExp(`^attachment; filename="[A-Za-z0-9._-]+\\.${format}"$`)
    );
    expect(res.headers['cache-control']).toBe('no-store');
    if (format === 'docx') expect(res.body.subarray(0, 2).toString()).toBe('PK');
  });

  it('prints the same documents to PDF as it writes to HTML', async () => {
    const id = await seedDone();
    printed.length = 0;
    const html = await get(exportPath(id, '?format=html&documents=findings'));
    await get(exportPath(id, '?format=pdf&documents=findings'));
    expect(printed).toHaveLength(1);
    expect(printed[0]).toBe(html.text);
  });

  it('selects documents and names a single one after it', async () => {
    const id = await seedDone();
    const one = await get(exportPath(id, '?format=md&documents=findings'));
    expect(one.headers['content-disposition']).toContain('-findings.md');
    const two = await get(exportPath(id, '?format=md&documents=roadmap,structure'));
    expect(two.headers['content-disposition']).toContain('-audit.md');
  });

  it('carries saved edits in every format', async () => {
    const id = await seedDone();
    const result = await store.getResult(id, 1);
    const findingId = result!.findings[0].id;
    await store.writeVersionJson(id, 1, 'edits', {
      findings: [{ findingId, title: 'My own edited title', editedAt: '2026-01-01T00:00:00.000Z' }],
      sections: [],
      recommendations: [],
      removedPages: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const md = await get(exportPath(id, '?format=md&documents=findings'));
    expect(md.text).toContain('My own edited title');
    const html = await get(exportPath(id, '?format=html&documents=findings'));
    expect(html.text).toContain('My own edited title');
    const owner = await get(`/api/audits/${id}/owner?format=md`);
    expect(owner.text).toContain('My own edited title');
  });

  it('a single document export ignores the stored copy once the version has edits', async () => {
    const id = await seedDone();
    await store.saveAuditDocument(id, 1, 'content', 'markdown', 'STALE COPY');
    await store.writeVersionJson(id, 1, 'edits', {
      findings: [],
      sections: [{ urlPath: '/', sectionId: 's1', text: 'My own edited section text', by: 'person', editedAt: '2026-01-01T00:00:00.000Z' }],
      recommendations: [],
      removedPages: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const md = await get(exportPath(id, '?format=md&documents=content'));
    expect(md.text).not.toContain('STALE COPY');
    expect(md.text).toContain('My own edited section text');
  });

  it('the Proposal is never served from the stored copy', async () => {
    const id = await seedDone();
    await store.saveAuditDocument(id, 1, 'proposal', 'markdown', 'STALE COPY');
    const md = await get(exportPath(id, '?format=md&documents=proposal'));
    expect(md.text).not.toContain('STALE COPY');
  });

  it('writes the document in the requested language, defaulting to the version language', async () => {
    const id = await seedDone();
    const en = await get(exportPath(id, '?format=html&documents=findings'));
    const enExplicit = await get(exportPath(id, '?format=html&documents=findings&language=en'));
    const ta = await get(exportPath(id, '?format=html&documents=findings&language=ta'));
    expect(enExplicit.text).toBe(en.text);
    expect(ta.text).not.toBe(en.text);
    expect(ta.text).toContain('lang="ta"');
  });

  it('refuses invalid format, documents, language and version with 400', async () => {
    const id = await seedDone();
    for (const q of [
      '',
      '?format=exe',
      '?format=md&documents=structure,secrets',
      '?format=md&documents=',
      '?format=md&language=xx',
      '?format=md&version=0',
      '?format=md&version=abc',
      '?format=md&version=1.5',
    ]) {
      const res = await get(exportPath(id, q));
      expect(res.status, q).toBe(400);
      expect(res.json.code).toBe('ERR_INVALID_REQUEST');
    }
  });

  it('answers 409 for a running version and 404 for an unknown audit or version', async () => {
    const running = await store.createAudit(REQUEST);
    const r = await get(exportPath(running.auditId, '?format=md'));
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('ERR_AUDIT_RUNNING');

    const unknown = await get(exportPath('Unknown_audit_id_1', '?format=md'));
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('ERR_AUDIT_NOT_FOUND');

    const id = await seedDone();
    const noVersion = await get(exportPath(id, '?format=md&version=9'));
    expect(noVersion.status).toBe(404);
    expect(noVersion.json.code).toBe('ERR_AUDIT_NOT_FOUND');
  });
});

describe('GET pitch', () => {
  it('sends the Pitch Glimpse as html by default and as pdf on request', async () => {
    const id = await seedDone();
    const html = await get(`/api/audits/${id}/pitch`);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toBe(EXPORT_CONTENT_TYPES.html);
    expect(html.headers['content-disposition']).toMatch(/^attachment; filename="[A-Za-z0-9._-]*pitch-glimpse\.html"$/);
    expect(html.headers['cache-control']).toBe('no-store');
    const pdf = await get(`/api/audits/${id}/pitch?format=pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('pitch-glimpse.pdf');
  });

  it('the Pitch Glimpse html is always built on request', async () => {
    const id = await seedDone();
    await store.saveAuditDocument(id, 1, 'pitch-glimpse', 'html', 'STALE COPY');
    const html = await get(`/api/audits/${id}/pitch?format=html`);
    expect(html.text).not.toContain('STALE COPY');
  });

  it('is produced in ta or en', async () => {
    const id = await seedDone();
    const ta = await get(`/api/audits/${id}/pitch?language=ta`);
    const en = await get(`/api/audits/${id}/pitch?language=en`);
    expect(ta.text).toContain('lang="ta"');
    expect(en.text).toContain('lang="en"');
    expect(ta.text).not.toBe(en.text);
  });

  it('embeds a stored screenshot of a top finding', async () => {
    const id = await seedDone();
    const result = await store.getResult(id, 1);
    const withShot = {
      ...result!,
      findings: result!.findings.map((f, i) => (i === 0 ? { ...f, screenshotPath: 'screenshots/top.png' } : f)),
    };
    await store.saveResult(id, 1, withShot);
    await store.putVersionFile(id, 1, 'screenshots/top.png', Buffer.from('fakepng'));
    const res = await get(`/api/audits/${id}/pitch`);
    expect(res.text).toContain('data:image/png;base64,');
  });

  it('refuses bad query values and a running version', async () => {
    const id = await seedDone();
    expect((await get(`/api/audits/${id}/pitch?format=docx`)).status).toBe(400);
    expect((await get(`/api/audits/${id}/pitch?language=zz`)).status).toBe(400);
    expect((await get(`/api/audits/${id}/pitch?version=x`)).status).toBe(400);
    const running = await store.createAudit(REQUEST);
    expect((await get(`/api/audits/${running.auditId}/pitch`)).status).toBe(409);
  });
});

describe('GET owner', () => {
  it('sends the Owner Audit as markdown by default and in each document format', async () => {
    const id = await seedDone();
    const md = await get(`/api/audits/${id}/owner`);
    expect(md.status).toBe(200);
    expect(md.headers['content-type']).toBe(EXPORT_CONTENT_TYPES.md);
    expect(md.headers['content-disposition']).toMatch(/owner-audit\.md"$/);
    for (const format of ['html', 'pdf', 'docx'] as const) {
      const res = await get(`/api/audits/${id}/owner?format=${format}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(EXPORT_CONTENT_TYPES[format]);
    }
  });

  it('is produced in ta or en', async () => {
    const id = await seedDone();
    const ta = await get(`/api/audits/${id}/owner?format=html&language=ta`);
    const en = await get(`/api/audits/${id}/owner?format=html&language=en`);
    expect(ta.text).toContain('lang="ta"');
    expect(ta.text).not.toBe(en.text);
  });

  it('refuses the bundle format, bad language and unknown audits', async () => {
    const id = await seedDone();
    expect((await get(`/api/audits/${id}/owner?format=bundle`)).status).toBe(400);
    expect((await get(`/api/audits/${id}/owner?language=zz`)).status).toBe(400);
    expect((await get(`/api/audits/Unknown_audit_id_1/owner`)).status).toBe(404);
    const running = await store.createAudit(REQUEST);
    const res = await get(`/api/audits/${running.auditId}/owner`);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('ERR_AUDIT_RUNNING');
  });

  it('keeps the company details out of the Owner Audit', async () => {
    const id = await seedDone();
    await store.backend.putJson('settings/audit-settings.json', {
      company: { name: 'Zeta Agency Pvt', email: 'sales@zeta.example' },
    });
    const res = await get(`/api/audits/${id}/owner?format=md`);
    expect(res.text).not.toContain('Zeta Agency Pvt');
    expect(res.text).not.toContain('sales@zeta.example');
  });
});

describe('PDF concurrency limit', () => {
  const servers: http.Server[] = [];
  afterAll(async () => {
    for (const s of servers) await new Promise((r) => s.close(r));
  });

  async function serve(renderPdf: (html: string) => Promise<Buffer>, maxConcurrentPdf?: number): Promise<number> {
    const limited = auditExportRoutes({
      store,
      settings: auditSettingsStoreOn(store.backend),
      exportOptions: { renderPdf },
      ...(maxConcurrentPdf ? { maxConcurrentPdf } : {}),
    });
    const s = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const match = resolveRoute(limited, req.method || 'GET', url.pathname);
      if (!match) return void res.writeHead(404).end();
      void match.route.handle({ server: undefined as never, req, res, url, params: match.params });
    });
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return (s.address() as { port: number }).port;
  }

  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(ok()).toBe(true);
  };

  it('answers a third concurrent PDF with 503 and Retry-After, then serves again once one finishes', async () => {
    let started = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const p = await serve(async () => {
      started += 1;
      await gate;
      return Buffer.from('%PDF-1.4 stub');
    });
    const id = await seedDone();
    const first = get(exportPath(id, '?format=pdf'), p);
    const second = get(`/api/audits/${id}/pitch?format=pdf`, p);
    await until(() => started === 2);

    const third = await get(`/api/audits/${id}/owner?format=pdf`, p);
    expect(third.status).toBe(503);
    expect(third.headers['retry-after']).toMatch(/^[1-9][0-9]*$/);
    expect(third.json).toEqual({
      error: 'Another PDF is being made. Try again in a moment.',
      code: 'ERR_RUN_IN_PROGRESS',
    });
    expect(started).toBe(2);

    open();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await get(exportPath(id, '?format=pdf'), p)).status).toBe(200);
  });

  it('does not limit other formats while two PDFs render', async () => {
    let started = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const p = await serve(async () => {
      started += 1;
      await gate;
      return Buffer.from('%PDF-1.4 stub');
    });
    const id = await seedDone();
    const pdfs = [get(exportPath(id, '?format=pdf'), p), get(`/api/audits/${id}/owner?format=pdf`, p)];
    await until(() => started === 2);

    for (const q of ['?format=md', '?format=html', '?format=docx', '?format=bundle']) {
      expect((await get(exportPath(id, q), p)).status, q).toBe(200);
    }
    expect((await get(`/api/audits/${id}/pitch`, p)).status).toBe(200);
    expect((await get(`/api/audits/${id}/owner`, p)).status).toBe(200);

    open();
    for (const r of await Promise.all(pdfs)) expect(r.status).toBe(200);
  });

  it('releases the slot after a render error', async () => {
    let calls = 0;
    const p = await serve(async () => {
      calls += 1;
      if (calls === 1) throw new Error('chromium crashed at /secret/path');
      return Buffer.from('%PDF-1.4 stub');
    }, 1);
    const id = await seedDone();
    const failed = await get(exportPath(id, '?format=pdf'), p);
    expect(failed.status).toBe(500);
    expect(failed.text).not.toContain('/secret/path');
    expect((await get(exportPath(id, '?format=pdf'), p)).status).toBe(200);
    expect(calls).toBe(2);
  });
});

describe('no outbound call', () => {
  it('makes no fetch call across all three routes', async () => {
    const id = await seedDone();
    await get(exportPath(id, '?format=bundle'));
    await get(`/api/audits/${id}/pitch?language=ta`);
    await get(`/api/audits/${id}/owner?format=docx`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
