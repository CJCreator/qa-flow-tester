/**
 * T-414 (browser tier): the quality gate's axe scan, a variant put in a lab browser with setContent. No request
 * leaves the browser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { labAxeScan } from '../src/audit/improve/quality-gate.js';
import { renderPreviewDocument, sanitizePreviewHtml } from '../src/audit/preview/sanitize.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

function page(body: string): string {
  const { nodes, css } = sanitizePreviewHtml(body, 'https://shop.example.in/');
  // An image without alt text is kept as an image here: data: images stay after finalising.
  return renderPreviewDocument({ nodes, css, language: 'en', host: 'shop.example.in' });
}

describe('labAxeScan (T-414)', () => {
  it('finds no Blocker in a plain variant', async () => {
    const html = page('<main><h1>Fresh groceries</h1><p>Home delivery.</p></main>');
    expect(await labAxeScan({ browser })(html)).toEqual({ blockers: 0 });
  }, 60_000);

  it('counts a Blocker: an image without a text alternative', async () => {
    const html = page('<main><h1>Shop</h1></main>').replace(
      '</main>',
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main>'
    );
    expect((await labAxeScan({ browser })(html)).blockers).toBeGreaterThan(0);
  }, 60_000);
});
