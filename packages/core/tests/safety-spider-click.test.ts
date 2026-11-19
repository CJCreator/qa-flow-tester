import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Route } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';

// T-423: the Spider's exploring click runs under guardPage. Routed pages only (ADR 0040).
describe("the Spider's exploring click is guarded (T-423)", () => {
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
    const changing: string[] = [];
    await context.route('**/*', async (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() !== 'GET') {
        changing.push(`${req.method()} ${url.pathname}`);
        return route.fulfill({ status: 204, body: '' });
      }
      const body = url.origin === origin ? pages[url.pathname] : undefined;
      if (body === undefined) return route.fulfill({ status: 404, contentType: 'text/html', body: html('') });
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    try {
      const result = await new DeterministicSpider([], 10).crawl(context, `${origin}/`, {
        seedSitemap: false,
        followFormActions: false,
        maxDurationMs: 30_000,
        pageDelayMs: 0,
        outboundFetch: async () => null,
      });
      return { result, changing };
    } finally {
      await context.close();
    }
  };

  it('a click that fires a POST sends nothing to the server, and the block is kept as a fact', async () => {
    const { result, changing } = await crawl({
      '/': html(`<nav><button onclick="fetch('/api/track', { method: 'POST', body: 'x' })">Products</button></nav>`),
    });
    expect(changing).toEqual([]);
    const start = result.pages.find((p) => p.urlPath === '/');
    expect(start?.blockedChanges).toBeGreaterThanOrEqual(1);
    expect(start?.exploreErrors ?? 0).toBe(0);
  }, 60_000);

  it('a click that calls form.submit() on a POST form sends nothing', async () => {
    const { changing } = await crawl({
      '/': html(
        `<form id="f" method="post" action="/api/save"><input name="q" value="1"></form>
         <nav><button onclick="document.getElementById('f').submit()">Products</button></nav>`
      ),
    });
    expect(changing).toEqual([]);
  }, 60_000);

  it('a plain script link is still followed', async () => {
    const { result, changing } = await crawl({
      '/': html(`<nav><a href="#" onclick="location.href='/about'; return false;">About</a></nav>`),
      '/about': html('<p>About us</p>'),
    });
    expect(changing).toEqual([]);
    expect(result.pages.map((p) => p.urlPath)).toContain('/about');
  }, 60_000);
});
