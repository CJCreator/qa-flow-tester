import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SecurityChecker, urlHasSecretParam } from '../src/security.js';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('SecurityChecker', () => {
  const checker = new SecurityChecker();

  it('detects secrets in URL parameters', () => {
    expect(urlHasSecretParam('http://example.com/?token=abc123xyz')).toBe(true);
    expect(urlHasSecretParam('http://example.com/?password=secret')).toBe(true);
    expect(urlHasSecretParam('http://example.com/?page=1&query=test')).toBe(false);
  });

  it('flags passwords in URLs from StepEvidence', () => {
    const findings = checker.checkEvidence(
      [
        {
          stepIndex: 1,
          stepName: 'Submit credentials',
          action: 'click',
          urlBefore: 'http://localhost:3050/login',
          urlAfter: 'http://localhost:3050/dashboard?email=admin%40example.com&password=secret',
          consoleErrors: [],
          failedRequests: [],
          durationMs: 100,
          passed: true,
        },
      ],
      {
        testCaseId: 'TC-SEC-URL',
        role: 'visitor',
        breakpoint: '1440px',
      }
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('Major');
    expect(findings[0].title).toContain('The sign-in form sends passwords in the page address');
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
    const findings = checker.checkEvidence([step(1, 'http://localhost/login', leaked), step(2, leaked, leaked)], {
      role: 'visitor',
      breakpoint: '1440px',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('The sign-in form sends passwords in the page address');
    // The same place as the form check's finding, so the two merge into one.
    expect(findings[0].where.urlPath).toBe('/login');
  });

  describe('forms with password fields', () => {
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
        return (await checker.checkPage(page, { role: 'visitor', breakpoint: '1440px', urlPath: '/login' })).length;
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
  });

  it('flags missing security headers', () => {
    const headers = {
      'content-type': 'text/html; charset=utf-8',
    };

    const findings = checker.checkHeaders(headers, {
      testCaseId: 'TC-SEC-HEADERS',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      isHttps: true,
    });

    // Should flag CSP, nosniff, clickjacking, referrer, and HSTS
    expect(findings.some((f) => f.title.includes('Content-Security-Policy'))).toBe(true);
    expect(findings.some((f) => f.title.includes('X-Content-Type-Options: nosniff'))).toBe(true);
    expect(findings.some((f) => f.title.includes('clickjacking protection'))).toBe(true);
    expect(findings.some((f) => f.title.includes('Referrer-Policy'))).toBe(true);
    expect(findings.some((f) => f.title.includes('Strict-Transport-Security'))).toBe(true);
  });

  it('flags insecure external scripts and mixed content (books.toscrape.com insecure jQuery)', async () => {
    const mockPage = {
      url: () => 'https://books.toscrape.com/',
      evaluate: async (fn: any, ...args: any[]) => {
        // Return simulated script with http://
        return [{ tag: 'script', src: 'http://code.jquery.com/jquery-1.11.0.min.js' }];
      },
      context: () => ({
        cookies: async () => [],
      }),
    } as unknown as Page;

    const findings = await checker.checkPage(mockPage, {
      testCaseId: 'TC-INSECURE-SCRIPT',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
    });

    const scriptFinding = findings.find((f) => f.title.includes('Insecure resource loaded over unencrypted HTTP'));
    expect(scriptFinding).toBeDefined();
    expect(scriptFinding?.expectedVsActual.actual).toContain('http://code.jquery.com/jquery-1.11.0.min.js');
    expect(scriptFinding?.severity).toBe('Major');
  });

  it('flags exposed internal stack traces in page body', async () => {
    const mockPage = {
      url: () => 'http://localhost:3050/api/failing-endpoint',
      evaluate: async (fn: any, patternStr: string) => {
        return 'at Object.<anonymous> (/app/server.js:45:12)\nnode:internal/process/task_queues:95:5';
      },
      context: () => ({
        cookies: async () => [],
      }),
    } as unknown as Page;

    const findings = await checker.checkPage(mockPage, {
      testCaseId: 'TC-TRACE',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/api/failing-endpoint',
    });

    const traceFinding = findings.find((f) => f.title.includes('stack trace'));
    expect(traceFinding).toBeDefined();
    expect(traceFinding?.severity).toBe('Major');
  });

  it('flags insecure cookie flags (missing Secure on HTTPS, missing HttpOnly on auth cookies)', async () => {
    const mockPage = {
      url: () => 'https://example.com/account',
      evaluate: async () => [],
      context: () => ({
        cookies: async () => [{ name: 'session_token', secure: false, httpOnly: false, sameSite: 'None' }],
      }),
    } as unknown as Page;

    const findings = await checker.checkPage(mockPage, {
      testCaseId: 'TC-COOKIES',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/account',
    });

    expect(findings.some((f) => f.title.includes('missing the Secure flag'))).toBe(true);
    expect(findings.some((f) => f.title.includes('missing HttpOnly flag'))).toBe(true);
  });

  describe('SameSite cookies', () => {
    const run = async (cookie: Record<string, unknown>) => {
      const mockPage = {
        url: () => 'https://example.com/',
        evaluate: async () => [],
        context: () => ({ cookies: async () => [cookie] }),
      } as unknown as Page;
      const findings = await checker.checkPage(mockPage, { role: 'visitor', breakpoint: '1440px', urlPath: '/' });
      return findings.filter((f) => f.title.includes('SameSite'));
    };

    it('flags SameSite=None on a Secure cookie', async () => {
      const found = await run({ name: 'prefs', secure: true, httpOnly: true, sameSite: 'None' });
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe('Minor');
    });

    it('rates SameSite=None on a Secure session cookie as Major', async () => {
      const found = await run({ name: 'session_id', secure: true, httpOnly: true, sameSite: 'None' });
      expect(found[0].severity).toBe('Major');
    });

    it('rates SameSite=None without Secure as Major', async () => {
      const found = await run({ name: 'prefs', secure: false, httpOnly: true, sameSite: 'None' });
      expect(found[0].title).toContain('without Secure');
      expect(found[0].severity).toBe('Major');
    });

    it('leaves SameSite=Lax alone', async () => {
      expect(await run({ name: 'prefs', secure: true, httpOnly: true, sameSite: 'Lax' })).toHaveLength(0);
    });
  });

  describe('mixed content from CSS and scripts', () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await chromium.launch();
    });
    afterAll(async () => {
      await browser.close();
    });

    it('flags an http:// request the page made that no HTML attribute shows', async () => {
      const page = await (await browser.newContext()).newPage();
      try {
        await page.route('**/*', (route) => {
          const url = route.request().url();
          if (url === 'https://secure.test/') {
            return route.fulfill({
              contentType: 'text/html',
              body: '<html><body><script>fetch("http://plain.test/data.json").catch(()=>{})</script></body></html>',
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{}',
            headers: { 'access-control-allow-origin': '*' },
          });
        });
        await page.goto('https://secure.test/');
        await page.waitForTimeout(300);
        const findings = await checker.checkPage(page, { role: 'visitor', breakpoint: '1440px', urlPath: '/' });
        expect(findings.some((f) => f.expectedVsActual.actual.includes('http://plain.test/data.json'))).toBe(true);
      } finally {
        await page.context().close();
      }
    });
  });

  describe('CORS misconfiguration audits (FR-6.5)', () => {
    it('flags wildcard Access-Control-Allow-Origin when credentials are true', () => {
      const findings = checker.checkCors(
        {
          'access-control-allow-origin': '*',
          'access-control-allow-credentials': 'true',
        },
        { role: 'visitor', breakpoint: '1440px', urlPath: '/api/user' }
      );

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('Major');
      expect(findings[0].title).toBe('Insecure CORS configuration: Wildcard origin with credentials allowed');
    });

    it('flags "null" Access-Control-Allow-Origin', () => {
      const findings = checker.checkCors(
        {
          'access-control-allow-origin': 'null',
        },
        { role: 'visitor', breakpoint: '1440px', urlPath: '/api/profile' }
      );

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('Major');
      expect(findings[0].title).toBe('Insecure CORS configuration: "null" origin allowed');
    });

    it('passes safe explicit origin with credentials', () => {
      const findings = checker.checkCors(
        {
          'access-control-allow-origin': 'https://app.example.com',
          'access-control-allow-credentials': 'true',
        },
        { role: 'visitor', breakpoint: '1440px', urlPath: '/api/user' }
      );

      expect(findings).toHaveLength(0);
    });
  });

  describe('passive CORS and CSRF checks (QSP-010)', () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await chromium.launch();
    });
    afterAll(async () => {
      await browser.close();
    });
    const base = { role: 'visitor', breakpoint: '1440px' as const, urlPath: '/' };
    const csrfOn = async (html: string, cookies: Array<Record<string, unknown>> = []) => {
      const page = await browser.newPage();
      try {
        await page.setContent(html);
        const proxy = {
          evaluate: page.evaluate.bind(page),
          url: () => page.url(),
          context: () => ({ cookies: async () => cookies }),
        } as unknown as Page;
        return await checker.checkCsrf(proxy, base);
      } finally {
        await page.close();
      }
    };
    const FORM = '<form method="post" action="/save?x=1"><input name="nick"><button>Save</button></form>';

    it('CORS wildcard without credentials is Minor; exact origin or absent header is not flagged', () => {
      const any = checker.checkCors({ 'Access-Control-Allow-Origin': '*' }, base);
      expect(any).toHaveLength(1);
      expect(any[0].severity).toBe('Minor');
      expect(checker.checkCors({ 'access-control-allow-origin': 'https://app.example.com' }, base)).toHaveLength(0);
      expect(checker.checkCors({}, base)).toHaveLength(0);
    });

    it('the security checker never builds an Origin request header or sends a request of its own', () => {
      const src = readFileSync(fileURLToPath(new URL('../src/security.ts', import.meta.url)), 'utf8');
      expect(src).not.toMatch(/['"]origin['"]\s*:/i);
      expect(src).not.toMatch(/setExtraHTTPHeaders|fetch\(|\.post\(|\.put\(|\.delete\(/);
    });

    it('flags a POST form with no token, by action path only', async () => {
      const found = await csrfOn(FORM);
      expect(found).toHaveLength(1);
      expect(found[0].title).toBe('No CSRF token found on this form');
      expect(found[0].severity).toBe('Minor');
      expect(found[0].expectedVsActual.actual).toContain('/save');
      expect(found[0].expectedVsActual.actual).not.toContain('x=1');
      expect(JSON.stringify(found)).not.toMatch(/vulnerable|\bsecure\b/i);
    });

    it('leaves a form with a hidden token, a meta token, a GET form or a sign-in form alone', async () => {
      expect(await csrfOn('<form method="post"><input type="hidden" name="csrf_token" value="v"></form>')).toHaveLength(
        0
      );
      expect(await csrfOn(`<head><meta name="csrf-token" content="v"></head>${FORM}`)).toHaveLength(0);
      expect(await csrfOn('<form method="get" action="/s"><input name="q"></form>')).toHaveLength(0);
      expect(await csrfOn('<form method="post"><input type="password" name="p"></form>')).toHaveLength(0);
    });

    it('a SameSite=Lax cookie suppresses the finding', async () => {
      expect(await csrfOn(FORM, [{ name: 'sid', sameSite: 'Lax' }])).toHaveLength(0);
      expect(await csrfOn(FORM, [{ name: 'sid', sameSite: 'None' }])).toHaveLength(1);
    });

    it('cookie flags: Secure only on https, HttpOnly on session cookies, no values in text', async () => {
      const run = async (url: string, cookie: Record<string, unknown>) => {
        const mockPage = {
          url: () => url,
          evaluate: async () => [],
          context: () => ({ cookies: async () => [cookie] }),
        } as unknown as Page;
        return checker.checkPage(mockPage, { ...base });
      };
      const local = await run('http://localhost:3050/', {
        name: 'session_id',
        value: 'SENTINEL-COOKIE-VALUE',
        secure: false,
        httpOnly: true,
        sameSite: 'Lax',
      });
      expect(local.some((f) => f.title.includes('Secure flag'))).toBe(false);
      const https = await run('https://example.com/', {
        name: 'session_id',
        value: 'SENTINEL-COOKIE-VALUE',
        secure: false,
        httpOnly: false,
        sameSite: 'Lax',
      });
      expect(https.some((f) => f.title.includes('Secure flag'))).toBe(true);
      expect(https.some((f) => f.title.includes('HttpOnly'))).toBe(true);
      expect(JSON.stringify(https)).not.toContain('SENTINEL-COOKIE-VALUE');
    });
  });

  it('passes the main response headers to the HSTS and nosniff checks', async () => {
    const mockPage = {
      url: () => 'https://example.com/',
      evaluate: async () => [],
      context: () => ({ cookies: async () => [] }),
    } as unknown as Page;
    const findings = await checker.checkPage(mockPage, {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: 'https://example.com/',
      responseHeaders: { 'content-type': 'text/html' },
    });
    expect(findings.some((f) => f.title.includes('X-Content-Type-Options'))).toBe(true);
  });
});
