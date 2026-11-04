/**
 * T-304 (LC-001). The robots gate must ask the policy about the route's path and query, the form every other
 * call site uses. Asked about an absolute URL, every `/`-rooted rule is dead and the crawler fetches what a
 * site asked it to leave alone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { chromium, type Browser } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { RobotsPolicy } from '../src/competitive/robots.js';
import { makeOutboundFetch } from '../src/safe-net.js';
import { startAuditSite, AUDIT_SITE_PAGES, type AuditSiteServer } from './helpers/audit-site-server.js';

const PORT = 3539;
const BASE = `http://localhost:${PORT}`;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

const ROBOTS_DISALLOW_PRIVATE = 'User-agent: *\nDisallow: /private/\n';
const ROBOTS_ALLOW_LONGER = 'User-agent: *\nDisallow: /private/\nAllow: /private/ok\n';
const ROBOTS_DISALLOW_QUERY = 'User-agent: *\nDisallow: /*?\n';

describe('DeterministicSpider honours robots.txt (T-304)', () => {
  let server: http.Server;
  let browser: Browser;
  /** Paths the server was asked for, in order. */
  const served: string[] = [];

  const crawlWith = async (robots?: RobotsPolicy) => {
    const context = await browser.newContext();
    try {
      return await new DeterministicSpider().crawl(context, `${BASE}/`, {
        concurrency: 1,
        exploreClicks: false,
        seedSitemap: false,
        ...(robots ? { robots } : {}),
      });
    } finally {
      await context.close();
    }
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = new URL(req.url || '/', BASE).pathname;
      served.push(path);
      const send = (body: string, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end(body);
      };
      if (path === '/') {
        return send(
          page(
            'Home',
            `<a href="/public">Public</a> <a href="/private/">Private</a> <a href="/private/ok">Private ok</a>
             <a href="/private/data">Private data</a> <a href="/search?q=1">Search</a>`
          )
        );
      }
      if (path === '/public') return send(page('Public', '<p>Anyone may read this.</p>'));
      if (path === '/private/') return send(page('Private', '<p>Left alone by robots.txt.</p>'));
      if (path === '/private/ok') return send(page('Private ok', '<p>The site allows this one.</p>'));
      if (path === '/private/data') return send(page('Private data', '<p>Left alone by robots.txt.</p>'));
      if (path === '/search') return send(page('Search', '<p>Results.</p>'));
      return send('Not found', 404);
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('leaves a disallowed path alone, and reports it', async () => {
    const result = await crawlWith(RobotsPolicy.parse(ROBOTS_DISALLOW_PRIVATE, 'qa-crawler'));

    const recorded = result.pages.map((p) => p.urlPath);
    expect(recorded).toContain('/public');
    // A route no rule matches is still crawled, proving the gate is what changed.
    // Routes keep their query string as the key (see frontier.test.ts), so the search page is '/search?q=1'.
    expect(recorded).toContain('/search?q=1');
    expect(recorded).not.toContain('/private/');
    expect(recorded).not.toContain('/private/ok');

    expect(result.skippedByRobots).toEqual(expect.arrayContaining(['/private/', '/private/ok', '/private/data']));
    expect(result.skipped?.find((s) => s.urlPath === '/private/')).toMatchObject({ why: 'robots' });
    // The telemetry row keeps the shape it had: no attempt was made.
    expect(result.routes?.find((r) => r.requestedPath === '/private')).toMatchObject({
      outcome: 'skipped',
      skipReason: 'robots',
      attempts: 0,
      durationMs: 0,
    });
  }, 60000);

  it('records the same path when there is no policy', async () => {
    const result = await crawlWith();

    expect(result.pages.map((p) => p.urlPath)).toEqual(expect.arrayContaining(['/private/', '/private/ok']));
    expect(result.skippedByRobots ?? []).toEqual([]);
  }, 60000);

  it('lets a longer Allow beat Disallow', async () => {
    const result = await crawlWith(RobotsPolicy.parse(ROBOTS_ALLOW_LONGER, 'qa-crawler'));

    const recorded = result.pages.map((p) => p.urlPath);
    expect(recorded).toContain('/private/ok');
    expect(recorded).not.toContain('/private/');
    expect(result.skippedByRobots).toEqual(expect.arrayContaining(['/private/', '/private/data']));
    expect(result.skippedByRobots).not.toContain('/private/ok');
  }, 60000);

  it('REQ-034 AC-2: with no robots.txt (404) the crawl proceeds normally, with no robots skips', async () => {
    served.length = 0;
    const robots = await RobotsPolicy.fetch(BASE, 'qa-crawler', makeOutboundFetch());
    expect(served).toContain('/robots.txt');
    expect(robots.crawlDelayMs).toBeUndefined();

    const context = await browser.newContext();
    let result;
    try {
      // Sitemap seeding on, so the Spider asks for robots.txt itself too and gets the 404.
      result = await new DeterministicSpider().crawl(context, `${BASE}/`, {
        concurrency: 1,
        exploreClicks: false,
        robots,
      });
    } finally {
      await context.close();
    }

    expect(result.pages.map((p) => p.urlPath)).toEqual(
      expect.arrayContaining(['/public', '/private/', '/private/ok', '/private/data'])
    );
    expect(result.skippedByRobots).toBeUndefined();
    expect(result.skipped?.filter((s) => s.why === 'robots') ?? []).toEqual([]);
    expect(served.filter((p) => p === '/robots.txt').length).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('skips a URL with a query when a rule says so', async () => {
    const result = await crawlWith(RobotsPolicy.parse(ROBOTS_DISALLOW_QUERY, 'qa-crawler'));

    expect(result.pages.map((p) => p.urlPath)).not.toContain('/search');
    expect(result.skippedByRobots).toContain('/search');
    // The path and query were what was asked about: a queryless page is unaffected.
    expect(result.pages.map((p) => p.urlPath)).toContain('/public');
  }, 60000);
});

describe('REQ-034: robots.txt on the audit fixture (Disallow: /private)', () => {
  let browser: Browser;
  let audit: AuditSiteServer;

  beforeAll(async () => {
    browser = await chromium.launch();
    audit = await startAuditSite();
  });

  afterAll(async () => {
    await browser?.close();
    await audit?.close();
  });

  it('AC-1: a disallowed page met by link or only in sitemap.xml is never requested, and is a robots Skipped Page', async () => {
    const robots = await RobotsPolicy.fetch(audit.origin, 'qa-crawler', makeOutboundFetch());
    audit.clearRequests();

    const context = await browser.newContext();
    let result;
    try {
      result = await new DeterministicSpider([], 40).crawl(context, audit.origin, {
        concurrency: 3,
        exploreClicks: false,
        pageDelayMs: 0,
        robots,
      });
    } finally {
      await context.close();
    }

    const asked = audit.requests.map((r) => new URL(r.path, audit.origin).pathname);
    // The crawl did run: robots.txt and sitemap.xml were read and the sitemap-only page was visited.
    expect(asked).toEqual(expect.arrayContaining(['/robots.txt', '/sitemap.xml', AUDIT_SITE_PAGES.sitemapOnly]));
    expect(asked).not.toContain(AUDIT_SITE_PAGES.privateLinked);
    expect(asked).not.toContain(AUDIT_SITE_PAGES.privateSitemapOnly);
    expect(asked.filter((p) => p.startsWith('/private'))).toEqual([]);

    for (const urlPath of [AUDIT_SITE_PAGES.privateLinked, AUDIT_SITE_PAGES.privateSitemapOnly]) {
      expect(result.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ urlPath, why: 'robots' })]));
      expect(result.pages.map((p) => p.urlPath)).not.toContain(urlPath);
    }
  }, 120000);
});
