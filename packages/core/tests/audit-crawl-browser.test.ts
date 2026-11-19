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
 * 7. T-407: stopping after 60 of 100 pages, then resuming from the checkpoint, records 100 pages once each.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Route } from 'playwright';
import type { AuditRequest } from '@qa/types';
import { runAuditCrawl, type AuditBrowserLauncher, type AuditCrawlProgress } from '../src/audit/crawl/crawl.js';
import { AuditCrawlBlockedError } from '../src/audit/crawl/interstitial.js';
import { createSkippedPageFindings } from '../src/audit/pipeline/skipped-findings.js';
import { createPageRecorder, type PageStages } from '../src/audit/pipeline/page-recorder.js';
import { createAuditCheckpointer, loadAuditCheckpoint } from '../src/audit/pipeline/pipeline.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    // Starts at 3; it climbs only after 25 healthy answers (ADR 0046), and a 12-page site gives fewer.
    expect(result.pacer.ceiling).toBe(8);
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
    // On a local runner the ceiling would be 8 (ADR 0046); a Crawl-delay keeps it at 1 for the whole audit.
    expect(result.pacer.ceiling).toBe(1);
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

  it('T-407: stopping after 60 of 100 routed pages, then resuming, records 100 pages with no duplicates', async () => {
    const origin = 'https://resume-site.example';
    const loads = new Map<string, number>();
    const browserManager = {
      createContext: async (options?: any) => {
        const ctx = await browser.newContext(options);
        await ctx.route('**/*', async (route: Route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.fulfill({ status: 404, body: 'Not found' });
          loads.set(url.pathname, (loads.get(url.pathname) ?? 0) + 1);
          // Slow enough that several pages are in flight when the stop comes.
          await new Promise((r) => setTimeout(r, 20));
          if (url.pathname === '/') {
            const links = Array.from({ length: 99 }, (_, i) => `<a href="/p-${i + 1}">Page ${i + 1}</a>`).join('');
            return route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: `<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1>${links}</body></html>`,
            });
          }
          const match = /^\/p-(\d+)$/.exec(url.pathname);
          if (match) {
            return route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: `<!doctype html><html><head><title>Page ${match[1]}</title></head><body><h1>Page ${match[1]}</h1></body></html>`,
            });
          }
          return route.fulfill({ status: 404, body: 'Not found' });
        });
        return ctx;
      },
    };
    // Cheap page stages: the test is about which pages are recorded, not what is on them.
    const stages: Partial<PageStages> = {
      readPage: (async (page: any) => ({ raw: {}, content: { title: await page.title() } })) as any,
      accessibilityBasics: (async () => ({ basics: null, findings: [] })) as any,
      recordPhoneLayout: (async () => ({
        phone: { screenshotPath: null, findingIds: [], overflow: null },
        findings: [],
      })) as any,
      measureBrowserTiming: (async () => ({ speed: { status: 'not-measured' } })) as any,
    };
    const json = new Map<string, unknown>();
    const files = new Map<string, Uint8Array>();
    const store = {
      writeVersionJson: async (_a: string, _v: number, name: string, value: unknown) => {
        json.set(name, JSON.parse(JSON.stringify(value)));
      },
      readVersionJson: async <T>(_a: string, _v: number, name: string) => (json.get(name) ?? null) as T | null,
      putVersionFile: async (_a: string, _v: number, name: string, data: Uint8Array) => {
        files.set(name, data);
      },
      getVersionFile: async (_a: string, _v: number, name: string) => files.get(name) ?? null,
    };
    const request: AuditRequest = {
      url: `${origin}/`,
      limits: { maxPages: 100, maxDepth: 2, includePaths: [], excludePaths: [] },
      language: 'en',
    };
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-resume-test-'));
    try {
      // First run: stopped once 60 pages are recorded, with others still loading.
      const recorder1 = createPageRecorder({ workDir, stages });
      const stop = new AbortController();
      let seen = 0;
      await runAuditCrawl(request, {
        allowPrivateAddresses: true,
        signal: stop.signal,
        onRenderedPage: async (page, info, context) => {
          await recorder1.onRenderedPage(page, info, context);
          if (++seen === 60) stop.abort();
        },
        checkpoint: {
          save: createAuditCheckpointer({
            store: store as any,
            auditId: 'a',
            version: 1,
            recorder: recorder1,
            workDir,
          }),
        },
        deps: { browserManager, netDeps: makeNetDeps(), minGapMs: 1 },
      });
      expect(stop.signal.aborted).toBe(true);

      const loaded = await loadAuditCheckpoint(store as any, 'a', 1, workDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.crawl.crawlDone).toBe(false);
      expect(loaded!.pages.length).toBeGreaterThanOrEqual(50);
      expect(loaded!.pages.length).toBeLessThan(100);
      expect(loaded!.pages.every((p) => p.labDone)).toBe(true);

      // Resume: the saved pages come back, the crawl carries on from the checkpoint with the same limits.
      const recorder2 = createPageRecorder({ workDir, stages });
      recorder2.restore(loaded!.pages);
      const result = await runAuditCrawl(request, {
        allowPrivateAddresses: true,
        resume: loaded!.crawl,
        onRenderedPage: recorder2.onRenderedPage,
        checkpoint: {
          save: createAuditCheckpointer({
            store: store as any,
            auditId: 'a',
            version: 1,
            recorder: recorder2,
            workDir,
            restored: loaded!,
          }),
        },
        deps: { browserManager, netDeps: makeNetDeps(), minGapMs: 1 },
      });

      const paths = result.pages.map((p) => p.urlPath);
      expect(paths).toHaveLength(100);
      expect(new Set(paths).size).toBe(100);
      const recorded = recorder2.pages.map((p) => p.info.urlPath);
      expect(recorded).toHaveLength(100);
      expect(new Set(recorded).size).toBe(100);
      expect(result.coverage.skipped.filter((s) => paths.includes(s.urlPath))).toEqual([]);
      // The start page was not loaded again on resume (once by the crawl, once by its lab work).
      expect(loads.get('/')).toBeLessThanOrEqual(2);
      const final = await loadAuditCheckpoint(store as any, 'a', 1, workDir);
      expect(final?.crawl.crawlDone).toBe(true);
      expect(final?.pages).toHaveLength(100);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 300_000);
});
