/**
 * QA-195 (REQ-034, REQ-035, REQ-047, REQ-048, REQ-049): a Website Audit of fixtures/audit-site, end to end
 * through a real RunnerServer over HTTP, with the audit's own Chromium and no AI key (no external request).
 *
 * The audit accepts public addresses only, so the test's route table swaps the start and stream rows for the
 * same rows built with a fake DNS and network (the way audit-crawl.test.ts does): the public-looking host
 * `kaveri.test` resolves to a public address, connections go to the fixture on 127.0.0.1, and the launcher
 * rewrites Chromium's `--host-resolver-rules` pin to 127.0.0.1. The public-only guard itself is not weakened.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import type { AuditProgressEvent, AuditResult, AuditStartReply, ShareLinkReply } from '@qa/types';
import { checkAuditAddress, defaultNetDeps, runAuditCrawl, type AuditBrowserLauncher, type NetDeps } from '@qa/core';
import { RunnerServer } from '../src/server.js';
import { allRoutes } from '../src/routes/index.js';
import { auditPipelineStep, createAuditCrawlRoutes } from '../src/routes/audit-crawl.js';
import type { Route, RouteContext } from '../src/routes/route.js';
import { AuditRuns } from '../src/session/audit-run.js';
import { startAuditSite, type AuditSiteServer } from '../../core/tests/helpers/audit-site-server.js';

/** The runner has no Playwright dependency of its own: take the one @qa/core launches its browsers with. */
const { chromium } = createRequire(path.resolve(__dirname, '../../core/package.json'))(
  'playwright'
) as typeof import('../../core/node_modules/playwright');

const PORT = 3811;
const ACCESS = 'website-audit-e2e-key-0123456789';
const SITE_HOST = 'kaveri.test';
const PUBLIC_ADDRESS = '93.184.216.34';
const OFF_HOST = 'sitemaps.example.invalid';

let dir: string;
let server: RunnerServer;
let site: AuditSiteServer;
let base: string;
/** Every name looked up and every URL an outbound fetch connected to. */
const lookups: string[] = [];
const connects: string[] = [];

const netDeps: NetDeps = {
  async lookup(host) {
    lookups.push(host);
    if (host === SITE_HOST) return [PUBLIC_ADDRESS];
    throw new Error('ENOTFOUND');
  },
  connect(req) {
    connects.push(req.url.toString());
    return defaultNetDeps.connect({ ...req, address: '127.0.0.1' });
  },
};

/** The audit's own Chromium, with its resolver pin pointed at the fixture instead of the public address. */
const launchBrowser: AuditBrowserLauncher = (options) =>
  chromium.launch({
    ...options,
    args: (options.args ?? []).map((a) => a.replace(PUBLIC_ADDRESS, '127.0.0.1')),
  });

/** The start and stream rows with the fake network; built on first use, with the runner's own store. */
function auditRowsWithFakeNetwork(): Route[] {
  const runs = new AuditRuns();
  let rows: Route[] | undefined;
  const build = (context: RouteContext): Route[] => {
    if (rows) return rows;
    const { store, isOwnerRequest } = context.server.auditWiring;
    rows = createAuditCrawlRoutes({
      store,
      runs,
      caller: (c) => ({ owner: isOwnerRequest(c.req) }),
      checkAddress: (url) => checkAuditAddress(url, { netDeps }),
      crawl: (request, opts) => runAuditCrawl(request, { ...opts, deps: { netDeps, launchBrowser } }),
      afterCrawl: auditPipelineStep({ store }),
    });
    return rows;
  };
  const delegate =
    (index: number): Route['handle'] =>
    (context) =>
      build(context)[index].handle(context);
  const [startRow, streamRow] = createAuditCrawlRoutes({
    store: undefined as never,
    caller: () => ({ owner: false }),
  });
  return [
    { ...startRow, handle: delegate(0) },
    { ...streamRow, handle: delegate(1) },
  ];
}

const owner = { 'X-QA-Access': ACCESS };

