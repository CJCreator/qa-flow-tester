/**
 * T-413 (ADR 0049): the Improved version rows. The real store in a temp folder, the real core makeVariants and
 * stage AI, and a mock AI Provider; handlers are called with a mock request and response.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, matchAuditPath, type ImproveListReply } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend, pageContentName, resolveAuditAi, type AIProvider } from '@qa/core';
import { auditDocContents, auditDocResult } from '../../core/tests/helpers/audit-doc-fixture.js';
import { auditImproveRoutes, type AuditImproveRouteDeps } from '../src/routes/audit-improve.js';
import type { AuditCaller } from '../src/routes/audit-store.js';
import type { Route } from '../src/routes/route.js';

const NOW = new Date('2026-11-19T10:00:00.000Z');
const AI_PAGE =
  '<nav><a href="/about">About</a><a href="/services">Services</a></nav><h1 data-section="s1">Fresh groceries</h1>';

class MockResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = '';
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    this.headers = { ...(headers ?? {}) };
  }
  end(chunk?: string | Buffer) {
    if (chunk) this.body += chunk.toString();
  }
  json(): any {
    return JSON.parse(this.body);
  }
}

let dir: string;
let store: AuditStore;
let caller: AuditCaller;
let auditId: string;
let providerCalls: number;
let hasKey: boolean;

const provider: AIProvider = {
  providerType: 'mock',
  async generateText() {
    providerCalls++;
    return AI_PAGE;
  },
};

function deps(extra: Partial<AuditImproveRouteDeps> = {}): AuditImproveRouteDeps {
  return {
    store,
    caller: () => caller,
    resolveAi: () =>
      resolveAuditAi({
        setup: { provider: 'mock' },
        keys: {
          resolveKey: async () => (hasKey ? { provider: 'mock', apiKey: 'mock-key', source: 'keychain' } : null),
        },
        createProvider: () => provider,
      }),
    usdPerRequest: async () => 0.05,
    scanAxe: async () => ({ blockers: 0 }),
    fetchImage: async () => null,
    now: () => NOW,
    ...extra,
  };
}

async function call(
  rows: Route[],
  key: 'createImprove' | 'listImprove' | 'getImprove',
  pathname: string,
  options: { body?: string; search?: string } = {}
): Promise<MockResponse> {
  const { method, path: pattern } = AUDIT_API[key];
  const row = rows.find((r) => r.method === method && r.path === pattern)!;
  const params = (matchAuditPath(pattern, pathname) ?? {}) as Record<string, string>;
  const req = Readable.from(options.body === undefined ? [] : [options.body]) as unknown as http.IncomingMessage;
  Object.assign(req, { method, headers: {} });
  const res = new MockResponse();
  await row.handle({
    server: undefined as never,
    req,
    res: res as unknown as http.ServerResponse,
    url: new URL(`http://localhost${pathname}${options.search ?? ''}`),
    params,
  });
  return res;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-improve-routes-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir));
  caller = { owner: true };
  providerCalls = 0;
  hasKey = true;
  const v1 = await store.createAudit({
    url: 'https://shop.example.in/',
    limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
    language: 'en',
  });
  auditId = v1.auditId;
  await store.saveResult(auditId, 1, { ...auditDocResult(), auditId, version: 1 });
  for (const content of auditDocContents()) {
    await store.writeVersionJson(auditId, 1, pageContentName(content.urlPath), content);
  }
  await store.updateVersion(auditId, 1, { status: 'done', finishedAt: NOW.toISOString() });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Improved version rows', () => {
  it('equal AUDIT_API: method, path and access', () => {
    const rows = auditImproveRoutes(deps());
    expect(rows).toHaveLength(3);
    for (const key of ['createImprove', 'listImprove', 'getImprove'] as const) {
      const entry = AUDIT_API[key];
      const row = rows.find((r) => r.method === entry.method && r.path === entry.path)!;
      expect(row.access, key).toBe(entry.access);
    }
    expect(AUDIT_API.createImprove.access).toBe('owner');
  });

  it('lists the pages and the price of a request; the estimate equals the requests made', async () => {
    const rows = auditImproveRoutes(deps());
    const listed = await call(rows, 'listImprove', `/api/audits/${auditId}/improve`, { search: '?version=1' });
    expect(listed.statusCode, listed.body).toBe(200);
    const reply = listed.json() as ImproveListReply;
    expect(reply.pages.map((p) => p.key)).toEqual(['home', 'p-services']);
    expect(reply.estimate.usdPerRequest).toBe(0.05);
    expect(reply.language).toBe('en');

    const made = await call(rows, 'createImprove', `/api/audits/${auditId}/improve`, {
      body: JSON.stringify({ version: 1, pages: ['home', 'p-services'], variants: 3 }),
    });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.json().requests).toBe(reply.pages.length * 3);
    expect(providerCalls).toBe(6);

    const after = (await call(rows, 'listImprove', `/api/audits/${auditId}/improve`)).json() as ImproveListReply;
    expect(after.variants).toHaveLength(6);
  });

  it('serves a made variant with the Shared Link page headers; anything else is 404', async () => {
    const rows = auditImproveRoutes(deps());
    await call(rows, 'createImprove', `/api/audits/${auditId}/improve`, {
      body: JSON.stringify({ pages: ['p-services'], variants: 1 }),
    });
    const page = await call(rows, 'getImprove', `/api/audits/${auditId}/improve/p-services/1`);
    expect(page.statusCode).toBe(200);
    expect(page.headers['Content-Security-Policy']).toBeTruthy();
    expect(page.headers['X-Robots-Tag']).toContain('noindex');
    expect(page.body).toContain('the page /services of shop.example.in');
    for (const p of ['p-services/2', 'home/1', '..%2F..%2Fresult/1']) {
      expect([400, 404], p).toContain(
        (await call(rows, 'getImprove', `/api/audits/${auditId}/improve/${p}`)).statusCode
      );
    }
  });

  it('refuses a Helper, a missing key and a wrong body without an AI request', async () => {
    const rows = auditImproveRoutes(deps());
    const body = JSON.stringify({ pages: ['home'], variants: 1 });
    caller = { owner: false, helperEmail: 'h@example.com' };
    expect((await call(rows, 'createImprove', `/api/audits/${auditId}/improve`, { body })).statusCode).toBe(403);
    caller = { owner: true };
    hasKey = false;
    const noKey = await call(rows, 'createImprove', `/api/audits/${auditId}/improve`, { body });
    expect(noKey.statusCode).toBe(409);
    expect(noKey.json().code).toBe('ERR_NO_AI_KEY');
    hasKey = true;
    const wrong = await call(rows, 'createImprove', `/api/audits/${auditId}/improve`, {
      body: JSON.stringify({ pages: ['home'], variants: 9 }),
    });
    expect(wrong.statusCode).toBe(400);
    expect(providerCalls).toBe(0);
    const big = await call(rows, 'createImprove', `/api/audits/${auditId}/improve`, { body: 'x'.repeat(5000) });
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toBe('The request is too large.');
    const bad = await call(rows, 'createImprove', `/api/audits/${auditId}/improve`, { body: '{nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('The request is not valid JSON.');
    // An empty body is read as {}: it passes the JSON step and fails later on the missing pages.
    const empty = await call(rows, 'createImprove', `/api/audits/${auditId}/improve`, { body: '' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).not.toMatch(/not valid JSON/);
  });
});
