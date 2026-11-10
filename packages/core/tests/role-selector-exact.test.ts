import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { locateElement } from '../src/browser.js';

describe('role selector exactness (browser)', () => {
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

  it('role=button[name="Move"] is the Move button, not Remove', async () => {
    await page.setContent('<button>Remove</button><button>Move</button>');
    const found = await locateElement(page, 'role=button[name="Move"]');
    expect(await found.innerText()).toBe('Move');
    expect(await page.locator('role=button[name="Move"]').count()).toBe(1);
  });
});