async function call(method: string, pathname: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, buf, text, json };
}

/** Reads the progress stream to its last event ('done' or 'failed'). */
async function readStream(auditId: string): Promise<AuditProgressEvent[]> {
  const res = await fetch(`${base}/api/audits/${auditId}/stream`, { headers: owner });
  expect(res.status).toBe(200);
  const events: AuditProgressEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split('\n\n');
    pending = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
  return events;
}

const pathOf = (p: string) => new URL(p, 'http://x.invalid').pathname;
const RELEASE_VERDICT = /ready to release|not ready to release|release verdict/i;

let auditId: string;
let events: AuditProgressEvent[];
let result: AuditResult;
let duringAuditRun: { status: number; json: any };
let startReply: { status: number; json: AuditStartReply };

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'website-audit-e2e-'));
  site = await startAuditSite();
  server = new RunnerServer({
    port: PORT,
    host: 'localhost',
    outputDir: path.join(dir, 'report'),
    dataDir: path.join(dir, 'data'),
    accessToken: ACCESS,
    routes: [
      ...allRoutes.filter(
        (r) => !(r.method === 'POST' && r.path === '/api/audits') && r.path !== '/api/audits/:id/stream'
      ),
      ...auditRowsWithFakeNetwork(),
    ],
  });
  base = await server.start();
}, 60_000);

