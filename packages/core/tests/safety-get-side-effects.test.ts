import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Route } from 'playwright';
import { isSideEffectAddress } from '../src/discovery/safety-filter.js';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { blockChanges } from '../src/live-site.js';

// T-427: a GET that changes something (/logout?confirm, /delete?id=1) is never followed. Routed pages only.
describe('isSideEffectAddress', () => {
  const side = (u: string) => isSideEffectAddress(new URL(u, 'https://shop.example'));
  it('matches path segments and query keys that change something', () => {
    expect(side('/logout?confirm=1')).toBe(true);
    expect(side('/delete?id=1')).toBe(true);
    expect(side('/account/sign-out?next=/')).toBe(true);
    expect(side('/signout?x=1')).toBe(true);
    expect(side('/newsletter/unsubscribe?token=abc')).toBe(true);
    expect(side('/orders/7?cancel=1')).toBe(true);
    expect(side('/users/activate?code=1')).toBe(true);
    expect(side('/items?remove=4')).toBe(true);
  });
  it('leaves ordinary addresses alone', () => {
    expect(side('/products?id=1')).toBe(false);
    expect(side('/password-reset')).toBe(false);
    expect(side('/subscribe')).toBe(false);
    expect(side('/account/sign-out')).toBe(false);
    expect(side('/delete')).toBe(false);
    expect(side('/blog/how-we-deleted-our-backlog')).toBe(false);
    expect(side('/confirmation-policy')).toBe(false);
    expect(side('/')).toBe(false);
  });
});

describe('the Spider and read-only runs do not request side-effect addresses (T-427)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  const origin = 'https://shop.example';
  const html = (body: string) =>
    `<!doctype html><html><head><title>Shop</title></head><body><main><h1>Shop</h1>${body}</main></body></html>`;
  const home = html(
    `<a href="/logout?confirm=1">Leave</a> <a href="/delete?id=1">Tidy</a> <a href="/products?id=1">Products</a> <a href="/password-reset">Reset</a>`
  );

  const crawl = async (includePaths?: string[]) => {
    const context = await browser.newContext();
    const requested: string[] = [];
    await context.route('**/*', (route: Route) => {
      const u = new URL(route.request().url());
      requested.push(u.pathname + u.search);
      return route.fulfill({ status: 200, contentType: 'text/html', body: u.pathname === '/' ? home : html('') });
    });
    try {
      const result = await new DeterministicSpider([], 10).crawl(context, `${origin}/`, {
        seedSitemap: false,
        followFormActions: false,
        exploreClicks: false,
        maxDurationMs: 30_000,
        pageDelayMs: 0,
        outboundFetch: async () => null,
        ...(includePaths ? { includePaths } : {}),
      });
      return { result, requested };
    } finally {
      await context.close();
    }
  };

  it('a page linking to /logout?confirm=1 and /delete?id=1: neither is requested; /products?id=1 is crawled', async () => {
    const { result, requested } = await crawl();
    expect(requested.filter((r) => r.startsWith('/logout') || r.startsWith('/delete'))).toEqual([]);
    expect(requested).toContain('/products?id=1');
    expect(requested).toContain('/password-reset');
    // A sign-out link is already left out of the page's links; the delete link is listed as a Skipped Page.
    expect(result.skipped).toEqual(
      expect.arrayContaining([{ urlPath: '/delete', why: 'excluded', detail: 'possible side effect' }])
    );
  }, 60_000);

  it('the include list allows /delete?id=1', async () => {
    const { requested } = await crawl(['/delete']);
    expect(requested).toContain('/delete?id=1');
    expect(requested.filter((r) => r.startsWith('/logout'))).toEqual([]);
  }, 60_000);

  it('a read-only run does not navigate to a side-effect address, unless an approved Plan Item names it', async () => {
    const context = await browser.newContext();
    const requested: string[] = [];
    await context.route('**/*', (route: Route) => {
      const u = new URL(route.request().url());
      requested.push(u.pathname + u.search);
      return route.fulfill({ status: 200, contentType: 'text/html', body: html('') });
    });
    const blocked = await blockChanges(context, { allow: (u) => u.pathname === '/unsubscribe' });
    try {
      const page = await context.newPage();
      await page.goto(`${origin}/`);
      await page.goto(`${origin}/logout?confirm=1`).catch(() => undefined);
      await page.goto(`${origin}/unsubscribe?token=1`);
      expect(requested).toEqual(['/', '/unsubscribe?token=1']);
      expect(blocked).toEqual([`GET ${origin}/logout?confirm=1`]);
    } finally {
      await context.close();
    }
  }, 60_000);
});
