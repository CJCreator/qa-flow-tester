/**
 * BE-204: the Website Audit crawl against fixtures/audit-site (REQ-002 to REQ-006, REQ-036, with G1's
 * REQ-034/REQ-035 end to end). The browser reaches the fixture as http://kaveri.test:<port> through a
 * host-resolver rule, and the production request guard and outbound fetches see a fake DNS that gives
 * kaveri.test a public address: the public-only checks run unchanged and nothing else resolves.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
} from 'playwright';
import type { AuditRequest } from '@qa/types';
import {
  runAuditCrawl,
  pathLimitVerdict,
  checkAuditAddress,
  isCheckoutPath,
  pageAreaVerdict,
  AuditCrawlRefusedError,
  type AuditBrowserLauncher,
  type AuditCrawlDeps,
  type AuditCrawlProgress,
  type AuditCrawlResult,
} from '../src/audit/crawl/index.js';
import { AUDIT_MIN_GAP_MS } from '../src/audit/crawl/crawl.js';
import { setBrowserPolicy } from '../src/browser.js';
import { HostPacer } from '../src/host-pacer.js';
import { defaultNetDeps, type NetDeps } from '../src/safe-net.js';
import { AUDIT_SITE_PAGES as P, startAuditSite, type AuditSiteServer } from './helpers/audit-site-server.js';

const SITE_HOST = 'kaveri.test';
const PLAIN_HOST = 'plain.test';
/** A public address for the fake DNS; connections are sent to 127.0.0.1 instead. */
const PUBLIC_ADDRESS = '93.184.216.34';
const SECRET = 's3cret-value';

let browser: Browser;
let site: AuditSiteServer;
let plain: { port: number; requests: Array<{ method: string; path: string }>; close: () => Promise<void> };
/** Every name the guard or an outbound fetch looked up, and every URL an outbound fetch connected to. */
const lookups: string[] = [];
const connects: string[] = [];
/** Every request the browser made, before the guard decided. */
const browserRequests: Array<{ method: string; url: string }> = [];

const netDeps: NetDeps = {
  async lookup(host) {
    lookups.push(host);
    if (host === SITE_HOST || host === PLAIN_HOST) return [PUBLIC_ADDRESS];
    throw new Error('ENOTFOUND');
  },
  connect(req) {
    connects.push(req.url.toString());
    return defaultNetDeps.connect({ ...req, address: '127.0.0.1' });
  },
};

const browserManager: AuditCrawlDeps['browserManager'] = {
  async createContext(): Promise<BrowserContext> {
    const context = await browser.newContext();
    context.on('request', (r) => browserRequests.push({ method: r.method(), url: r.url() }));
    return context;
  },
};

const deps: AuditCrawlDeps = { browserManager, netDeps };

function auditRequest(url: string, limits: Partial<AuditRequest['limits']> = {}): AuditRequest {
  return {
    url,
    limits: { maxPages: 200, maxDepth: 8, includePaths: [], excludePaths: [], ...limits },
    language: 'en',
  };
}

const siteUrl = (p: string) => `http://${SITE_HOST}:${site.port}${p}`;
const requestedPaths = () => site.requests.map((r) => new URL(r.path, 'http://x.invalid').pathname);
const recordedPaths = (r: AuditCrawlResult) => r.pages.map((p) => new URL(p.urlPath, 'http://x.invalid').pathname);
const skippedAs = (r: AuditCrawlResult, why: string) =>
  r.coverage.skipped.filter((s) => s.why === why).map((s) => s.urlPath);

/** A small site with no robots.txt and no sitemap.xml, a page answering 401 and a link with a secret query. */
async function startPlainSite() {
  const requests: Array<{ method: string; path: string }> = [];
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
  const server = http.createServer((req, res) => {
    const path = req.url || '/';
    requests.push({ method: req.method || 'GET', path });
    const pathname = new URL(path, 'http://x.invalid').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        page(
          'Plain home',
          `<a href="/about?token=${SECRET}">About</a> <a href="/members">Members</a> <a href="/contact">Contact</a>`
        )
      );
    } else if (pathname === '/about' || pathname === '/contact') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(pathname.slice(1), '<p>Plain page.</p> <a href="/">Home</a>'));
    } else if (pathname === '/members') {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page('Members only', '<p>Please sign in.</p>'));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

