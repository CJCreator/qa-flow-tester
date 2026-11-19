import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { guardPage } from '../src/discovery/guard.js';
import { installHostAllowlist } from '../src/browser.js';

// T-425: popups are covered by context-level routes. Routed pages only (ADR 0040).
const origin = 'https://app.example';
const html = (body: string) => `<!doctype html><html><head><title>App</title></head><body>${body}</body></html>`;

describe('popups are guarded like their opener (T-425)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  const setUp = async (pages: Record<string, string>) => {
    const context: BrowserContext = await browser.newContext();
    const seen: string[] = [];
    await context.route('**/*', (route: Route) => {
      const req = route.request();
      const u = new URL(req.url());
      seen.push(`${req.method()} ${u.host}${u.pathname}`);
      if (req.method() !== 'GET') return route.fulfill({ status: 204, body: '' });
      const body = u.origin === origin ? pages[u.pathname] : html('<p>elsewhere</p>');
      return route.fulfill({ status: body ? 200 : 404, contentType: 'text/html', body: body ?? html('') });
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    return { context, page, seen };
  };

  it('a click that opens a popup which sends a POST: the POST is aborted', async () => {
    const { context, page, seen } = await setUp({
      '/': html(`<button onclick="window.open('/popup')">Open</button>`),
      '/popup': html(`<script>fetch('/api/track', { method: 'POST', body: 'x' }).catch(() => {});</script>`),
    });
    const guard = await guardPage(page);
    try {
      const [popup] = await Promise.all([context.waitForEvent('page'), page.click('button')]);
      await popup.waitForLoadState('load');
      await popup.waitForTimeout(300);
      expect(seen.filter((s) => s.startsWith('POST'))).toEqual([]);
      expect(guard.blocked).toContain('POST');
    } finally {
      await guard.release();
      await context.close();
    }
  }, 30_000);

  it('a popup to an allowed host opens and is guarded; the guard leaves other pages alone', async () => {
    const { context, page, seen } = await setUp({
      '/': html(`<a href="/popup" target="_blank">Open</a>`),
      '/popup': html(`<script>fetch('/api/save', { method: 'PUT', body: 'x' }).catch(() => {});</script>`),
      '/other': html(`<script>fetch('/api/read', { method: 'POST', body: 'q' }).catch(() => {});</script>`),
    });
    const guard = await guardPage(page);
    try {
      const [popup] = await Promise.all([context.waitForEvent('page'), page.click('a')]);
      await popup.waitForLoadState('load');
      expect(popup.url()).toBe(`${origin}/popup`);
      await popup.waitForTimeout(300);
      expect(seen.filter((s) => s.startsWith('PUT'))).toEqual([]);
      // A page that is neither the guarded page nor one it opened is not guarded.
      const unrelated = await context.newPage();
      await unrelated.goto(`${origin}/other`);
      await unrelated.waitForTimeout(300);
      expect(seen).toContain('POST app.example/api/read');
    } finally {
      await guard.release();
      await context.close();
    }
  }, 30_000);

  // `target="_blank"` (no opener) and `window.open` (with one) reach the browser differently: both must end
  // with no page left on the other host, and the block recorded.
  for (const [how, control] of [
    ['a target="_blank" link', `<a href="https://partner.example/offer" target="_blank">Partner</a>`],
    ['window.open', `<a href="#" onclick="window.open('https://partner.example/offer'); return false;">Partner</a>`],
  ] as const) {
    it(`a popup to another host is closed at once and recorded (${how})`, async () => {
      const { context, page, seen } = await setUp({ '/': html(control) });
      const allowlist = await installHostAllowlist(context, (u) => u.origin === origin);
      const opened: Page[] = [];
      context.on('page', (p) => opened.push(p));
      try {
        await page.click('a', { noWaitAfter: true });
        await expect.poll(() => allowlist.blocked.length, { timeout: 5000 }).toBe(1);
        await expect.poll(() => context.pages().length, { timeout: 5000 }).toBe(1);
        expect(context.pages()[0]).toBe(page);
        expect(opened.every((p) => p.isClosed())).toBe(true);
        expect(seen.filter((s) => s.includes('partner.example'))).toEqual([]);
        expect(allowlist.blocked[0]).toEqual(
          expect.objectContaining({ kind: 'navigation', url: 'https://partner.example/offer', mainFrame: true })
        );
        // A popup the browser did open is marked as closed by the allowlist.
        if (opened.length > 0) expect(allowlist.blocked[0].popupClosed).toBe(true);
      } finally {
        await allowlist.release();
        await context.close();
      }
    }, 30_000);
  }
});
