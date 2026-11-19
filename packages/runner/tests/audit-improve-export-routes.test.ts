/**
 * T-415: the Improved version in the download rows. Variants are made by the real makeVariants on a mock AI
 * Provider; thumbnails and the axe scan are stand-ins, so no Chromium starts (unit tier).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, matchAuditPath } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend, pageContentName, resolveAuditAi, type AIProvider } from '@qa/core';
import { auditDocContents, auditDocResult } from '../../core/tests/helpers/audit-doc-fixture.js';
import { auditImproveRoutes } from '../src/routes/audit-improve.js';
import { auditExportRoutes } from '../src/routes/audit-export.js';
import { auditSettingsStoreOn } from '../src/routes/audit-settings.js';
import type { Route } from '../src/routes/route.js';

const NOW = new Date('2026-11-19T10:00:00.000Z');
// A tiny JPEG stands for every thumbnail.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

class MockResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...(headers ?? {}) };
  }
  end(chunk?: string | Buffer) {
    if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  get body(): Buffer {
    return Buffer.concat(this.chunks);
  }
  json(): any {
    return JSON.parse(this.body.toString('utf8'));
  }
}

let dir: string;
let store: AuditStore;
let auditId: string;
let thumbnailCalls: number;

const provider: AIProvider = {
  providerType: 'mock',
  async generateText() {
    return `<nav><a href="/about">About</a><a href="/services">Services</a></nav><h1 data-section="s1">Fresh</h1>`;
  },
};

async function call(rows: Route[], key: keyof typeof AUDIT_API, pathname: string, body?: string, search = '') {
  const { method, path: pattern } = AUDIT_API[key];
  const row = rows.find((r) => r.method === method && r.path === pattern)!;
  const params = (matchAuditPath(pattern, pathname) ?? {}) as Record<string, string>;
  const req = Readable.from(body === undefined ? [] : [body]) as unknown as http.IncomingMessage;
  Object.assign(req, { method, headers: { 'content-type': 'application/json' } });
  const res = new MockResponse();
  await row.handle({
    server: undefined as never,
    req,
    res: res as unknown as http.ServerResponse,
    url: new URL(`http://localhost${pathname}${search}`),
    params,
  });
  return res;
}

function unzipNames(bytes: Buffer): string[] {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(eocd + 10);
  let pos = bytes.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = bytes.readUInt16LE(pos + 28);
    names.push(bytes.toString('utf8', pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + bytes.readUInt16LE(pos + 30) + bytes.readUInt16LE(pos + 32);
  }
  return names;
}

function exportRows(): Route[] {
  return auditExportRoutes({
    store,
    settings: auditSettingsStoreOn(store.backend),
    renderThumbnails: async (pages) => {
      thumbnailCalls += pages.length;
      return pages.map(() => JPEG);
    },
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-improve-export-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir));
  thumbnailCalls = 0;
  const v1 = await store.createAudit({
    url: 'https://shop.example.in/',
    limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
    language: 'en',
  });
  auditId = v1.auditId;
  await store.saveResult(auditId, 1, { ...auditDocResult(), auditId, version: 1 });
  for (const c of auditDocContents()) await store.writeVersionJson(auditId, 1, pageContentName(c.urlPath), c);
  await store.updateVersion(auditId, 1, { status: 'done', finishedAt: NOW.toISOString() });
  const improve = auditImproveRoutes({
    store,
    caller: () => ({ owner: true }),
    resolveAi: () =>
      resolveAuditAi({
        setup: { provider: 'mock' },
        keys: { resolveKey: async () => ({ provider: 'mock', apiKey: 'mock-key', source: 'keychain' }) },
        createProvider: () => provider,
      }),
    scanAxe: async () => ({ blockers: 0 }),
    fetchImage: async () => null,
    now: () => NOW,
  });
  const made = await call(
    improve,
    'createImprove',
    `/api/audits/${auditId}/improve`,
    JSON.stringify({ pages: ['home', 'p-services'], variants: 2 })
  );
  expect(made.statusCode, made.body.toString()).toBe(200);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Improved version downloads (T-415)', () => {
  it('rows equal AUDIT_API', () => {
    const rows = exportRows();
    for (const key of ['exportImproved', 'setImproveBest'] as const) {
      const e = AUDIT_API[key];
      expect(rows.find((r) => r.method === e.method && r.path === e.path)?.access, key).toBe(e.access);
    }
  });

  it('the zip holds every variant that passed, with a README', async () => {
    const res = await call(exportRows(), 'exportImproved', `/api/audits/${auditId}/improve-export`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Disposition']).toMatch(/improved-version\.zip/);
    const names = unzipNames(res.body);
    expect(names.filter((n) => n.endsWith('.html'))).toHaveLength(4);
    expect(names.some((n) => n.endsWith('/README.md'))).toBe(true);
  });

  it('stars a passing variant; an unknown one is 404', async () => {
    const rows = exportRows();
    const ok = await call(
      rows,
      'setImproveBest',
      `/api/audits/${auditId}/improve-best`,
      JSON.stringify({ page: 'p-services', variant: 2 })
    );
    expect(ok.statusCode, ok.body.toString()).toBe(200);
    expect(ok.json()).toEqual({ best: { page: 'p-services', variant: 2 } });
    const bad = await call(
      rows,
      'setImproveBest',
      `/api/audits/${auditId}/improve-best`,
      JSON.stringify({ page: 'nope', variant: 1 })
    );
    expect(bad.statusCode).toBe(404);
  });

  it('the Markdown export gains the Improved version section; the Pitch Glimpse its thumbnail', async () => {
    const rows = exportRows();
    const md = await call(rows, 'export', `/api/audits/${auditId}/export`, undefined, '?format=md');
    expect(md.statusCode).toBe(200);
    expect(md.body.toString('utf8')).toContain('Suggestion, not the live site');
    expect(thumbnailCalls).toBe(4);

    const pitch = await call(rows, 'pitch', `/api/audits/${auditId}/pitch`, undefined, '?format=html');
    expect(pitch.statusCode).toBe(200);
    expect(pitch.body.toString('utf8')).toContain(`data:image/jpeg;base64,${JPEG.toString('base64')}`);
    expect(pitch.body.toString('utf8')).toContain('Improved version');
  });
});
