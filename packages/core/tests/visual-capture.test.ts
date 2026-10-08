import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { DesignStandardsChecker } from '@qa/checkers';
import { captureVisualShot, isVolatileDateText, stabilisePage } from '../src/visual-capture.js';

const checker = new DesignStandardsChecker();

describe('visual capture', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  const fresh = async (html: string) => {
    await page?.close();
    page = await browser.newPage({ viewport: { width: 600, height: 300 } });
    await page.setContent(html);
  };
  const same = async (a: Buffer, b: Buffer) => (await checker.checkVisualDiff(a, b, { maxDiffPercent: 0 })).match;
  const big = 'body{font:48px sans-serif;margin:8px} ';

  it('visual capture: stabilising returns within its deadline when an image never loads (route hangs)', async () => {
    page = await browser.newPage();
    await page.route('**/never.png', () => {
      /* never fulfilled */
    });
    await page.setContent('<img loading="lazy" src="http://localhost:9/never.png" width="50" height="50">');
    const started = Date.now();
    await stabilisePage(page, { timeoutMs: 1500 });
    expect(Date.now() - started).toBeLessThan(4000);
    const shotStart = Date.now();
    await captureVisualShot(page, { masked: true, stabiliseMs: 1500 });
    expect(Date.now() - shotStart).toBeLessThan(6000);
  }, 20000);

  it('visual capture: stabilising clicks and submits nothing (button onclick/form flag unchanged)', async () => {
    await fresh(`<button id="b" onclick="window.clicked=true">Go</button>
      <form id="f" onsubmit="window.submitted=true;return false"><input name="x"><button type="submit">Send</button></form>`);
    await captureVisualShot(page, { masked: true });
    await captureVisualShot(page, { masked: false });
    const flags = await page.evaluate(() => ({
      clicked: (window as unknown as { clicked?: boolean }).clicked,
      submitted: (window as unknown as { submitted?: boolean }).submitted,
    }));
    expect(flags.clicked).toBeUndefined();
    expect(flags.submitted).toBeUndefined();
  });

  it('visual capture: a changing date and <time> give match true when masked, and a diff when not', async () => {
    const html = (d: string, t: string) =>
      `<style>${big}</style><p>Report</p><p id="d">${d}</p><time datetime="${t}">${t}</time>`;
    await fresh(html('Oct 8, 2026', '10:15'));
    const m1 = await captureVisualShot(page, { masked: true });
    const u1 = await captureVisualShot(page, { masked: false });
    await fresh(html('Nov 19, 2027', '23:48'));
    const m2 = await captureVisualShot(page, { masked: true });
    const u2 = await captureVisualShot(page, { masked: false });
    expect(await same(m1, m2)).toBe(true);
    expect(await same(u1, u2)).toBe(false);
  });

  it('visual capture: a changing ad slot (`[data-ad-slot]`, `ins.adsbygoogle`) is masked', async () => {
    const html = (a: string, b: string) =>
      `<style>${big}</style><p>Story</p><div data-ad-slot="1" style="height:60px">${a}</div><ins class="adsbygoogle" style="display:block;height:60px">${b}</ins>`;
    await fresh(html('Buy shoes', 'Cheap flights'));
    const one = await captureVisualShot(page, { masked: true });
    await fresh(html('Win a car', 'Free pizza'));
    const two = await captureVisualShot(page, { masked: true });
    expect(await same(one, two)).toBe(true);
  });

  it('visual capture: real content change ("Pay now" -> "Pay later") still differs when masked', async () => {
    const html = (label: string) => `<style>${big}</style><p>Total</p><button>${label}</button><p>Oct 8, 2026</p>`;
    await fresh(html('Pay now'));
    const one = await captureVisualShot(page, { masked: true });
    await fresh(html('Pay later'));
    const two = await captureVisualShot(page, { masked: true });
    expect(await same(one, two)).toBe(false);
  });

  it('visual capture: isVolatileDateText accepts dates/times/"3 minutes ago", rejects "Version 2.0", "Order #12345", prose containing a date', () => {
    for (const ok of [
      '2026-10-08',
      '2026-10-08T10:15:00Z',
      '8/10/2026',
      '08.10.2026',
      'Oct 8, 2026',
      '8 Oct 2026',
      '10:15',
      '10:15:30 pm',
      '3 minutes ago',
      'just now',
    ]) {
      expect(isVolatileDateText(ok), ok).toBe(true);
    }
    for (const no of [
      'Version 2.0',
      'Order #12345',
      'Released on Oct 8, 2026 for everyone',
      'Price 10.50',
      '',
      'Home',
    ]) {
      expect(isVolatileDateText(no), no).toBe(false);
    }
  });

  it('visual capture: password field length change does not show in a masked shot', async () => {
    const html = (v: string) =>
      `<style>${big}</style><p>Sign in</p><input type="password" value="${v}" style="font-size:40px">`;
    await fresh(html('abc'));
    const one = await captureVisualShot(page, { masked: true });
    await fresh(html('a-much-longer-secret'));
    const two = await captureVisualShot(page, { masked: true });
    expect(await same(one, two)).toBe(true);
  });

  it('visual capture: no data-qa-visual-mask attribute remains; invalid extra selector does not throw; extra selector masks', async () => {
    const html = (n: string) => `<style>${big}</style><p>Hi</p><p>10:15</p><div class="live">${n}</div>`;
    await fresh(html('1 visitor'));
    const one = await captureVisualShot(page, { masked: true, extraSelectors: ['div[', '.live'] });
    expect(await page.locator('[data-qa-visual-mask]').count()).toBe(0);
    await fresh(html('2000 visitors online'));
    const two = await captureVisualShot(page, { masked: true, extraSelectors: ['div[', '.live'] });
    expect(await same(one, two)).toBe(true);
  });
});