beforeAll(async () => {
  site = await startAuditSite();
  plain = await startPlainSite();
  browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1, MAP ${PLAIN_HOST} 127.0.0.1`],
  });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
  await plain?.close();
});

describe('crawl barrel', () => {
  it('exports the crawl, the address check, the limits and the area rules', () => {
    expect(typeof runAuditCrawl).toBe('function');
    expect(typeof checkAuditAddress).toBe('function');
    expect(typeof pathLimitVerdict).toBe('function');
    expect(typeof isCheckoutPath).toBe('function');
    expect(typeof pageAreaVerdict).toBe('function');
  });
});

describe('runAuditCrawl with default limits', () => {
  let result: AuditCrawlResult;
  const events: AuditCrawlProgress[] = [];
  const renderedText = new Map<string, string>();

  beforeAll(async () => {
    site.clearRequests();
    lookups.length = 0;
    connects.length = 0;
    browserRequests.length = 0;
    result = await runAuditCrawl(auditRequest(siteUrl('/')), {
      deps,
      onProgress: (e) => events.push(e),
      onRenderedPage: async (page, info) => {
        renderedText.set(info.urlPath, (await page.textContent('body')) ?? '');
      },
    });
  }, 180_000);

  it('records the pages the home page links to on the same host (REQ-003 AC-1)', () => {
    const recorded = recordedPaths(result);
    for (const p of [
      P.home,
      P.about,
      P.services,
      P.duplicateA,
      P.duplicateB,
      P.gallery,
      P.blog,
      P.shop,
      P.tamil,
      P.hindi,
      P.jsRendered,
    ]) {
      expect(recorded, p).toContain(p);
    }
    expect(result.startUrl).toBe(siteUrl('/'));
    expect(result.finalUrl).toBe(siteUrl('/'));
    expect(result.pages.find((p) => p.urlPath === '/')?.depth).toBe(0);
    expect(result.coverage.reached).toBe(result.pages.length);
    expect(result.coverage.found).toBe(result.pages.length + result.coverage.skipped.length);
  });

  it('lists Facebook and Instagram links in leavingSite with their pages, never requesting them (REQ-003 AC-2)', () => {
    for (const host of ['facebook.com', 'instagram.com']) {
      const entry = result.leavingSite.find((l) => new URL(l.to).hostname.endsWith(host));
      expect(entry, host).toBeDefined();
      expect(entry!.from).toContain('/');
      expect(
        browserRequests.some((r) => r.url.includes(host)),
        `browser asked for ${host}`
      ).toBe(false);
      expect(
        lookups.some((h) => h.endsWith(host)),
        `looked up ${host}`
      ).toBe(false);
    }
  });

  it('submits no form: no POST and no form action requested (REQ-003 AC-3)', () => {
    expect(site.requests.every((r) => r.method === 'GET' || r.method === 'HEAD')).toBe(true);
    expect(browserRequests.filter((r) => r.method !== 'GET')).toEqual([]);
    const paths = requestedPaths();
    expect(paths).not.toContain('/enquiry');
    expect(paths).not.toContain('/shop/checkout/pay');
    expect(site.requests.filter((r) => r.path.startsWith('/account/sign-in') && r.method !== 'GET')).toEqual([]);
  });

  it('records the sitemap-only page, and each page once (REQ-004 AC-1, AC-2)', () => {
    const recorded = recordedPaths(result);
    expect(recorded).toContain(P.sitemapOnly);
    expect(new Set(recorded).size).toBe(recorded.length);
    // /about is both linked and in sitemap.xml.
    expect(recorded.filter((p) => p === P.about)).toHaveLength(1);
  });

  it('records a link inserted by JavaScript and hands the rendered page to onRenderedPage (REQ-005 AC-1)', () => {
    expect(recordedPaths(result)).toContain(P.jsOnlyTarget);
    expect(renderedText.get(P.jsRendered)).toContain('Diwali gift boxes are ready');
    expect(renderedText.get(P.jsRendered)).toContain('See our festival opening hours');
  });

  it('flags the sign-in page as a sign-in wall and a Skipped Page, entering nothing (REQ-006 AC-1)', () => {
    expect(result.signInWalls).toContain(P.signIn);
    expect(skippedAs(result, 'sign-in')).toContain(P.signIn);
    expect(recordedPaths(result)).not.toContain(P.signIn);
    expect(site.requests.filter((r) => r.path.startsWith(P.signIn)).every((r) => r.method === 'GET')).toBe(true);
  });

  it('flags the checkout as a payment area, never opening it or what only it links to (REQ-036 AC-1)', () => {
    expect(result.paymentAreas).toContain(P.checkout);
    expect(skippedAs(result, 'payment')).toContain(P.checkout);
    const paths = requestedPaths();
    expect(paths.filter((p) => p.startsWith(P.checkout))).toEqual([]);
    expect(paths).not.toContain(P.checkoutOnlyTarget);
    expect(recordedPaths(result)).not.toContain(P.checkoutOnlyTarget);
  });

  it('skips robots.txt-disallowed pages and never fetches the off-site Sitemap line (REQ-034)', () => {
    const robots = skippedAs(result, 'robots');
    expect(robots).toContain(P.privateLinked);
    expect(robots).toContain(P.privateSitemapOnly);
    // The result carries the policy the crawl followed, for the link check (F-054).
    expect(result.robots?.isAllowed(P.privateLinked)).toBe(false);
    expect(result.robots?.isAllowed(P.about)).toBe(true);
    const paths = requestedPaths();
    expect(paths).not.toContain(P.privateLinked);
    expect(paths).not.toContain(P.privateSitemapOnly);
    expect(lookups.some((h) => h.includes('example.invalid'))).toBe(false);
    expect(connects.some((u) => u.includes('example.invalid'))).toBe(false);
    expect(paths).toContain('/robots.txt');
    expect(paths).toContain('/sitemap.xml');
  });

  it('carries the pacer the crawl used and the robots.txt Crawl-delay of the fixture (ADR 0015)', () => {
    expect(result.pacer).toBeInstanceOf(HostPacer);
    expect(result.crawlDelayMs).toBe(1000);
    expect(result.pacer.gapMs).toBe(Math.max(AUDIT_MIN_GAP_MS, 1000));
  });

  it('reports progress as pages are recorded and skipped, ending with the final counts', () => {
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.stage === 'crawling')).toBe(true);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].pagesRecorded).toBeGreaterThanOrEqual(events[i - 1].pagesRecorded);
    }
    expect(events.some((e) => e.pagesSkipped > 0 && e.pagesRecorded > 0)).toBe(true);
    const last = events[events.length - 1];
    expect(last.pagesRecorded).toBe(result.pages.length);
    expect(last.pagesSkipped).toBe(result.coverage.skipped.length);
    expect(last.pagesFound).toBe(result.coverage.found);
  });
});

describe('runAuditCrawl limits (REQ-002)', () => {
  it('records at most maxPages pages; the rest are page-limit Skipped Pages (AC-1)', async () => {
    const result = await runAuditCrawl(auditRequest(siteUrl('/'), { maxPages: 3 }), { deps });
    expect(result.pages.length).toBeLessThanOrEqual(3);
    expect(result.pages.length).toBeGreaterThan(0);
    expect(skippedAs(result, 'page-limit').length).toBeGreaterThan(0);
  }, 120_000);

  it('does not record pages beyond maxDepth 3; they are depth-limit Skipped Pages (AC-2)', async () => {
    const result = await runAuditCrawl(auditRequest(siteUrl('/'), { maxDepth: 3 }), { deps });
    const recorded = recordedPaths(result);
    expect(recorded).toContain('/blog/2025/diwali');
    expect(recorded).not.toContain(P.depth4);
    expect(recorded).not.toContain(P.depth5);
    expect(skippedAs(result, 'depth-limit')).toContain(P.depth4);
    expect(result.pages.every((p) => p.depth <= 3)).toBe(true);
  }, 180_000);

  it('never requests or records an excluded path; each is an excluded Skipped Page (AC-3)', async () => {
    site.clearRequests();
    const result = await runAuditCrawl(auditRequest(siteUrl('/'), { excludePaths: ['/blog'] }), { deps });
    expect(recordedPaths(result).filter((p) => p === '/blog' || p.startsWith('/blog/'))).toEqual([]);
    expect(requestedPaths().filter((p) => p === '/blog' || p.startsWith('/blog/'))).toEqual([]);
    expect(skippedAs(result, 'excluded')).toContain(P.blog);
    expect(result.pages.length).toBeGreaterThan(1);
  }, 180_000);

  it('with include path /services records only /services pages besides the start page (AC-4)', async () => {
    const result = await runAuditCrawl(auditRequest(siteUrl('/'), { includePaths: ['/services'] }), { deps });
    const recorded = recordedPaths(result);
    expect(recorded).toContain('/');
    expect(recorded).toContain(P.services);
    for (const p of recorded.filter((x) => x !== '/')) expect(p.startsWith('/services'), p).toBe(true);
    expect(skippedAs(result, 'excluded')).toContain(P.about);
  }, 120_000);
});

describe('runAuditCrawl on a site with no sitemap and a 401 page', () => {
  it('crawls from links, flags the 401 page as a sign-in wall and keeps secrets out of progress (REQ-004 AC-3, REQ-006)', async () => {
    const events: AuditCrawlProgress[] = [];
    const result = await runAuditCrawl(auditRequest(`http://${PLAIN_HOST}:${plain.port}/`), {
      deps,
      onProgress: (e) => events.push(e),
    });
    const recorded = recordedPaths(result);
    expect(recorded).toEqual(expect.arrayContaining(['/', '/about', '/contact']));
    expect(result.signInWalls).toContain('/members');
    expect(skippedAs(result, 'sign-in')).toContain('/members');
    expect(skippedAs(result, 'robots')).toEqual([]);
    // No robots.txt: no Crawl-delay, and the pacer keeps the default gap.
    expect(result.crawlDelayMs).toBeNull();
    expect(result.pacer.gapMs).toBe(AUDIT_MIN_GAP_MS);
    expect(plain.requests.every((r) => r.method === 'GET' || r.method === 'HEAD')).toBe(true);
    // The secret query reached the site (it is in the page's link) but never a progress event.
    expect(events.some((e) => e.currentPath?.startsWith('/about'))).toBe(true);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(result.pages.map((p) => p.urlPath))).not.toContain(SECRET);
  }, 120_000);
});

