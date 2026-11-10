import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readPageForms } from '../src/discovery/deterministic-spider.js';

describe('readPageForms (browser)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  }, 60_000);

  afterAll(async () => {
    if (page) await page.close();
    if (browser) await browser.close();
  });

  it('escapes id selectors like :r1: and uses button:not([type]) when submit button has no type', async () => {
    await page.setContent('<form><input id=":r1:"><button>Go</button></form>');
    const forms = await readPageForms(page);
    expect(forms[0].inputs[0].selector).toBe('#\\:r1\\:');
    expect(await page.locator(forms[0].inputs[0].selector).count()).toBe(1);
    expect(forms[0].submitButtonSelector).toBe('button:not([type])');
    expect(await page.locator(forms[0].submitButtonSelector!).count()).toBe(1);
  });

  it('handles quotes in attributes without throwing', async () => {
    await page.setContent('<form><input name=\'a"b\'><button type="submit">Go</button></form>');
    const forms = await readPageForms(page);
    expect(await page.locator(forms[0].inputs[0].selector).count()).toBe(1);
  });

  it('scopes submit button selector to its form when multiple forms exist', async () => {
    await page.setContent(
      '<form action="/a"><input name="x"><button type="submit">A</button></form><form action="/b"><input name="y"><button type="submit">B</button></form>'
    );
    const forms = await readPageForms(page);
    expect(await page.locator(forms[1].submitButtonSelector!).innerText()).toBe('B');
  });
});
