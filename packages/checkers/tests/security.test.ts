import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { SecurityChecker } from '../src/security.js';

describe('SecurityChecker: passwords in page addresses', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  const formsFlagged = async (html: string) => {
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      return (await new SecurityChecker().checkPage(page, { role: 'visitor', breakpoint: '1440px', urlPath: '/' })).length;
    } finally {
      await page.close();
    }
  };
  const PASSWORD = '<input name="user"><input name="password" type="password"><button>Sign in</button>';

  it('flags a sign-in form that is sent with GET, said or implied', async () => {
    expect(await formsFlagged(`<form method="get" action="/dashboard">${PASSWORD}</form>`)).toBe(1);
    expect(await formsFlagged(`<form action="/dashboard">${PASSWORD}</form>`)).toBe(1);
  });

  it('leaves alone forms sent with POST, and single-page-app forms its own script sends', async () => {
    expect(await formsFlagged(`<form method="post" action="/signin">${PASSWORD}</form>`)).toBe(0);
    // No method and nowhere to send to: the page's script handles it (as on saucedemo.com).
    expect(await formsFlagged(`<form>${PASSWORD}</form>`)).toBe(0);
  });

  it('reports a password that really did end up in an address once, on the page with the form', () => {
    const step = (stepIndex: number, urlBefore: string, urlAfter: string) => ({
      stepIndex,
      stepName: `Step ${stepIndex}`,
      action: 'click' as const,
      urlBefore,
      urlAfter,
      consoleErrors: [],
      failedRequests: [],
      durationMs: 10,
      passed: true,
    });
    const leaked = 'http://localhost/dashboard?user=sam&password=hunter2';
    const findings = new SecurityChecker().checkEvidence(
      [step(1, 'http://localhost/login', leaked), step(2, leaked, leaked)],
      { role: 'visitor', breakpoint: '1440px' }
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('The sign-in form sends passwords in the page address');
    // The same place as the form check's finding, so the two merge into one.
    expect(findings[0].where.urlPath).toBe('/login');
  });
});