describe('runAuditCrawl robots.txt Crawl-delay', () => {
  it('returns the Crawl-delay and a pacer whose gap honours it (ADR 0015)', async () => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://x.invalid').pathname;
      if (pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nCrawl-delay: 1\n');
      } else if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!doctype html><html lang="en"><head><title>Slow</title></head><body><main><p>Hi</p></main></body></html>'
        );
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      const r = await runAuditCrawl(auditRequest(`http://${PLAIN_HOST}:${port}/`), { deps });
      expect(r.crawlDelayMs).toBe(1000);
      expect(r.pacer).toBeInstanceOf(HostPacer);
      expect(r.pacer.gapMs).toBe(1000);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});

describe('runAuditCrawl stopping and guarding', () => {
  it('an aborted signal returns what was found so far', async () => {
    const controller = new AbortController();
    const result = await runAuditCrawl(auditRequest(siteUrl('/')), {
      deps,
      signal: controller.signal,
      onProgress: (e) => {
        if (e.pagesRecorded >= 2) controller.abort();
      },
    });
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.pages.length).toBeLessThan(10);
    expect(result.coverage.reached).toBe(result.pages.length);
  }, 120_000);

  it('by default a loopback start address is refused before any request or browser context', async () => {
    site.clearRequests();
    let contexts = 0;
    const counting: AuditCrawlDeps['browserManager'] = {
      async createContext() {
        contexts++;
        return browserManager!.createContext({});
      },
    };
    const err = await runAuditCrawl(auditRequest(site.url('/')), { deps: { browserManager: counting } }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(AuditCrawlRefusedError);
    expect((err as AuditCrawlRefusedError).code).toBe('ERR_PRIVATE_ADDRESS');
    expect(contexts).toBe(0);
    expect(site.requests).toEqual([]);
  }, 120_000);

  it('the public-only guard still stops every request when the name turns private after the start check', async () => {
    site.clearRequests();
    // DNS rebinding: public for the start check, loopback for every later lookup (the guard's included).
    let first = true;
    const rebinding: NetDeps = {
      async lookup(host) {
        if (first && host === SITE_HOST) {
          first = false;
          return [PUBLIC_ADDRESS];
        }
        return ['127.0.0.1'];
      },
      connect: netDeps.connect,
    };
    const result = await runAuditCrawl(auditRequest(siteUrl('/')), { deps: { browserManager, netDeps: rebinding } });
    expect(result.pages).toEqual([]);
    expect(site.requests).toEqual([]);
  }, 120_000);
});