afterAll(async () => {
  await server?.stop();
  await site?.close();
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe('Website Audit end to end (fixtures/audit-site)', () => {
  it('starts with 202, refuses a second run with 409 while it runs, and finishes', async () => {
    startReply = (await call('POST', '/api/audits', {
      headers: owner,
      body: { url: `http://${SITE_HOST}:${site.port}/`, maxPages: 60, maxDepth: 3 },
    })) as never;
    expect(startReply.status).toBe(202);
    auditId = startReply.json.auditId;
    expect(auditId).toBeTruthy();

    // REQ-049 AC-2: a Check-up start during the audit.
    duringAuditRun = await call('POST', '/api/runner/run', {
      headers: owner,
      body: { url: `http://${SITE_HOST}:${site.port}/` },
    });
    expect(duringAuditRun.status).toBe(409);
    expect(duringAuditRun.json.code).toBe('ERR_RUN_IN_PROGRESS');

    events = await readStream(auditId);
    const last = events[events.length - 1];
    expect(last.type, JSON.stringify(last)).toBe('done');
  }, 240_000);

  it('GET /api/audits/:id lists the fixture pages and the Skipped Pages with their reasons', async () => {
    const got = await call('GET', `/api/audits/${auditId}`, { headers: owner });
    expect(got.status).toBe(200);
    result = (got.json.result ?? got.json.audit?.result ?? got.json) as AuditResult;
    const recorded = result.pages.map((p) => pathOf(p.urlPath));
    for (const p of ['/', '/about', '/services', '/gallery', '/blog', '/shop', '/ta', '/hi']) {
      expect(recorded, p).toContain(p);
    }
    const skipped = result.coverage.skipped;
    const as = (why: string) => skipped.filter((s) => s.why === why).map((s) => pathOf(s.urlPath));
    expect(as('robots')).toEqual(expect.arrayContaining(['/private/staff-rota', '/private/reports']));
    expect(as('sign-in')).toContain('/account/sign-in');
    expect(as('payment')).toContain('/shop/checkout');
    expect(as('depth-limit').some((p) => p.startsWith('/blog/2025/diwali/sweets'))).toBe(true);
    expect(recorded).not.toContain('/private/staff-rota');
    expect(recorded).not.toContain('/private/reports');
    expect(result.notes.join(' ')).toMatch(/AI/);
  });

  it('REQ-034 AC-1: robots-disallowed pages are never requested', () => {
    const requested = site.requests.map((r) => pathOf(r.path));
    expect(requested.filter((p) => p.startsWith('/private'))).toEqual([]);
    expect(requested).toContain('/robots.txt');
    expect(requested).toContain('/sitemap.xml');
  });

  it('REQ-047 AC-4: the off-host Sitemap line is never fetched or looked up', () => {
    expect(lookups.some((h) => h.includes('example.invalid'))).toBe(false);
    expect(connects.some((u) => u.includes(OFF_HOST))).toBe(false);
  });

  it('REQ-035 AC-1: top-level requests never overlap and are at least the 1 s Crawl-delay apart', () => {
    // Pages, robots.txt and sitemaps; images, scripts and styles are subresources of a page.
    const all = site.requests
      .filter((r) => {
        const p = pathOf(r.path);
        return p === '/robots.txt' || p === '/sitemap.xml' || !path.extname(p);
      })
      .filter((r) => r.finishedAt !== undefined)
      .sort((a, b) => a.startedAt - b.startedAt);
    // The Crawl-delay is only known once robots.txt is read, so the address check before it and robots.txt
    // itself are not paced. The paced run starts with the first pacer turn, sitemap.xml.
    const top = all.slice(all.findIndex((r) => pathOf(r.path) === '/sitemap.xml'));
    expect(top.length).toBeGreaterThan(10);
    const TOLERANCE_MS = 100;
    for (let i = 1; i < top.length; i++) {
      const prev = top[i - 1];
      const cur = top[i];
      const label = `${prev.path} -> ${cur.path}`;
      expect(cur.startedAt, `${label} overlaps`).toBeGreaterThanOrEqual(prev.finishedAt!);
      expect(cur.startedAt - prev.startedAt, `${label} gap`).toBeGreaterThanOrEqual(1000 - TOLERANCE_MS);
    }
  });

  it('GET /api/audits/:id/content answers Page Content for a recorded page', async () => {
    const res = await call('GET', `/api/audits/${auditId}/content?path=/about`, { headers: owner });
    expect(res.status, res.text.slice(0, 200)).toBe(200);
    expect(res.json.content).toBeTruthy();
    expect(res.text.length).toBeGreaterThan(50);
    expect(res.text).not.toMatch(RELEASE_VERDICT);
  });

  it('REQ-048: an owner route is refused without the access key; a Shared Link is served without it', async () => {
    const noKey = await call('GET', `/api/audits/${auditId}`);
    expect(noKey.status).toBe(401);
    const startNoKey = await call('POST', '/api/audits', { body: { url: `http://${SITE_HOST}:${site.port}/` } });
    expect([401, 403]).toContain(startNoKey.status);

    const created = await call('POST', `/api/audits/${auditId}/share`, {
      headers: owner,
      body: { kind: 'pitch', language: 'en', version: 1 },
    });
    expect(created.status, created.text).toBeLessThan(300);
    const link = (created.json as ShareLinkReply).link;
    const shared = await call('GET', `/s/${link.id}`);
    expect(shared.status).toBe(200);
    expect(shared.headers.get('content-type')).toContain('text/html');
    expect(shared.text).not.toMatch(RELEASE_VERDICT);
  });

  it('exports the Audit Documents, and no reply or export holds a release verdict', async () => {
    const md = await call('GET', `/api/audits/${auditId}/export?format=md&version=1`, { headers: owner });
    expect(md.status, md.text.slice(0, 200)).toBe(200);
    expect(md.buf.length).toBeGreaterThan(100);
    expect(md.headers.get('content-disposition')).toContain('attachment');
    const bundle = await call('GET', `/api/audits/${auditId}/export?format=bundle&version=1`, { headers: owner });
    expect(bundle.status).toBe(200);
    expect(bundle.buf.subarray(0, 2).toString('latin1')).toBe('PK');
    const html = await call('GET', `/api/audits/${auditId}/export?format=html&version=1`, { headers: owner });
    expect(html.status).toBe(200);

    for (const [name, text] of [
      ['result', JSON.stringify(result)],
      ['stream', JSON.stringify(events)],
      ['md export', md.text],
      ['html export', html.text],
    ]) {
      expect(text, name).not.toMatch(RELEASE_VERDICT);
    }
  });
});
