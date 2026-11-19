import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Route } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';

// T-426: an exploring click that lands on another host is undone and recorded. Routed pages only (ADR 0040).
describe('an off-site click navigation is undone and recorded (T-426)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  const origin = 'https://shop.example';
  const html = (body: string) =>
    `<!doctype html><html><head><title>Shop</title></head><body>${body}<main><h1>Shop</h1></main></body></html>`;

  const crawl = async (pages: Record<string, string>) => {
    const context = await browser.newContext();
    const offSite: string[] = [];
    await context.route('**/*', async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        offSite.push(`${route.request().resourceType()} ${url.pathname}`);
        // The other host offers controls of its own: the Spider must not work on them.
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: html(`<nav><button onclick="location.href='/elsewhere-next'">Next</button></nav>`),
        });
      }
      const body = pages[url.pathname];
      if (body === undefined) return route.fulfill({ status: 404, contentType: 'text/html', body: html('') });
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    const visited: string[] = [];
    context.on('page', (p) => p.on('framenavigated', (f) => f === p.mainFrame() && visited.push(f.url())));
    try {
      const result = await new DeterministicSpider([], 10).crawl(context, `${origin}/`, {
        seedSitemap: false,
        followFormActions: false,
        maxDurationMs: 30_000,
        pageDelayMs: 0,
        outboundFetch: async () => null,
      });
      return { result, offSite, visited };
    } finally {
      await context.close();
    }
  };

  it('a button that sets location to another host: the Spider goes back and records a Skipped Page', async () => {
    const { result, offSite, visited } = await crawl({
      '/': html(`<nav><button onclick="location.href='https://partner.example/landing'">Partners</button></nav>`),
    });
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ why: 'off-site-redirect', detail: expect.stringContaining('Partners') }),
      ])
    );
    // Since T-424 the Domain Allowlist aborts the load itself: the other host gets no request, and the page
    // stays where the click started.
    expect(offSite).toEqual([]);
    expect(visited.filter((u) => !u.startsWith(origin))).toEqual([]);
    expect(result.skipped?.filter((s) => s.why === 'off-site-redirect')).toHaveLength(1);
  }, 60_000);

  it('a control repeated on every page lists the off-site address once', async () => {
    const nav = `<nav><a href="/two">Two</a><button onclick="location.href='https://partner.example/landing'">Partners</button></nav>`;
    const { result } = await crawl({ '/': html(nav), '/two': html(nav) });
    expect(result.pages.map((p) => p.urlPath).sort()).toEqual(['/', '/two']);
    expect(result.skipped?.filter((s) => s.why === 'off-site-redirect')).toHaveLength(1);
  }, 60_000);

  it('a click that stays on the host is unchanged', async () => {
    const { result, offSite } = await crawl({
      '/': html(`<nav><button onclick="location.href='/about'">About</button></nav>`),
      '/about': html('<p>About us</p>'),
    });
    expect(offSite).toEqual([]);
    expect(result.pages.map((p) => p.urlPath)).toContain('/about');
    expect((result.skipped ?? []).filter((s) => s.why === 'off-site-redirect')).toEqual([]);
  }, 60_000);
});