describe('runAuditCrawl pins the audited host in its own Chromium (F-051) and blocks service workers (F-052)', () => {
  const STOP = 'fake browser: stop here';
  const START = 'https://shop.test/';
  const V6 = '2606:2800:220:1:248:1893:25c8:1946';

  /** A fake DNS and network: nothing real is looked up or connected. robots.txt answers 404. */
  function fakeNet(answers: Record<string, string[]>) {
    const looked: string[] = [];
    const connected: string[] = [];
    const net: NetDeps = {
      async lookup(host) {
        looked.push(host);
        const found = answers[host];
        if (!found) throw new Error('ENOTFOUND');
        return found;
      },
      async connect(req) {
        connected.push(req.url.toString());
        return { status: 404, headers: {}, body: '' };
      },
    };
    return { net, looked, connected };
  }

  /** A fake launcher: records the launch and context options; opening the context stops the crawl. */
  function fakeLauncher() {
    const launches: LaunchOptions[] = [];
    const contexts: BrowserContextOptions[] = [];
    let closed = 0;
    const launchBrowser: AuditBrowserLauncher = async (options) => {
      launches.push(options);
      return {
        async newContext(o?: BrowserContextOptions): Promise<BrowserContext> {
          contexts.push(o ?? {});
          throw new Error(STOP);
        },
        async close() {
          closed++;
        },
      };
    };
    return { launchBrowser, launches, contexts, closed: () => closed };
  }

  const resolverRules = (launch: LaunchOptions | undefined) =>
    (launch?.args ?? []).filter((a) => a.startsWith('--host-resolver-rules='));

  it('maps the start host and its www twin to the checked addresses, never a stale global pin, and closes on error', async () => {
    setBrowserPolicy({ pinned: { 'shop.test': '10.0.0.5', 'stale.test': '192.168.1.9' } });
    try {
      const { net } = fakeNet({ 'shop.test': [PUBLIC_ADDRESS], 'www.shop.test': [V6] });
      const fake = fakeLauncher();
      await expect(
        runAuditCrawl(auditRequest(START), { deps: { netDeps: net, launchBrowser: fake.launchBrowser } })
      ).rejects.toThrow(STOP);
      expect(fake.launches).toHaveLength(1);
      expect(resolverRules(fake.launches[0])).toEqual([
        `--host-resolver-rules=MAP shop.test ${PUBLIC_ADDRESS}, MAP www.shop.test [${V6}]`,
      ]);
      const args = (fake.launches[0].args ?? []).join(' ');
      expect(args).not.toContain('stale.test');
      expect(args).not.toContain('10.0.0.5');
      expect(fake.launches[0].args).toEqual(expect.arrayContaining(['--no-sandbox', '--disable-extensions']));
      expect(fake.launches[0].headless).toBe(true);
      expect(fake.closed()).toBe(1);
    } finally {
      setBrowserPolicy(null);
    }
  });

  it('creates the context with service workers blocked, keeping the viewport, baseURL and ignoreHTTPSErrors', async () => {
    const { net } = fakeNet({ 'shop.test': [PUBLIC_ADDRESS] });
    const fake = fakeLauncher();
    await expect(
      runAuditCrawl(auditRequest(START), { deps: { netDeps: net, launchBrowser: fake.launchBrowser } })
    ).rejects.toThrow(STOP);
    expect(fake.contexts).toEqual([
      { viewport: { width: 1440, height: 900 }, baseURL: START, ignoreHTTPSErrors: true, serviceWorkers: 'block' },
    ]);
  });

  it.each([
    ['private', { 'shop.test': [PUBLIC_ADDRESS], 'www.shop.test': ['10.1.2.3'] }],
    ['missing', { 'shop.test': [PUBLIC_ADDRESS] }],
  ])('makes a %s www twin unresolvable in the browser', async (_label, answers) => {
    const { net } = fakeNet(answers);
    const fake = fakeLauncher();
    await expect(
      runAuditCrawl(auditRequest(START), { deps: { netDeps: net, launchBrowser: fake.launchBrowser } })
    ).rejects.toThrow(STOP);
    expect(resolverRules(fake.launches[0])).toEqual([
      `--host-resolver-rules=MAP shop.test ${PUBLIC_ADDRESS}, MAP www.shop.test ~NOTFOUND`,
    ]);
  });

  it('a public IP address start is checked without a lookup and needs no resolver rule', async () => {
    const { net, looked } = fakeNet({});
    const fake = fakeLauncher();
    await expect(
      runAuditCrawl(auditRequest(`http://${PUBLIC_ADDRESS}/`), {
        deps: { netDeps: net, launchBrowser: fake.launchBrowser },
      })
    ).rejects.toThrow(STOP);
    expect(looked).toEqual([]);
    expect(fake.launches).toHaveLength(1);
    expect(resolverRules(fake.launches[0])).toEqual([]);
  });

  it.each([
    ['private', { 'shop.test': ['10.0.0.7'] }, 'ERR_PRIVATE_ADDRESS'],
    ['mixed public and private', { 'shop.test': [PUBLIC_ADDRESS, '127.0.0.1'] }, 'ERR_PRIVATE_ADDRESS'],
    ['failed lookup', {}, 'ERR_UNREACHABLE'],
    ['empty answer', { 'shop.test': [] }, 'ERR_UNREACHABLE'],
  ])('a %s start host stops the crawl before robots.txt or any browser', async (_label, answers, code) => {
    const { net, looked, connected } = fakeNet(answers);
    const fake = fakeLauncher();
    const err = await runAuditCrawl(auditRequest(START), {
      deps: { netDeps: net, launchBrowser: fake.launchBrowser },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuditCrawlRefusedError);
    expect((err as AuditCrawlRefusedError).code).toBe(code);
    expect((err as Error).message).not.toMatch(/10\.0\.0\.7|127\.0\.0\.1|shop\.test/);
    expect(looked).toEqual(['shop.test']);
    expect(connected).toEqual([]);
    expect(fake.launches).toEqual([]);
  });

  it.each(['http://a,b.test/', 'http://*.shop.test/'])(
    'refuses %s, which a resolver rule cannot carry, without a lookup',
    async (url) => {
      const { net, looked, connected } = fakeNet({});
      const fake = fakeLauncher();
      const err = await runAuditCrawl(auditRequest(url), {
        deps: { netDeps: net, launchBrowser: fake.launchBrowser },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuditCrawlRefusedError);
      expect((err as AuditCrawlRefusedError).code).toBe('ERR_UNREACHABLE');
      expect(looked).toEqual([]);
      expect(connected).toEqual([]);
      expect(fake.launches).toEqual([]);
    }
  );

  /** A launcher whose browser is the test's (it maps plain.test to the fixture); the crawl's own launch is recorded. */
  function testBrowserLauncher() {
    const launches: LaunchOptions[] = [];
    const contexts: BrowserContextOptions[] = [];
    let closed = 0;
    const launchBrowser: AuditBrowserLauncher = async (options) => {
      launches.push(options);
      return {
        async newContext(o?: BrowserContextOptions) {
          contexts.push(o ?? {});
          return browser.newContext(o);
        },
        async close() {
          closed++;
        },
      };
    };
    return { launchBrowser, launches, contexts, closed: () => closed };
  }

  it('crawls through its own launched browser and closes it when the crawl ends', async () => {
    const own = testBrowserLauncher();
    const result = await runAuditCrawl(auditRequest(`http://${PLAIN_HOST}:${plain.port}/`), {
      deps: { netDeps, launchBrowser: own.launchBrowser },
    });
    expect(recordedPaths(result)).toEqual(expect.arrayContaining(['/', '/about', '/contact']));
    expect(resolverRules(own.launches[0])).toEqual([
      `--host-resolver-rules=MAP ${PLAIN_HOST} ${PUBLIC_ADDRESS}, MAP www.${PLAIN_HOST} ~NOTFOUND`,
    ]);
    expect(own.contexts).toHaveLength(1);
    expect(own.contexts[0]).toMatchObject({ serviceWorkers: 'block' });
    expect(own.closed()).toBe(1);
  }, 60_000);

  it('closes its own browser when the crawl is stopped', async () => {
    const own = testBrowserLauncher();
    const controller = new AbortController();
    const result = await runAuditCrawl(auditRequest(`http://${PLAIN_HOST}:${plain.port}/`), {
      signal: controller.signal,
      onProgress: (e) => {
        if (e.pagesRecorded >= 1) controller.abort();
      },
      deps: { netDeps, launchBrowser: own.launchBrowser },
    });
    expect(result.pages.length).toBeGreaterThanOrEqual(1);
    expect(own.closed()).toBe(1);
  }, 60_000);
});
