import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Route } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';

// T-428: the delete probe decides on the element's own label and the profile's forbiddenActions.
// Routed pages only (ADR 0040).
describe('the delete probe uses the real label and forbiddenActions (T-428)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  const origin = 'https://admin.example';
  /** A list page whose one row delete asks for a confirm when clicked. */
  const listPage = (deleteControl: string) =>
    `<!doctype html><html><head><title>Items</title></head><body><main><h1>Items</h1>
     <button onclick="void 0">Add item</button>
     <table><tr><td>Draft 1</td><td><button onclick="void 0">Edit</button>${deleteControl}</td></tr></table>
     </main></body></html>`;

  const crawl = async (deleteControl: string, forbiddenActions: string[] = []) => {
    const context = await browser.newContext();
    await context.route('**/*', (route: Route) => {
      const u = new URL(route.request().url());
      if (u.origin === origin && u.pathname === '/')
        return route.fulfill({ status: 200, contentType: 'text/html', body: listPage(deleteControl) });
      return route.fulfill({ status: 404, contentType: 'text/html', body: '<p>none</p>' });
    });
    try {
      const result = await new DeterministicSpider(forbiddenActions, 5).crawl(context, `${origin}/`, {
        seedSitemap: false,
        followFormActions: false,
        maxDurationMs: 30_000,
        pageDelayMs: 0,
        outboundFetch: async () => null,
      });
      return result.pages.find((p) => p.urlPath === '/')?.crud;
    } finally {
      await context.close();
    }
  };

  it('a control labelled "Delete row" is probed as before', async () => {
    const crud = await crawl(`<button onclick="confirm('Delete this row?')">Delete row</button>`);
    expect(crud?.deleteConfirm).toBe(true);
    expect(crud?.deleteProbeSkipped).toBeUndefined();
  }, 60_000);

  it('a "Delete account" control is not probed, and the skip is kept as a fact', async () => {
    const crud = await crawl(`<button title="Delete account" onclick="confirm('Sure?')">Delete</button>`);
    expect(crud?.list).toBe(true);
    expect(crud?.deleteConfirm).toBeUndefined();
    expect(crud?.deleteProbeSkipped).toMatch(/Delete account/);
  }, 60_000);

  it('a profile forbiddenActions entry "Remove draft" stops that probe', async () => {
    const control = `<button title="Remove draft" onclick="confirm('Sure?')">Remove</button>`;
    expect((await crawl(control))?.deleteConfirm).toBe(true);
    const crud = await crawl(control, ['Remove draft']);
    expect(crud?.deleteConfirm).toBeUndefined();
    expect(crud?.deleteProbeSkipped).toMatch(/forbidden/i);
  }, 60_000);
});
