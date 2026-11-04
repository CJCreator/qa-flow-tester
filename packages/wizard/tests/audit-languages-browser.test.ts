/**
 * QA-712 (REQ-044): Tamil on the Website Audit screens in Chromium, against an audit of
 * fixtures/audit-site. The document-language choice, Hindi, phone screenshot and Hindi export checks are
 * deferred (DEC-013) and have no test here. Slow: builds the wizard and serves it from a real RunnerServer, like
 * landing-audit-browser.test.ts and wizard-e2e.test.ts.
 *
 * The audit accepts public addresses only, so the route table swaps the start and stream rows for the same rows
 * built with a fake DNS and network (the harness of runner/tests/website-audit-e2e.test.ts, QA-195): the
 * public-looking host `kaveri.test` resolves to a public address, connections go to the fixture on 127.0.0.1 and
 * the launcher rewrites Chromium's resolver pin. The public-only guard itself is not weakened.
 *
 * Document headings are compared with the label tables of @qa/core (the Tamil table), not with copies.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { build } from 'vite';
import {
  sectionText,
  type AuditStartReply,
  type PageContent,
} from '@qa/types';
import {
  checkAuditAddress,
  defaultNetDeps,
  runAuditCrawl,
  type AuditBrowserLauncher,
  type NetDeps,
} from '@qa/core';
import { RunnerServer } from '../../runner/src/server.js';
import { allRoutes } from '../../runner/src/routes/index.js';
import { auditPipelineStep, createAuditCrawlRoutes } from '../../runner/src/routes/audit-crawl.js';
import type { Route, RouteContext } from '../../runner/src/routes/route.js';
import { AuditRuns } from '../../runner/src/session/audit-run.js';
import { labelsFor } from '../../core/src/audit/documents/labels/index.js';
import { startAuditSite, type AuditSiteServer } from '../../core/tests/helpers/audit-site-server.js';

const TOOL_PORT = 3871;
const toolUrl = `http://localhost:${TOOL_PORT}`;
const wizardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(wizardRoot, '..', '..');
const SITE_HOST = 'kaveri.test';
const PUBLIC_ADDRESS = '93.184.216.34';

/** The wizard package has no Playwright of its own to launch the audit's Chromium: take @qa/core's. */
const { chromium: auditChromium } = createRequire(path.join(repoRoot, 'packages/core/package.json'))(
  'playwright'
) as typeof import('playwright');

const netDeps: NetDeps = {
  async lookup(host) {
    if (host === SITE_HOST) return [PUBLIC_ADDRESS];
    throw new Error('ENOTFOUND');
  },
  connect: (req) => defaultNetDeps.connect({ ...req, address: '127.0.0.1' }),
};

const launchBrowser: AuditBrowserLauncher = (options) =>
  auditChromium.launch({
    ...options,
    args: (options.args ?? []).map((a) => a.replace(PUBLIC_ADDRESS, '127.0.0.1')),
  });

/** The start and stream rows with the fake network; built on first use, with the runner's own store. */
function auditRowsWithFakeNetwork(): Route[] {
  const runs = new AuditRuns();
  let rows: Route[] | undefined;
  const build = (context: RouteContext): Route[] => {
    if (rows) return rows;
    const { store, isOwnerRequest } = context.server.auditWiring;
    rows = createAuditCrawlRoutes({
      store,
      runs,
      caller: (c) => ({ owner: isOwnerRequest(c.req) }),
      checkAddress: (url) => checkAuditAddress(url, { netDeps }),
      crawl: (request, opts) => runAuditCrawl(request, { ...opts, deps: { netDeps, launchBrowser } }),
      afterCrawl: auditPipelineStep({ store }),
    });
    return rows;
  };
  const delegate = (index: number): Route['handle'] => (context) => build(context)[index].handle(context);
  const [startRow, streamRow] = createAuditCrawlRoutes({
    store: undefined as never,
    caller: () => ({ owner: false }),
  });
  return [
    { ...startRow, handle: delegate(0) },
    { ...streamRow, handle: delegate(1) },
  ];
}

const pathOf = (p: string) => new URL(p, 'http://x.invalid').pathname;
const codePoints = (s: string) => Array.from(s).map((c) => c.codePointAt(0));

