/**
 * T-89 / ADR 0040: Website Audit crawl browser-tier tests.
 *
 * Uses real Playwright Chromium on mock pages via `context.route().fulfill()`
 * through the existing `deps.browserManager` and `deps.launchBrowser` seams.
 *
 * Test cases:
 * 1. a 12-page site recorded in full, with at most 3 pages in flight simultaneously.
 * 2. a robots Crawl-delay forces 1 in flight.
 * 3. a 503-then-200 page retried and recorded.
 * 4. a 500 page becomes a Skipped Page and a finding.
 * 5. a run of network failures pauses the crawl, which then resumes.
 * 6. a challenge page that never clears produces ERR_SITE_BLOCKED.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Route } from 'playwright';
import type { AuditProgressEvent, AuditRequest } from '@qa/types';
import { runAuditCrawl, type AuditBrowserLauncher, type AuditCrawlProgress } from '../src/audit/crawl/crawl.js';
import { AuditCrawlBlockedError } from '../src/audit/crawl/interstitial.js';
import { createSkippedPageFindings } from '../src/audit/pipeline/skipped-findings.js';
import type { NetDeps, PinnedRequest, RawResponse } from '../src/safe-net.js';

describe('audit-crawl-browser (T-89 browser tier)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
      ],
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  function makeNetDeps(customConnect?: (req: PinnedRequest) => Promise<RawResponse>): NetDeps {
    return {
      lookup: async () => ['93.184.216.34'],
      connect: async (req) => {
        if (customConnect) return customConnect(req);
        if (req.url.pathname === '/robots.txt') {
          return { status: 404, headers: {}, body: 'Not found' };
        }
        return { status: 200, headers: {}, body: 'OK' };
      },
    };
  }

  it('a 12-page site recorded in full, with at most 3 pages in flight simultaneously', async () => {
    const origin = 'https://twelve-page-site.example';
    let activeInFlight = 0;
    let maxInFlight = 0;

    const browserManager = {
      createContext: async (options?: any) => {
        const ctx = await browser.newContext(options);
        await ctx.route('**/*', async (route: Route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) {
            return route.fulfill({ status: 404, body: 'Not found' });
          }

          activeInFlight++;
          maxInFlight = Math.max(maxInFlight, activeInFlight);
          // Hold the turn slightly so concurrency has an opportunity to overlap
          await new Promise((r) => setTimeout(r, 60));
          activeInFlight--;

          if (url.pathname === '/' || url.pathname === '') {
            const links = Array.from({ length: 11 }, (_, i) => `<a href="/page-${i + 1}">Page ${i + 1}</a>`).join('\n');
            const html = `<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1><nav>${links}</nav></body></html>`;
            return route.fulfill({ status: 200, contentType: 'text/html', body: html });
          }

          const match = url.pathname.match(/^\/page-(\d+)$/);
          if (match) {
            const num = match[1];
            const html = `<!doctype html><html><head><title>Page ${num}</title></head><body><h1>Page ${num}</h1><p>Content for page ${num}</p></body></html>`;
            return route.fulfill({ status: 200, contentType: 'text/html', body: html });
          }

          return route.fulfill({ status: 404, body: 'Not found' });
        });
        return ctx;
      },
    };

    const request: AuditRequest = {
      url: `${origin}/`,
      limits: { maxPages: 20, maxDepth: 2, includePaths: [], excludePaths: [] },
      language: 'en',
    };

    const result = await runAuditCrawl(request, {
      allowPrivateAddresses: true,
      deps: {
        browserManager,
        netDeps: makeNetDeps(),
        minGapMs: 10,
      },
    });

    expect(result.pages).toHaveLength(12);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);

    const paths = result.pages.map((p) => p.urlPath).sort();
    expect(paths).toContain('/');
    for (let i = 1; i <= 11; i++) {
      expect(paths).toContain(`/page-${i}`);
    }
  });

  it('a robots Crawl-delay forces 1 in flight', async () => {
    const origin = 'https://crawl-delay-site.example';
    let activeInFlight = 0;
    let maxInFlight = 0;

    const launchBrowser: AuditBrowserLauncher = async () => ({
      newContext: async (options) => {
        const ctx = await browser.newContext(options);
        await ctx.route('**/*', async (route: Route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) {
            return route.fulfill({ status: 404, body: 'Not found' });
          }

          activeInFlight++;
          maxInFlight = Math.max(maxInFlight, activeInFlight);
          await new Promise((r) => setTimeout(r, 40));
          activeInFlight--;

          if (url.pathname === '/' || url.pathname === '') {
            const links = Array.from({ length: 4 }, (_, i) => `<a href="/slow-${i + 1}">Slow ${i + 1}</a>`).join('\n');
            const html = `<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1><nav>${links}</nav></body></html>`;
            return route.fulfill({ status: 200, contentType: 'text/html', body: html });
          }

          const match = url.pathname.match(/^\/slow-(\d+)$/);
          if (match) {
            const num = match[1];
            const html = `<!doctype html><html><head><title>Slow ${num}</title></head><body><h1>Slow ${num}</h1><p>Body ${num}</p></body></html>`;
            return route.fulfill({ status: 200, contentType: 'text/html', body: html });
          }

          return route.fulfill({ status: 404, body: 'Not found' });
        });
        return ctx;
      },
      close: async () => {},
    });

    const netDeps = makeNetDeps(async (req) => {
      if (req.url.pathname === '/robots.txt') {
        return {
          status: 200,
          headers: {},
          body: 'User-agent: *\nCrawl-delay: 1\n',
        };
      }
      return { status: 200, headers: {}, body: 'OK' };
    });

    const request: AuditRequest = {
      url: `${origin}/`,
      limits: { maxPages: 10, maxDepth: 3, includePaths: [], excludePaths: [] },
      language: 'en',
    };

    let clockTime = 1000;
    const now = () => clockTime;
    const sleep = async (ms: number) => {
      clockTime += ms;
    };

    const result = await runAuditCrawl(request, {
      allowPrivateAddresses: true,
      deps: {
        launchBrowser,
        netDeps,
        now,
        sleep,
      },
    });

    expect(result.crawlDelayMs).toBe(1000);
    expect(result.pacer.maxInFlight).toBe(1);
    expect(maxInFlight).toBe(1);
    expect(result.pages).toHaveLength(5);
  });

  it('a 503-then-200 page retried and recorded', async () => {
    const origin = 'https://retry-503-site.example';
    let retryAttempts = 0;
    const progressEvents: AuditCrawlProgress[] = [];

    const browserManager = {
      createContext: async (options?: any) => {
        const ctx = await browser.newContext(options);
        await ctx.route('**/*', async (route: Route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) {
            return route.fulfill({ status: 404, body: 'Not found' });
          }

          if (url.pathname === '/' || url.pathname === '') {
            const html =
              '<!doctype html><html><head><title>Home</title></head><body><nav><a href="/flaky">Flaky</a></nav></body></html>';
            return route.fulfill({ status: 200, contentType: 'text/html', body: html });
          }

          if (url.pathname === '/flaky') {
            retryAttempts++;
            if (retryAttempts === 1) {
              return route.fulfill({
                status: 503,
                headers: { 'retry-after': '1' },
                contentType: 'text/html',
                body: '<!doctype html><html><head><title>503 Service Unavailable</title></head><body>Busy</body></html>',
              });
            }
            return route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: '<!doctype html><html><head><title>Flaky Recovered</title></head><body><h1>Recovered Page</h1></body></html>',
            });
          }

          return route.fulfill({ status: 404, body: 'Not found' });
        });
        return ctx;
      },
    };

    const request: AuditRequest = {
      url: `${origin}/`,
      limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
      language: 'en',
    };

    const result = await runAuditCrawl(request, {
      allowPrivateAddresses: true,
      onProgress: (p) => progressEvents.push(p),
      deps: {
        browserManager,
        netDeps: makeNetDeps(),
        sleep: async () => {},
      },
    });

    expect(retryAttempts).toBe(2);
    expect(result.pages).toHaveLength(2);
    const flakyPage = result.pages.find((p) => p.urlPath === '/flaky');
    expect(flakyPage).toBeDefined();
    expect(flakyPage!.title).toBe('Flaky Recovered');

    const retryingEvent = progressEvents.find(
      (e) => 'type' in e && e.type === 'page' && e.path === '/flaky' && e.state === 'retrying'
    );
    expect(retryingEvent).toBeDefined();
  });

  it('a 500 page becomes a Skipped Page and a finding', async () => {
    const origin = 'https://error-500-site.example';

    const launchBrowser: AuditBrowserLauncher = async () => ({
      newContext: async (options) => {
        const ctx = await browser.newContext(options);
        await ctx.route('**/*', async (route: Route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) {
            return route.fulfill({ status: 404, body: 'Not found' });
          }

          if (url.pathname === '/' || url.pathname === '') {
            const html =
              '<!doctype html><html><head><title>Home</title></head><body><nav><a href="/internal-error">Broken</a></nav></body></html>';
            return route.fulfill({ status: 200, contentType: 'text/html', body: html });
          }

          if (url.pathname === '/internal-error') {
            return route.fulfill({
              status: 500,
              contentType: 'text/html',
              body: '<!doctype html><html><head><title>500 Internal Error</title></head><body>Crash</body></html>',
            });
          }

          return route.fulfill({ status: 404, body: 'Not found' });
        });
        return ctx;
      },
      close: async () => {},
    });

    const request: AuditRequest = {
      url: `${origin}/`,
      limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
      language: 'en',
    };

    const result = await runAuditCrawl(request, {
      allowPrivateAddresses: true,
      deps: {
        launchBrowser,
        netDeps: makeNetDeps(),
      },
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].urlPath).toBe('/');

    const skipped = result.coverage.skipped.find((s) => s.urlPath === '/internal-error');
    expect(skipped).toBeDefined();
    expect(skipped!.why).toBe('http-error');
    expect(skipped!.status).toBe(500);

    let nextFindingId = 1;
    const findings = createSkippedPageFindings(result.coverage.skipped, {
      next: () => `F-SKIP-${nextFindingId++}`,
    });

    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.rule).toBe('http-error');
    expect(f.severity).toBe('Major');
    expect(f.urlPath).toBe('/internal-error');
    expect(f.title).toContain('500');
    expect(f.detail).toContain('/internal-error');
  });

  it('a run of network failures pauses the crawl, which then resumes', async () => {
    const origin = 'https://outage-site.example';
    let p1Attempts = 0;
    let p2Attempts = 0;
    let p3Attempts = 0;
    let probeCalls = 0;

    const browserManager = {
      createContext: async (options?: any) => {
        const ctx = await browser.newContext(options);
        await ctx.route('**/*', async (route: Route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) {
            return route.fulfill({ status: 404, body: 'Not found' });
          }

          if (url.pathname === '/' || url.pathname === '') {
            const html = `<!doctype html><html><head><title>Home</title></head><body>
              <nav>
                <a href="/p1">P1</a>
                <a href="/p2">P2</a>
                <a href="/p3">P3</a>
              </nav>
            </body></html>`;
            return route.fulfill({ status: 200, contentType: 'text/html', body: html });
          }

          if (url.pathname === '/p1') {
            p1Attempts++;
            if (p1Attempts <= 2) return route.abort('failed');
            return route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: '<!doctype html><html><head><title>P1 OK</title></head><body><h1>P1 OK</h1><nav><a href="/p4">P4</a></nav></body></html>',
            });
          }
          if (url.pathname === '/p2') {
            p2Attempts++;
            if (p2Attempts <= 2) return route.abort('failed');
            return route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: '<!doctype html><html><head><title>P2 OK</title></head><body><h1>P2 OK</h1></body></html>',
            });
          }
          if (url.pathname === '/p3') {
            p3Attempts++;
            if (p3Attempts <= 2) return route.abort('failed');
            return route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: '<!doctype html><html><head><title>P3 OK</title></head><body><h1>P3 OK</h1></body></html>',
            });
          }
          if (url.pathname === '/p4') {
            return route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: '<!doctype html><html><head><title>P4 OK</title></head><body><h1>P4 OK</h1></body></html>',
            });
          }

          return route.fulfill({ status: 404, body: 'Not found' });
        });
        return ctx;
      },
    };

    const netDeps = makeNetDeps(async (req) => {
      if (req.url.pathname === '/robots.txt') {
        return { status: 404, headers: {}, body: 'Not found' };
      }
      probeCalls++;
      await new Promise((r) => setTimeout(r, 60));
      return { status: 200, headers: {}, body: 'Probe OK' };
    });

    const request: AuditRequest = {
      url: `${origin}/`,
      limits: { maxPages: 10, maxDepth: 3, includePaths: [], excludePaths: [] },
      language: 'en',
    };

    let clockTime = 1000;
    const now = () => clockTime;
    const sleep = async (ms: number) => {
      clockTime += ms;
    };

    const result = await runAuditCrawl(request, {
      allowPrivateAddresses: true,
      deps: {
        browserManager,
        netDeps,
        now,
        sleep,
        retryDelayMs: 50,
      },
    });

    expect(probeCalls).toBeGreaterThanOrEqual(1);
    expect(result.stoppedAnsweringAfter).toBeUndefined();
    expect(result.pages).toHaveLength(5);
    const recordedPaths = result.pages.map((p) => p.urlPath).sort();
    expect(recordedPaths).toEqual(['/', '/p1', '/p2', '/p3', '/p4']);
  });

  it('a challenge page that never clears produces ERR_SITE_BLOCKED', async () => {
    const origin = 'https://challenge-site.example';

    const launchBrowser: AuditBrowserLauncher = async () => ({
      newContext: async (options) => {
        const ctx = await browser.newContext(options);
        await ctx.route('**/*', async (route: Route) => {
          return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: `<!doctype html><html><head><title>Just a moment...</title></head><body>
              <p>Checking your browser before accessing the website.</p>
            </body></html>`,
          });
        });
        return ctx;
      },
      close: async () => {},
    });

    const request: AuditRequest = {
      url: `${origin}/`,
      limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
      language: 'en',
    };

    await expect(
      runAuditCrawl(request, {
        allowPrivateAddresses: true,
        deps: {
          launchBrowser,
          netDeps: makeNetDeps(),
        },
      })
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(AuditCrawlBlockedError);
      expect(err.code).toBe('ERR_SITE_BLOCKED');
      expect(err.kind).toBe('bot-check');
      return true;
    });
  });
});
