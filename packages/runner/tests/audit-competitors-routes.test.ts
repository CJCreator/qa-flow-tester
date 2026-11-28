/**
 * T-416: the competitor rows. The real store in a temp folder, the real stage AI with a fake provider, the real
 * address check and pinned outbound fetch on a fake network: no real site is reached.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_COMPETITOR_API, matchAuditPath, type CompetitorsState } from '@qa/types';
import {
  AuditStore,
  LocalAuditStoreBackend,
  auditAiRequestBudget,
  checkAuditAddress,
  makeOutboundFetch,
  pageContentName,
  resolveAuditAi,
  type AIProvider,
  type AuditAiRequestBudget,
  type NetDeps,
} from '@qa/core';
import { auditDocContents, auditDocResult, PATHS } from '../../core/tests/helpers/audit-doc-fixture.js';
import { auditCompetitorRoutes, type AuditCompetitorRouteDeps } from '../src/routes/audit-competitors.js';
import type { AuditCaller } from '../src/routes/audit-store.js';
import type { Route } from '../src/routes/route.js';

class MockResponse {
  statusCode = 0;
  body = '';
  writeHead(status: number) {
    this.statusCode = status;
  }
  end(chunk?: string | Buffer) {
    if (chunk) this.body += chunk.toString();
  }
  json(): any {
    return JSON.parse(this.body);
  }
}

const NOW = new Date('2026-11-19T10:00:00.000Z');
let dir: string;
let store: AuditStore;
let caller: AuditCaller;
let auditId: string;
let hasKey: boolean;
let budget: AuditAiRequestBudget;
let requested: string[];

const AI_ANSWER = JSON.stringify({
  competitors: [
    { url: 'https://grocer-one.example', reason: 'Sells groceries online in the same city.' },
    { url: 'https://grocer-two.example', reason: 'Delivers fresh vegetables.' },
    { url: 'http://192.168.1.20', reason: 'A shop.' },
  ],
});

const provider: AIProvider = {
  providerType: 'openrouter',
  async generateText() {
    return AI_ANSWER;
  },
};

function homepage(host: string): string {
  const menu = Array.from({ length: 12 }, (_, i) => `<a href="/services-${i}">Services ${i}</a>`).join('');
  return `<title>${host}</title><nav><a href="/pricing">Pricing</a>${menu}</nav><h1>Fresh food</h1><a href="tel:+91">Call</a>`;
}

const net: NetDeps = {
  async lookup(host) {
    return [host.startsWith('192.168.') ? host : '93.184.216.34'];
  },
  async connect(req) {
    requested.push(`${req.url.host}${req.url.pathname}`);
    if (req.url.pathname === '/robots.txt') return { status: 404, headers: {}, body: '' };
    if (req.url.pathname === '/')
      return { status: 200, headers: { 'content-type': 'text/html' }, body: homepage(req.url.host) };
    return { status: 200, headers: { 'content-type': 'text/html' }, body: '<h1>Page</h1>' };
  },
};

function deps(extra: Partial<AuditCompetitorRouteDeps> = {}): AuditCompetitorRouteDeps {
  return {
    store,
    caller: () => caller,
    resolveAi: () =>
      resolveAuditAi({
        setup: { provider: 'openrouter' },
        keys: {
          resolveKey: async () => (hasKey ? { provider: 'openrouter', apiKey: 'test-only', source: 'keychain' } : null),
        },
        budget,
        createProvider: () => provider,
      }),
    checkAddress: (url) => checkAuditAddress(url, { netDeps: net }),
    crawl: { fetch: makeOutboundFetch({ allowPrivate: false, deps: net }), minGapMs: 0, sleep: async () => {} },
    now: () => NOW,
    ...extra,
  };
}

async function call(
  rows: Route[],
  key: keyof typeof AUDIT_COMPETITOR_API,
  options: { body?: unknown; raw?: string; search?: string } = {}
): Promise<MockResponse> {
  const { method, path: pattern } = AUDIT_COMPETITOR_API[key];
  const row = rows.find((r) => r.method === method && r.path === pattern)!;
  const pathname = pattern.replace(':id', auditId);
  const params = (matchAuditPath(pattern, pathname) ?? {}) as Record<string, string>;
  const raw =
    options.raw !== undefined ? [options.raw] : options.body === undefined ? [] : [JSON.stringify(options.body)];
  const req = Readable.from(raw) as unknown as http.IncomingMessage;
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
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-competitor-routes-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir));
  caller = { owner: true };
  hasKey = true;
  budget = auditAiRequestBudget();
  requested = [];
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

describe('competitor rows', () => {
  it('match AUDIT_COMPETITOR_API: get is view, discover and crawl are owner only', async () => {
    const rows = auditCompetitorRoutes(deps());
    expect(rows.map((r) => [r.method, r.path, r.access])).toEqual([
      ['GET', '/api/audits/:id/competitors', 'view'],
      ['POST', '/api/audits/:id/competitors/discover', 'owner'],
      ['POST', '/api/audits/:id/competitors/crawl', 'owner'],
    ]);
    caller = { owner: false };
    expect((await call(rows, 'discoverCompetitors', { body: {} })).statusCode).toBe(403);
    expect((await call(rows, 'crawlCompetitors', { body: { hosts: [] } })).statusCode).toBe(403);
  });

  it('without an AI key: 409 ERR_NO_AI_KEY and nothing stored', async () => {
    hasKey = false;
    const res = await call(auditCompetitorRoutes(deps()), 'discoverCompetitors', { body: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ERR_NO_AI_KEY');
    expect(await store.readVersionJson(auditId, 1, 'competitors')).toBeNull();
  });

  it('discover: one AI request names 3 sites; the private address is refused; stored', async () => {
    const rows = auditCompetitorRoutes(deps());
    const res = await call(rows, 'discoverCompetitors', { body: { version: 1 } });
    expect(res.statusCode).toBe(200);
    expect(budget.used).toBe(1);
    const state = res.json().competitors as CompetitorsState;
    expect(state.candidates.map((c) => [c.host, c.status])).toEqual([
      ['grocer-one.example', 'ok'],
      ['grocer-two.example', 'ok'],
      ['192.168.1.20', 'refused'],
    ]);
    // The private address was never contacted.
    expect(requested.some((r) => r.startsWith('192.168.'))).toBe(false);
    const got = await call(rows, 'getCompetitors');
    expect(got.json().competitors).toEqual(state);
  });

  it('answers 413 for a too-large body and for text that is not JSON; an empty body is read as {}', async () => {
    const rows = auditCompetitorRoutes(deps());
    const big = await call(rows, 'crawlCompetitors', { raw: JSON.stringify({ hosts: ['x'.repeat(5000)] }) });
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toBe('The request is too large.');
    const bad = await call(rows, 'crawlCompetitors', { raw: '{nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('The request is not valid JSON.');
    const empty = await call(rows, 'crawlCompetitors', { raw: '  ' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).not.toMatch(/JSON|large/);
  });

  it('crawl: only kept, checked candidates are read; a refused or unknown host is refused', async () => {
    const rows = auditCompetitorRoutes(deps());
    expect((await call(rows, 'crawlCompetitors', { body: { hosts: ['grocer-one.example'] } })).statusCode).toBe(409);
    await call(rows, 'discoverCompetitors', { body: {} });
    for (const hosts of [['192.168.1.20'], ['elsewhere.example'], []]) {
      const res = await call(rows, 'crawlCompetitors', { body: { hosts } });
      expect(res.statusCode).toBe(400);
    }
    requested = [];
    // The tool user removed grocer-two before the crawl.
    const res = await call(rows, 'crawlCompetitors', { body: { hosts: ['grocer-one.example'] } });
    expect(res.statusCode).toBe(200);
    const state = res.json().competitors as CompetitorsState;
    expect(state.sites).toHaveLength(1);
    expect(state.sites![0].status).toBe('read');
    expect(state.sites![0].pages.length).toBeLessThanOrEqual(11);
    expect(requested.some((r) => r.startsWith('grocer-two.example'))).toBe(false);
    expect(state.comparison!.find((r) => r.pageType === 'home')!.audited?.urlPath).toBe(PATHS.home);
    expect(budget.used).toBe(1);
  });

  it('on the hosted copy, competitor pages count toward the page cap', async () => {
    const recorded = auditDocResult().pages.length;
    const rows = auditCompetitorRoutes(deps({ maxPages: recorded + 4 }));
    await call(rows, 'discoverCompetitors', { body: {} });
    const res = await call(rows, 'crawlCompetitors', { body: { hosts: ['grocer-one.example', 'grocer-two.example'] } });
    const state = res.json().competitors as CompetitorsState;
    const pages = state.sites!.reduce((n, s) => n + s.pages.length, 0);
    expect(pages).toBe(4);
    expect(state.sites![1].pages.length).toBe(0);
    expect(state.sites![1].status).toBe('not-read');
  });
});
