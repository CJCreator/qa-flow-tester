import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { chromium, type Browser } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

describe('DeterministicSpider reliability core (T-111)', () => {
  const FIXTURE_PORT = 3821;
  const PACING_PORT = 3822;
  const RETRY_PORT = 3823;
  const OFFSITE_A_PORT = 3824;
  const OFFSITE_B_PORT = 3825;

  const fixtureUrl = `http://localhost:${FIXTURE_PORT}`;
  let browser: Browser;
  let pacingServer: http.Server;
  let retryServer: http.Server;
  let offsiteAServer: http.Server;
  let offsiteBServer: http.Server;

  const pacingTimes: number[] = [];
  let retryReqCount = 0;

  beforeAll(async () => {
    browser = await chromium.launch();

    // Fixture server
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));

    // Pacing server: records timestamp of each request
    pacingServer = http.createServer((req, res) => {
      pacingTimes.push(Date.now());
      const url = new URL(req.url || '/', `http://localhost:${PACING_PORT}`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (url.pathname === '/') {
        const links = Array.from({ length: 8 }, (_, i) => `<a href="/page-${i + 1}">Page ${i + 1}</a>`).join(' ');
        res.end(`<!doctype html><html><body><h1>Home</h1>${links}</body></html>`);
      } else {
        res.end(`<!doctype html><html><body><h1>${url.pathname}</h1></body></html>`);
      }
    });
    await new Promise<void>((resolve) => pacingServer.listen(PACING_PORT, () => resolve()));

    // Retry & dead links server
    retryServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${RETRY_PORT}`);
      if (url.pathname === '/retry-page') {
        retryReqCount++;
        if (retryReqCount === 1) {
          // Hang request 1
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><html><body><h1>Retry Success</h1></body></html>`);
        return;
      }
      if (url.pathname === '/') {
        // Link to 5 good pages and 50 404 pages
        const good = Array.from({ length: 5 }, (_, i) => `<a href="/good/${i + 1}">Good ${i + 1}</a>`).join(' ');
        const dead = Array.from({ length: 50 }, (_, i) => `<a href="/dead/${i + 1}">Dead ${i + 1}</a>`).join(' ');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><html><body><h1>Hub</h1>${good} ${dead}</body></html>`);
        return;
      }
      if (url.pathname.startsWith('/good/')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><html><body><h1>Good Page</h1></body></html>`);
        return;
      }
      // Dead pages return 404
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body><h1>Not Found</h1></body></html>`);
    });
    await new Promise<void>((resolve) => retryServer.listen(RETRY_PORT, () => resolve()));

    // Offsite servers: A redirects to B
    offsiteAServer = http.createServer((_req, res) => {
      res.writeHead(302, { Location: `http://localhost:${OFFSITE_B_PORT}/landing` });
      res.end();
    });
    await new Promise<void>((resolve) => offsiteAServer.listen(OFFSITE_A_PORT, () => resolve()));

    offsiteBServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body><h1>Offsite B</h1></body></html>`);
    });
    await new Promise<void>((resolve) => offsiteBServer.listen(OFFSITE_B_PORT, () => resolve()));
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    pacingServer.closeAllConnections?.();
    await new Promise<void>((resolve) => pacingServer.close(() => resolve()));
    retryServer.closeAllConnections?.();
    await new Promise<void>((resolve) => retryServer.close(() => resolve()));
    offsiteAServer.closeAllConnections?.();
    await new Promise<void>((resolve) => offsiteAServer.close(() => resolve()));
    offsiteBServer.closeAllConnections?.();
    await new Promise<void>((resolve) => offsiteBServer.close(() => resolve()));
  });

  it('/lab/spa-late: finds late-rendered links (/lab/spa-late/a and /b)', async () => {
    const context = await browser.newContext();
    try {
      const spider = new DeterministicSpider();
      const result = await spider.crawl(context, `${fixtureUrl}/lab/spa-late`, {
        concurrency: 1,
      });

      const paths = result.pages.map((p) => p.urlPath).sort();
      expect(paths).toContain('/lab/spa-late');
      expect(paths).toContain('/lab/spa-late/a');
      expect(paths).toContain('/lab/spa-late/b');

      // Check routes telemetry
      expect(result.routes).toBeDefined();
      const r = (result.routes ?? []).find((route) => route.requestedPath === '/lab/spa-late');
      expect(r).toBeDefined();
      expect(r?.outcome).toBe('recorded');
    } finally {
      await context.close();
    }
  }, 60000);

  it('/lab/always-500 and /lab/forbidden are not in pages; routes has 500/403 and skipReason: http-error', async () => {
    const context = await browser.newContext();
    try {
      const spider = new DeterministicSpider();
      const result = await spider.crawl(context, `${fixtureUrl}/lab/always-500`, {
        startPaths: ['/lab/always-500', '/lab/forbidden'],
      });

      const pagePaths = result.pages.map((p) => p.urlPath);
      expect(pagePaths).not.toContain('/lab/always-500');
      expect(pagePaths).not.toContain('/lab/forbidden');

      expect(result.routes).toBeDefined();
      const routes = result.routes ?? [];
      const route500 = routes.find((r) => r.requestedPath === '/lab/always-500');
      expect(route500).toMatchObject({
        status: 500,
        outcome: 'skipped',
        skipReason: 'http-error',
      });

      const route403 = routes.find((r) => r.requestedPath === '/lab/forbidden');
      expect(route403).toMatchObject({
        status: 403,
        outcome: 'skipped',
        skipReason: 'http-error',
      });

      const skipped500 = result.skipped?.find((s) => s.urlPath === '/lab/always-500');
      expect(skipped500).toMatchObject({ why: 'http-error', status: 500 });

      const skipped403 = result.skipped?.find((s) => s.urlPath === '/lab/forbidden');
      expect(skipped403).toMatchObject({ why: 'http-error', status: 403 });
    } finally {
      await context.close();
    }
  }, 60000);

  it('dead links (404) do not eat the maxPages budget; records real pages', async () => {
    const context = await browser.newContext();
    try {
      const spider = new DeterministicSpider([], 5);
      const result = await spider.crawl(context, `http://localhost:${RETRY_PORT}/`, {
        concurrency: 2,
      });

      // The 5 good pages plus '/' should be recorded up to maxPages (5)
      expect(result.pages.length).toBe(5);
      const recorded = new Set(result.pages.map((p) => p.urlPath));

      // None of the dead links are in pages
      for (let i = 1; i <= 50; i++) {
        expect(recorded.has(`/dead/${i}`)).toBe(false);
      }

      // No recorded page is in skipped
      const skippedPaths = (result.skipped || []).map((s) => s.urlPath);
      for (const p of recorded) {
        expect(skippedPaths).not.toContain(p);
      }
    } finally {
      await context.close();
    }
  }, 60000);

  it('a page whose first load times out and second succeeds is recorded with attempts: 2', async () => {
    retryReqCount = 0;
    const context = await browser.newContext();
    try {
      const spider = new DeterministicSpider();
      const result = await spider.crawl(context, `http://localhost:${RETRY_PORT}/retry-page`, {
        concurrency: 1,
      });

      expect(result.pages.map((p) => p.urlPath)).toContain('/retry-page');
      expect(result.routes).toBeDefined();
      const r = (result.routes ?? []).find((route) => route.requestedPath === '/retry-page');
      expect(r?.attempts).toBe(2);
      expect(r?.outcome).toBe('recorded');
    } finally {
      await context.close();
    }
  }, 60000);

  it('/lab/expiring as signed-in role: stops crawl, sessionLost is true, remainder reported session-lost', async () => {
    // Reset lab state and set maxRequests=1
    await fetch(`${fixtureUrl}/lab/reset`, { method: 'POST' });
    await fetch(`${fixtureUrl}/lab/expiring/start?n=1`, { method: 'POST' });

    // Seed session cookie
    const context = await browser.newContext({
      extraHTTPHeaders: {
        cookie: 'fixture_session=manager',
      },
    });

    try {
      const spider = new DeterministicSpider();
      const result = await spider.crawl(context, `${fixtureUrl}/lab/expiring`, {
        isSignedIn: true,
        role: 'manager',
        knownLoginPaths: ['/signin'],
        stopAfterWalls: 3,
        startPaths: ['/lab/expiring', '/lab/expiring/1', '/lab/expiring/2', '/lab/expiring/3', '/lab/expiring/4'],
      });

      expect(result.sessionLost).toBe(true);
      // Login page was not recorded as content
      const pagePaths = result.pages.map((p) => p.urlPath);
      expect(pagePaths).not.toContain('/signin');

      // The remaining queue is reported as session-lost in skipped
      const sessionLostEntries = (result.skipped || []).filter((s) => s.why === 'session-lost');
      expect(sessionLostEntries.length).toBeGreaterThanOrEqual(3);
    } finally {
      await context.close();
    }
  }, 60000);

  it('start address that redirects to another host: startRedirectedOffSite is true and site unchanged', async () => {
    const context = await browser.newContext();
    try {
      const spider = new DeterministicSpider();
      const result = await spider.crawl(context, `http://localhost:${OFFSITE_A_PORT}/`, {
        concurrency: 1,
      });

      expect(result.startRedirectedOffSite).toBe(true);
      expect(result.sessionLost).toBe(false);
      expect(result.pages.length).toBe(0);

      expect(result.routes).toBeDefined();
      const r = (result.routes ?? [])[0];
      expect(r).toBeDefined();
      expect(r?.skipReason).toBe('off-site-redirect');
    } finally {
      await context.close();
    }
  }, 60000);

  it('average gap between page loads with 4 workers and a 300 ms delay is >= 300 ms', async () => {
    pacingTimes.length = 0;
    const context = await browser.newContext();
    try {
      const spider = new DeterministicSpider([], 8);
      await spider.crawl(context, `http://localhost:${PACING_PORT}/`, {
        concurrency: 4,
        pageDelayMs: 300,
      });

      expect(pacingTimes.length).toBeGreaterThanOrEqual(5);
      const sorted = [...pacingTimes].sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        gaps.push(sorted[i] - sorted[i - 1]);
      }
      const avgGap = gaps.reduce((acc, g) => acc + g, 0) / gaps.length;
      // Allow minor timer jitter (e.g. >= 280ms)
      expect(avgGap).toBeGreaterThanOrEqual(280);
    } finally {
      await context.close();
    }
  }, 60000);

  it('a recorded page never also appears in skipped', async () => {
    const context = await browser.newContext();
    try {
      const spider = new DeterministicSpider();
      const result = await spider.crawl(context, `${fixtureUrl}/`, {
        concurrency: 2,
      });

      const recorded = new Set(result.pages.map((p) => p.urlPath));
      const skipped = (result.skipped || []).map((s) => s.urlPath);

      for (const s of skipped) {
        expect(recorded.has(s)).toBe(false);
      }
    } finally {
      await context.close();
    }
  }, 60000);
});
