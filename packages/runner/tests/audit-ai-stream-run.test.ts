/**
 * T-429: in a real run, the AI gets its first page request while the crawl is still going, and the step after
 * the crawl gets the same AI and the stream. A plain http server, a real RunSlot and audit store, a fake crawl,
 * fake page stages and a fake AI: no Chromium, no network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Page } from 'playwright';
import type { AuditRequest, PageContent } from '@qa/types';
import {
  AuditStore,
  LocalAuditStoreBackend,
  createPageRecorder,
  type AuditAiResolution,
  type AuditCrawlResult,
} from '@qa/core';
import { createAuditCrawlRoutes, type AfterCrawlInput, type AuditCrawl } from '../src/routes/audit-crawl.js';
import { resolveRoute, type Route } from '../src/routes/route.js';
import { DefaultRunSlot } from '../src/session/run-slot.js';
import { AuditRuns } from '../src/session/audit-run.js';

const REQUEST: AuditRequest = {
  url: 'https://example.com/',
  limits: { maxPages: 3, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

let dir: string;
let servers: http.Server[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-ai-stream-run-'));
  servers = [];
});
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null)))));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function serve(rows: Route[]): Promise<string> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = resolveRoute(rows, req.method ?? 'GET', url.pathname);
    if (!match) {
      res.writeHead(404);
      res.end();
      return;
    }
    void Promise.resolve(match.route.handle({ server: undefined as never, req, res, url, params: match.params }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A page long enough to be asked alone, so its request goes out as soon as it is recorded. */
function longContent(urlPath: string): PageContent {
  return {
    urlPath,
    title: 'Home',
    description: 'A page.',
    text: Array.from({ length: 1600 }, (_, i) => `word${i}`).join(' '),
    headings: [{ level: 1, text: 'Home', sectionId: 's1' } as PageContent['headings'][number]],
    images: [],
    links: [],
    forms: [],
    ctas: [],
    language: { primary: 'en', others: [], declared: 'en' },
    sections: [{ id: 's1', kind: 'main', heading: 'Home', start: 0, end: 5 }],
  };
}

describe('T-429: the AI works during the crawl', () => {
  it('the AI gets a page request before the crawl ends, and the step after the crawl gets the same AI', async () => {
    const store = new AuditStore(new LocalAuditStoreBackend(path.join(dir, 'store')));
    const runs = new AuditRuns();
    const events: string[] = [];
    const ask = vi.fn(async () => {
      events.push('ai-request');
      return { ok: false as const, reason: 'budget-spent' as const };
    });
    const ai: AuditAiResolution = { ok: true, ai: { provider: 'gemini', ask } as never };

    const crawl: AuditCrawl = async (_request, opts) => {
      const page = { url: () => 'https://example.com/' } as unknown as Page;
      await opts.onRenderedPage!(page, { urlPath: '/', title: 'Home', depth: 0, links: [] }, undefined as never);
      // The crawl goes on (another page loading) while the AI is asked about the first one.
      for (let i = 0; i < 100 && ask.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
      events.push('crawl-ended');
      const result: AuditCrawlResult = {
        startUrl: REQUEST.url,
        finalUrl: REQUEST.url,
        pages: [{ urlPath: '/', title: 'Home', depth: 0, links: [] }],
        coverage: { found: 1, reached: 1, skipped: [] },
        leavingSite: [],
        signInWalls: [],
        paymentAreas: [],
        pacer: {} as never,
        crawlDelayMs: null,
      };
      return result;
    };
    let after: AfterCrawlInput | undefined;
    const rows = createAuditCrawlRoutes({
      store,
      caller: () => ({ owner: true }),
      slot: () => new DefaultRunSlot(),
      runs,
      checkAddress: async () => ({ ok: true, finalUrl: REQUEST.url, status: 200 }),
      crawl,
      resolveAi: async () => ai,
      preflightAi: async () => 'ready',
      makeWorkDir: () => fs.mkdtemp(path.join(dir, 'work-')),
      createRecorder: (o) =>
        createPageRecorder({
          ...o,
          stages: {
            readPage: (async () => ({ raw: {} as never, content: longContent('/') })) as never,
            accessibilityBasics: (async () => ({ basics: null, findings: [] })) as never,
            recordPhoneLayout: (async () => ({
              phone: { widthPx: 375, screenshotPath: null, overflow: false, findingIds: [] },
              findings: [],
            })) as never,
            measureBrowserTiming: (async () => ({ speed: { status: 'not-measured' }, raw: {} })) as never,
          },
        }),
      afterCrawl: async (input) => {
        after = input;
        await input.stream?.settle();
        await store.updateVersion(input.auditId, input.version, {
          status: 'done',
          finishedAt: new Date().toISOString(),
        });
      },
    });
    const base = await serve(rows);
    const res = await fetch(`${base}/api/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(REQUEST),
    });
    expect(res.status).toBe(202);
    const { auditId } = (await res.json()) as { auditId: string };
    for (let i = 0; i < 300 && !runs.get(auditId)?.finished; i++) await new Promise((r) => setTimeout(r, 10));

    expect(events.indexOf('ai-request')).toBeGreaterThan(-1);
    expect(events.indexOf('ai-request')).toBeLessThan(events.indexOf('crawl-ended'));
    expect(after?.ai).toBe(ai);
    expect(after?.stream).toBeDefined();
    expect((await store.getVersion(auditId, 1))?.status).toBe('done');
  });
});
