/**
 * ADR 0031 (REQ-047): the Spider seeds from robots.txt and sitemaps through makeOutboundFetch, never through
 * Playwright's request client. Sitemap lines and <loc>s naming another host are logged and skipped; on a shared
 * machine (browser guard set) private addresses and redirects to them are never connected to.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { chromium, type Browser } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { setBrowserPolicy } from '../src/browser.js';
import {
  defaultNetDeps,
  makeOutboundFetch,
  type NetDeps,
  type PinnedRequest,
  type RawResponse,
} from '../src/safe-net.js';
import { startAuditSite, AUDIT_SITE_PAGES, type AuditSiteServer } from './helpers/audit-site-server.js';

const page = (title: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1></main></body></html>`;

/** Wraps a network so every lookup and connect is recorded. */
function spy(inner: NetDeps) {
  const lookups: string[] = [];
  const connects: PinnedRequest[] = [];
  const deps: NetDeps = {
    lookup: (host) => {
      lookups.push(host);
      return inner.lookup(host);
    },
    connect: (req) => {
      connects.push(req);
      return inner.connect(req);
    },
  };
  return { deps, lookups, connects };
}

describe('Spider sitemap seeding through the outbound fetch (ADR 0031)', () => {
  let browser: Browser;
  let audit: AuditSiteServer;
  let shop: http.Server;
  let shopPort = 0;

  beforeAll(async () => {
    // shop.test reaches the local server in the browser only; the seeding fetch sees the fake network.
    browser = await chromium.launch({ args: ['--host-resolver-rules=MAP shop.test 127.0.0.1'] });
    audit = await startAuditSite();
    shop = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page(req.url === '/' ? 'Shop home' : `Shop ${req.url}`));
    });
    await new Promise<void>((r) => shop.listen(0, '127.0.0.1', () => r()));
    shopPort = (shop.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await browser?.close();
    await audit?.close();
    await new Promise<void>((r) => shop.close(() => r()));
  });

  afterEach(() => {
    setBrowserPolicy(null);
    vi.restoreAllMocks();
    delete process.env.QA_DEBUG;
  });

  const crawl = async (target: string, outboundFetch?: ReturnType<typeof makeOutboundFetch>) => {
    const context = await browser.newContext();
    try {
      return await new DeterministicSpider([], 40).crawl(context, target, {
        exploreClicks: false,
        pageDelayMs: 0,
        concurrency: 3,
        maxDepth: 1,
        ...(outboundFetch ? { outboundFetch } : {}),
      });
    } finally {
      await context.close();
    }
  };

  it('AC-3/AC-4 local run: the audit site is seeded (pinned to 127.0.0.1); the other-host Sitemap line is logged, never fetched', async () => {
    process.env.QA_DEBUG = 'crawl';
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')));
    const net = spy(defaultNetDeps);

    const result = await crawl(audit.origin, makeOutboundFetch({ deps: net.deps }));

    const paths = result.pages.map((p) => p.urlPath);
    expect(paths).toContain(AUDIT_SITE_PAGES.sitemapOnly);
    const fetched = net.connects.map((c) => c.url.pathname);
    expect(fetched).toEqual(expect.arrayContaining(['/robots.txt', '/sitemap.xml']));
    for (const c of net.connects) {
      expect(c.address).toBe('127.0.0.1');
      expect(c.url.hostname).not.toBe('sitemaps.example.invalid');
    }
    expect(net.lookups).not.toContain('sitemaps.example.invalid');
    expect(logs.some((l) => l.includes('sitemap on another host skipped'))).toBe(true);
  }, 120000);

  it('local run with the default outbound fetch still seeds from the sitemap', async () => {
    audit.clearRequests();
    const result = await crawl(audit.origin);
    expect(result.pages.map((p) => p.urlPath)).toContain(AUDIT_SITE_PAGES.sitemapOnly);
    const asked = audit.requests.map((r) => r.path);
    expect(asked).toContain('/robots.txt');
    expect(asked).toContain('/sitemap.xml');
  }, 120000);

  it('AC-1 browser guard set: a site resolving to 127.0.0.1 gets no robots/sitemap connection', async () => {
    setBrowserPolicy({ guard: async () => true });
    const responses: Record<string, RawResponse> = {};
    const net = spy({
      lookup: async (host) => (host === 'shop.test' ? ['127.0.0.1'] : Promise.reject(new Error('ENOTFOUND'))),
      connect: async (req) => responses[req.url.toString()] ?? { status: 404, headers: {}, body: '' },
    });

    const result = await crawl(`http://shop.test:${shopPort}/`, makeOutboundFetch({ deps: net.deps }));

    expect(result.pages.map((p) => p.urlPath)).toContain('/');
    expect(net.lookups).toContain('shop.test');
    expect(net.connects).toHaveLength(0);
  }, 120000);

  it('AC-1/AC-2/AC-4 browser guard set: other-host lines are skipped and a redirect to 169.254.169.254 is refused at that hop', async () => {
    setBrowserPolicy({ guard: async () => true });
    const site = `http://shop.test:${shopPort}`;
    const robots = [
      'User-agent: *',
      'Disallow:',
      `Sitemap: ${site}/sitemap.xml`,
      `Sitemap: ${site}/moved-sitemap.xml`,
      'Sitemap: https://sitemaps.example.invalid/kaveri-sweets/sitemap.xml',
      'Sitemap: http://meta.test/latest/sitemap.xml',
    ].join('\n');
    const sitemap = `<?xml version="1.0"?><urlset>
      <url><loc>${site}/from-sitemap</loc></url>
      <url><loc>http://meta.test/latest/meta-data</loc></url>
      <url><loc>https://elsewhere.test/page</loc></url>
    </urlset>`;
    const responses: Record<string, RawResponse> = {
      [`${site}/robots.txt`]: { status: 200, headers: {}, body: robots },
      [`${site}/sitemap.xml`]: { status: 200, headers: {}, body: sitemap },
      [`${site}/moved-sitemap.xml`]: { status: 302, headers: { location: 'http://meta.test/latest/' }, body: '' },
      'http://meta.test/latest/': { status: 200, headers: {}, body: '<urlset><url><loc>x</loc></url></urlset>' },
    };
    const names: Record<string, string[]> = { 'shop.test': ['93.184.216.34'], 'meta.test': ['169.254.169.254'] };
    const net = spy({
      lookup: async (host) => names[host] ?? Promise.reject(new Error('ENOTFOUND')),
      connect: async (req) => responses[req.url.toString()] ?? { status: 404, headers: {}, body: '' },
    });

    const result = await crawl(`${site}/`, makeOutboundFetch({ deps: net.deps }));

    const urls = net.connects.map((c) => c.url.toString());
    expect(urls).toEqual(
      expect.arrayContaining([`${site}/robots.txt`, `${site}/sitemap.xml`, `${site}/moved-sitemap.xml`])
    );
    for (const c of net.connects) {
      expect(c.address).toBe('93.184.216.34');
      expect(c.url.hostname).toBe('shop.test');
    }
    // meta.test is only ever looked up on the redirect hop, then refused.
    expect(net.lookups.filter((h) => h === 'meta.test')).toHaveLength(1);
    expect(net.lookups).not.toContain('sitemaps.example.invalid');
    expect(net.lookups).not.toContain('elsewhere.test');
    const paths = result.pages.map((p) => p.urlPath);
    expect(paths).toContain('/from-sitemap');
    expect(paths.some((p) => p.includes('meta-data'))).toBe(false);
  }, 120000);
});
