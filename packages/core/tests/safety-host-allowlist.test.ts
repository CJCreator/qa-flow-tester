import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { chromium, type Browser, type Route } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import type { PreFlightResult } from '../src/preflight.js';
import { inDomainAllowlist } from '../src/same-site.js';
import type { TestCase } from '@qa/types';

// T-424: the Domain Allowlist on every request. Routed pages, plus one loopback server for a real redirect
// (a route never sees a redirect hop, so a fulfilled 302 cannot stand in for one). No real site (ADR 0040).
const html = (body: string) =>
  `<!doctype html><html><head><title>Site</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Site</h1>${body}</main></body></html>`;

describe('inDomainAllowlist', () => {
  it('holds the site, its www twin and ticked hosts; a private Test Copy reaches its other private hosts', () => {
    const site = 'https://example.com/';
    expect(inDomainAllowlist(new URL('https://www.example.com/a'), site)).toBe(true);
    expect(inDomainAllowlist(new URL('https://api.example.com/a'), site)).toBe(true);
    expect(inDomainAllowlist(new URL('https://api.app.com/a'), 'https://www.app.com/')).toBe(true);
    expect(inDomainAllowlist(new URL('https://cdn.app.com/a'), 'https://www.app.com/')).toBe(true);
    expect(inDomainAllowlist(new URL('https://api.other.com/a'), 'https://www.app.com/')).toBe(false);
    expect(inDomainAllowlist(new URL('https://api.other.com/a'), 'https://www.app.com/', ['api.other.com'])).toBe(true);
    expect(inDomainAllowlist(new URL('https://9.9.3.4/a'), 'https://1.2.3.4/')).toBe(false);
    expect(inDomainAllowlist(new URL('http://localhost:4000/api'), 'http://localhost:3000/')).toBe(true);
    expect(inDomainAllowlist(new URL('http://localhost:4000/api'), site)).toBe(false);
    expect(inDomainAllowlist(new URL('data:text/html,x'), site)).toBe(false);
  });
});

describe('the Spider keeps to the Domain Allowlist (T-424)', () => {
  let browser: Browser;
  let server: http.Server;
  let port = 0;
  const otherHostHits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const host = (req.headers.host ?? '').split(':')[0];
      if (host === 'other.test') otherHostHits.push(req.url ?? '');
      if (host === 'site.test' && req.url === '/go') {
        res.writeHead(302, { location: `http://other.test:${port}/landing` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      if (host === 'site.test' && req.url === '/') {
        res.end(html('<a href="/go">Partner offer</a>'));
        return;
      }
      res.end(html(`<p>${host}</p><a href="/deeper">Deeper</a>`));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
    browser = await chromium.launch({
      headless: true,
      args: [`--host-resolver-rules=MAP site.test 127.0.0.1, MAP other.test 127.0.0.1`],
    });
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('a page that redirects to another host is a Skipped Page (off-site-redirect) and nothing on it is read', async () => {
    const context = await browser.newContext();
    try {
      const result = await new DeterministicSpider([], 10).crawl(context, `http://site.test:${port}/`, {
        seedSitemap: false,
        followFormActions: false,
        exploreClicks: false,
        maxDurationMs: 30_000,
        pageDelayMs: 0,
        outboundFetch: async () => null,
      });
      expect(result.skipped).toEqual(
        expect.arrayContaining([expect.objectContaining({ urlPath: '/go', why: 'off-site-redirect' })])
      );
      expect(result.pages.map((p) => p.urlPath)).toEqual(['/']);
      // The hop itself reaches the other host (a route cannot stop it); nothing after it does.
      expect(otherHostHits).toEqual(['/landing']);
    } finally {
      await context.close();
    }
  }, 60_000);

  it('an iframe whose src is another host is not loaded; a script from another host still is', async () => {
    const context = await browser.newContext();
    const seen: string[] = [];
    await context.route('**/*', (route: Route) => {
      const u = new URL(route.request().url());
      seen.push(`${route.request().resourceType()} ${u.host}${u.pathname}`);
      if (u.host === 'cdn.example') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '1;' });
      if (u.host !== 'shop.example') return route.fulfill({ status: 200, contentType: 'text/html', body: html('x') });
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: html(
          `<script src="https://cdn.example/lib.js"></script><iframe src="https://video.example/embed"></iframe>`
        ),
      });
    });
    try {
      await new DeterministicSpider([], 10).crawl(context, 'https://shop.example/', {
        seedSitemap: false,
        followFormActions: false,
        exploreClicks: false,
        maxDurationMs: 30_000,
        pageDelayMs: 0,
        outboundFetch: async () => null,
      });
      expect(seen).toContain('script cdn.example/lib.js');
      expect(seen.filter((s) => s.includes('video.example'))).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);
});

describe('a Check-up keeps to the Domain Allowlist (T-424)', () => {
  let tmpDir: string | undefined;
  const origCreateContext = BrowserManager.prototype.createContext;
  const preflight = {
    ok: true,
    roleAuthResults: {},
    roleStorageStates: {},
    roleLandingPaths: {},
    roleFailures: {},
    roleDiagnostics: {},
  } as PreFlightResult;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  });

  it('a POST to another host from page script is aborted and noted; a script from another host loads', async () => {
    const seen: string[] = [];
    vi.spyOn(BrowserManager.prototype, 'createContext').mockImplementation(async function (
      this: BrowserManager,
      options
    ) {
      const context = await origCreateContext.call(this, options);
      await context.route('**/*', (route: Route) => {
        const u = new URL(route.request().url());
        seen.push(`${route.request().method()} ${u.host}${u.pathname}`);
        if (u.host === 'cdn.example')
          return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.cdnLoaded = true;' });
        if (u.host !== 'test.local') return route.fulfill({ status: 204, body: '' });
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: html(
            `<script src="https://cdn.example/lib.js"></script>
             <script>fetch('https://collector.example/collect', { method: 'POST', body: 'x' }).catch(() => {});</script>`
          ),
        });
      });
      return context;
    });
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safety-host-allowlist-'));
    const tc: TestCase = {
      id: 'TC-HOSTS',
      flowId: 'flow-hosts',
      name: 'Home',
      role: 'visitor',
      startPage: '/',
      kind: 'page-test',
      steps: [{ action: 'wait', name: 'Wait' }],
      expectations: {},
    };
    const report = await new FlowTestOrchestrator().run({
      targetUrl: 'http://test.local',
      productId: 'hosts',
      specTestCases: [tc],
      preflight,
      outputDir: tmpDir,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      recordVideo: false,
      readOnly: false,
      testCopy: true,
    });
    expect(seen).toContain('GET cdn.example/lib.js');
    expect(seen.filter((s) => s.includes('collector.example'))).toEqual([]);
    expect((report.notes ?? []).join('\n')).toContain('collector.example');
    expect(report.results[0].status).toBe('Passed');
  }, 60_000);
});