describe('Website Audit screens: Tamil content and export (browser)', () => {
  let dir: string;
  let uiDir: string;
  let server: RunnerServer;
  let site: AuditSiteServer;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let auditId: string;
  let contentOf: (urlPath: string) => Promise<PageContent>;
  let result: { pages: Array<{ urlPath: string }> };

  // Explicit timeout (300 s): the wizard build plus the fixture audit run slowly under full-suite load, beyond the
  // 30 s hookTimeout of vitest.config.ts (EV-0235).
  beforeAll(async () => {
    dir =await fs.mkdtemp(path.join(os.tmpdir(), 'audit-languages-browser-'));
    uiDir = path.join(dir, 'ui');
    await build({
      root: wizardRoot,
      configFile: path.join(wizardRoot, 'vite.config.ts'),
      logLevel: 'error',
      build: { outDir: path.join(uiDir, 'wizard'), emptyOutDir: true },
    });
    site = await startAuditSite();
    // No access key: a request from this computer is the owner (DEC-004), which the browser and fetch both are.
    server = new RunnerServer({
      port: TOOL_PORT,
      host: 'localhost',
      outputDir: path.join(dir, 'report'),
      dataDir: path.join(dir, 'data'),
      ui: [{ base: '/', dir: path.join(uiDir, 'wizard'), name: 'Wizard' }],
      routes: [
        ...allRoutes.filter(
          (r) => !(r.method === 'POST' && r.path === '/api/audits') && r.path !== '/api/audits/:id/stream'
        ),
        ...auditRowsWithFakeNetwork(),
      ],
    });
    await server.start();

    const started = await fetch(`${toolUrl}/api/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `http://${SITE_HOST}:${site.port}/`, maxPages: 60, maxDepth: 3 }),
    });
    expect(started.status).toBe(202);
    auditId = ((await started.json()) as AuditStartReply).auditId;
    // Read the progress stream to its end ('done' or 'failed').
    const stream = await fetch(`${toolUrl}/api/audits/${auditId}/stream`);
    const body = await stream.text();
    expect(body).toContain('"type":"done"');

    const got = await (await fetch(`${toolUrl}/api/audits/${auditId}`)).json();
    result = got.result ?? got.audit?.result ?? got;
    contentOf = async (urlPath) => {
      const res = await fetch(`${toolUrl}/api/audits/${auditId}/content?path=${encodeURIComponent(urlPath)}`);
      return ((await res.json()) as { content: PageContent }).content;
    };

    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
  }, 300000);

  // Explicit timeout: closing Chromium and the server can pass the 30 s hookTimeout under full-suite load (EV-0235).
  afterAll(async () => {
    await browser?.close();
    await server?.stop();
    await site?.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }, 120_000);

  /** The page's button in the results list, picked so its Page Content loads. */
  async function openResultsPage(urlPath: string): Promise<void> {
    await page.goto(`${toolUrl}/audits/${encodeURIComponent(auditId)}/versions/1`);
    await page.getByRole('heading', { level: 1, name: 'Website Audit analysis' }).waitFor({ timeout: 20000 });
    const entry = result.pages.find((p) => pathOf(p.urlPath) === urlPath);
    expect(entry, `${urlPath} is in the audit`).toBeTruthy();
    await page.getByRole('button', { name: new RegExp(entry!.urlPath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')) }).first().click();
    await page.getByRole('heading', { name: /^Page Content/ }).waitFor({ timeout: 20000 });
  }

  for (const [urlPath, lang] of [['/ta', 'ta']] as const) {
    it(`results show the ${urlPath} Page Content unchanged, inside an element with lang="${lang}"`, async () => {
      const content = await contentOf(urlPath);
      expect(content.language.primary).toBe(lang);
      await openResultsPage(urlPath);

      // The page's own text, read from the fixture file the audit read.
      const html = await fs.readFile(path.join(repoRoot, 'fixtures', 'audit-site', lang, 'index.html'), 'utf8');
      const h1 = content.headings.find((h) => h.level === 1)!.text;
      expect(html).toContain(h1);

      const inLang = (await page.locator(`[lang="${lang}"]`).allTextContents()).map((t) => codePoints(t));
      expect(inLang.length, `elements with lang="${lang}"`).toBeGreaterThan(0);
      // Every Section's text and the first heading appear in a lang element, code point for code point.
      const wanted = [h1, ...content.sections.map((s) => sectionText(content, s)).filter((t) => t.trim() !== '')];
      for (const text of wanted) {
        expect(
          inLang.some((cp) => JSON.stringify(cp) === JSON.stringify(codePoints(text))),
          `${JSON.stringify(text.slice(0, 40))} shown unchanged in a lang="${lang}" element; shown: ${JSON.stringify(
            inLang.map((cp) => String.fromCodePoint(...(cp as number[])).slice(0, 40))
          )}`
        ).toBe(true);
      }
    }, 90000);
  }

  describe('the documents screen', () => {
    const exportScreen = () => `${toolUrl}/audits/${encodeURIComponent(auditId)}/versions/1/export`;

    /** Picks `name` in the Audit Documents language choice and returns the download's text. */
    async function exportIn(name: string): Promise<string> {
      await page.goto(exportScreen());
      await page.getByRole('heading', { level: 1, name: 'Export the Audit Documents' }).waitFor({ timeout: 20000 });
      const group = page.getByRole('group', { name: 'Language' }).first();
      const radio = group.getByRole('radio', { name });
      expect(await radio.count(), `${name} is offered on the documents screen`).toBeGreaterThan(0);
      await radio.check();
      const link = page.getByRole('link', { name: /^Download the Audit Documents/ });
      const href = await link.getAttribute('href');
      expect(href).toContain('language=ta');
      const res = await context.request.get(new URL(href!, toolUrl).toString());
      expect(res.status()).toBe(200);
      return await res.text();
    }

    it('exporting in Tamil downloads documents whose headings come from the Tamil table', async () => {
      const tamil = labelsFor('ta');
      expect(tamil.fallback).toBe(false);
      const text = await exportIn('Tamil');
      for (const kind of ['structure', 'content', 'findings', 'roadmap', 'proposal'] as const) {
        expect(text, `Tamil heading for ${kind}`).toContain(tamil.labels.documentTitles[kind]);
      }
    }, 60000);
  });
});
