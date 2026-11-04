import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { UXQualityChecker } from '@qa/checkers';

const ONE_SCREEN_APP = `<!doctype html><html lang="en"><head><title>Todos</title></head><body><main>
  <h1>todos</h1><label for="new">New todo</label><input id="new"><button>Add</button><button>Clear done</button>
</main></body></html>`;

const TINY_NEIGHBOURS = `<!doctype html><html lang="en"><head><title>Tiny</title></head><body><nav><a href="/">Home</a></nav><main>
  <h1>Tiny</h1>
  <button style="width:10px;height:10px;padding:0;margin:0" aria-label="One"></button><button style="width:10px;height:10px;padding:0;margin:0" aria-label="Two"></button>
</main></body></html>`;

describe('Dead-end rule and WCAG 2.2', () => {
  let browser: Browser;
  const checker = new UXQualityChecker();

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('does not call the start page of a one-screen app a dead end, but still flags other pages', async () => {
    const page = await browser.newPage();
    await page.setContent(ONE_SCREEN_APP);
    const context = { role: 'visitor', breakpoint: '1440px' as const, urlPath: '/todomvc/', enableAxe: false };

    const asStart = await checker.check(page, { ...context, entryPath: '/todomvc/' });
    expect(asStart.some((f) => f.title.startsWith('Dead End Page'))).toBe(false);

    const elsewhere = await checker.check(page, { ...context, entryPath: '/' });
    expect(elsewhere.some((f) => f.title.startsWith('Dead End Page'))).toBe(true);

    // Nothing to do and no way out is a dead end even where the review started.
    await page.setContent(
      '<!doctype html><html lang="en"><body><main><h1>Lost in Space</h1><p>No way back.</p></main></body></html>'
    );
    const empty = await checker.check(page, { ...context, urlPath: '/deadend', entryPath: '/deadend' });
    expect(empty.some((f) => f.title.startsWith('Dead End Page'))).toBe(true);
    await page.close();
  });

  it('checks WCAG 2.2 rules, such as minimum target size', async () => {
    // axe only runs in pages opened from a browser context.
    const page = await (await browser.newContext()).newPage();
    await page.setContent(TINY_NEIGHBOURS);
    const findings = await checker.check(page, { role: 'visitor', breakpoint: '1440px', urlPath: '/tiny' });
    expect(findings.map((f) => f.title)).toContainEqual(expect.stringContaining('(target-size)'));
    await page.close();
  });
});
