import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { chromium, type Browser, type BrowserContext, type Route } from 'playwright';
import { installSubmitGuard, type BlockedSubmit } from '../src/discovery/submit-guard.js';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import type { PreFlightResult } from '../src/preflight.js';
import { SENSITIVE_PAUSED } from '../src/discovery/click-gate.js';
import type { TestCase } from '@qa/types';

// T-422: no form is sent outside the Plan, by script or by Enter. Routed pages only (ADR 0040).
const origin = 'https://app.example';
const html = (body: string) =>
  `<!doctype html><html><head><title>App</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>App</h1>${body}</main></body></html>`;

describe('submit guard (T-422)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  const open = async (body: string, readOnly: boolean) => {
    const context: BrowserContext = await browser.newContext();
    const sent: string[] = [];
    const blocked: BlockedSubmit[] = [];
    context.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname !== '/') sent.push(`${r.method()} ${u.pathname}`);
    });
    await context.route('**/*', (route: Route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: html(body) });
      return route.fulfill({ status: 200, contentType: 'text/html', body: html('<p>sent</p>') });
    });
    await installSubmitGuard(context, { readOnly, onBlocked: (b) => blocked.push(b) });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    return { context, page, sent, blocked };
  };

  it('on a read-only run, form.submit() and form.requestSubmit() from page script send no request', async () => {
    const { context, page, sent, blocked } = await open(
      `<form id="f" method="post" action="/api/save"><input name="q" value="1"><button>Save</button></form>`,
      true
    );
    try {
      await page.evaluate(() => (document.getElementById('f') as HTMLFormElement).submit());
      await page.evaluate(() => (document.getElementById('f') as HTMLFormElement).requestSubmit());
      await page.waitForTimeout(300);
      expect(sent).toEqual([]);
      expect(blocked.map((b) => b.how)).toEqual(['submit', 'requestSubmit']);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('on a Test Copy, a form whose button says "Delete" is not sent by Enter', async () => {
    const { context, page, sent, blocked } = await open(
      `<form method="post" action="/api/items"><input id="name" name="name" value="draft"><button>Delete</button></form>`,
      false
    );
    try {
      await page.locator('#name').press('Enter');
      await page.waitForTimeout(300);
      expect(sent).toEqual([]);
      expect(blocked).toEqual([{ how: 'event', sensitive: true, action: '/api/items' }]);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('on a Test Copy, a sign-in form still submits', async () => {
    const { context, page, sent, blocked } = await open(
      `<form method="post" action="/login"><input id="user" name="user" value="a"><input type="password" name="p" value="b"><button>Sign in</button></form>`,
      false
    );
    try {
      await Promise.all([page.waitForURL(`${origin}/login`), page.locator('#user').press('Enter')]);
      expect(sent).toEqual(['POST /login']);
      expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('a Sensitive Action form sent by script is stopped on a Test Copy too, and a plain one is sent', async () => {
    const { context, page, sent } = await open(
      `<form id="del" method="post" action="/account/delete"><button>Go</button></form>
       <form id="ok" method="post" action="/profile"><button>Save</button></form>`,
      false
    );
    try {
      await page.evaluate(() => (document.getElementById('del') as HTMLFormElement).submit());
      await page.waitForTimeout(200);
      expect(sent).toEqual([]);
      await Promise.all([
        page.waitForURL(`${origin}/profile`),
        page.evaluate(() => (document.getElementById('ok') as HTMLFormElement).submit()),
      ]);
      expect(sent).toEqual(['POST /profile']);
    } finally {
      await context.close();
    }
  }, 30_000);
});

describe('a Check-up step whose page script sends a Sensitive Action form is paused (T-422)', () => {
  let tmpDir: string | undefined;
  const origCreateContext = BrowserManager.prototype.createContext;
  const posts: string[] = [];
  const preflight = {
    ok: true,
    roleAuthResults: {},
    roleStorageStates: {},
    roleLandingPaths: {},
    roleFailures: {},
    roleDiagnostics: {},
  } as PreFlightResult;

  beforeEach(() => {
    posts.length = 0;
    vi.spyOn(BrowserManager.prototype, 'createContext').mockImplementation(async function (
      this: BrowserManager,
      options
    ) {
      const context = await origCreateContext.call(this, options);
      await context.route('**/*', async (route: Route) => {
        if (route.request().method() === 'POST') {
          posts.push(new URL(route.request().url()).pathname);
          return route.fulfill({ status: 200, contentType: 'text/html', body: html('<p>done</p>') });
        }
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: html(
            `<form id="f" method="post" action="/account/delete"><button type="submit">Delete account</button></form>
             <button id="next" onclick="document.getElementById('f').requestSubmit()">Next</button>`
          ),
        });
      });
      return context;
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  });

  it('the form is not sent and the Test point is Skipped with the reason', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safety-submit-guard-'));
    const tc: TestCase = {
      id: 'TC-NEXT',
      flowId: 'flow-next',
      name: 'Next',
      role: 'visitor',
      startPage: '/',
      kind: 'page-test',
      steps: [{ action: 'click', selector: '#next', name: 'Click “Next”' }],
      expectations: {},
    };
    const report = await new FlowTestOrchestrator().run({
      targetUrl: 'http://test.local',
      productId: 'submit-guard',
      specTestCases: [tc],
      preflight,
      outputDir: tmpDir,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      recordVideo: false,
      readOnly: false,
      testCopy: true,
    });
    expect(posts).toEqual([]);
    expect(report.results[0].status).toBe('Skipped');
    expect(report.results[0].skipReason).toContain(SENSITIVE_PAUSED);
  }, 60_000);
});
