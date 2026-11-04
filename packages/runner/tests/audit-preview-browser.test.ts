/**
 * QA-600 (REQ-024 AC-1, browser): Chromium opens a stored homepage preview through GET /api/audits/:id/preview and
 * through its Shared Link on the real runner, clicks a menu link and an in-page link, and the navigation happens.
 * Every request that is not to this runner is intercepted and answered locally, so no real site is contacted.
 * The preview page runs no script (CSP header, no script element, no page error). Fixed port 3845.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
// The runner package does not depend on Playwright (a new dependency needs its own planned task); core does, so it
// is resolved from core's folder. Same module the core and wizard browser tests use.
import type { Browser, BrowserContext, Page } from '../../core/node_modules/playwright';
import type { AICompletionOptions, AuditAiModels, ShareLink } from '@qa/types';
import { AuditStore, emptyOverlay, pageContentName, resolveAuditAi, type AIProvider } from '@qa/core';
import { generatePreview } from '../../core/src/audit/preview/index.js';
import { auditDocContents, auditDocResult, PATHS } from '../../core/tests/helpers/audit-doc-fixture.js';
import { RunnerServer } from '../src/server.js';

const { chromium } = createRequire(path.resolve(__dirname, '../../core/package.json'))(
  'playwright'
) as typeof import('../../core/node_modules/playwright');

const PORT = 3845;
const ORIGIN = `http://localhost:${PORT}`;
const ACCESS = 'preview-browser-key-0123456789';
const SITE = 'https://shop.example.in';
const AI_PAGE =
  '<nav><a href="/about">About</a><a href="/services">Services</a></nav>' +
  '<h1 id="top">Fresh groceries</h1><p><a href="#top">Back to the top</a></p>';

let scratch: string;
let server: RunnerServer;
let browser: Browser;
let auditId: string;
let linkId: string;
const outside: string[] = [];

const provider: AIProvider = {
  providerType: 'openrouter',
  async generateText(_messages: unknown, _options?: AICompletionOptions) {
    return AI_PAGE;
  },
};

/** A browser context that answers every request outside this runner with a plain stub page and records it. */
async function newContext(withKey: boolean): Promise<BrowserContext> {
  const context = await browser.newContext();
  if (withKey) await context.addCookies([{ name: 'qa_access', value: ACCESS, url: ORIGIN }]);
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN)) return route.continue();
    outside.push(url);
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title><p>outside stub</p>' });
  });
  return context;
}

async function expectNoScript(page: Page, errors: string[]): Promise<void> {
  expect(await page.evaluate(() => document.scripts.length)).toBe(0);
  expect(await page.evaluate(() => document.querySelectorAll('[onclick],[onload],[onerror]').length)).toBe(0);
  expect(errors).toEqual([]);
}

async function clickThrough(page: Page, label: string): Promise<void> {
  const base = outside.length;
  // The menu link: an address on the audited site; it opens in a new tab, answered by the interceptor.
  const menu = page.getByRole('link', { name: 'About' }).first();
  await menu.waitFor();
  const popupPromise = page.context().waitForEvent('page');
  await menu.click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url(), `${label}: menu link`).toBe(`${SITE}/about`);
  expect(await popup.locator('p').innerText()).toBe('outside stub');
  expect(outside.slice(base)).toContain(`${SITE}/about`);
  await popup.close();

  // The in-page link: the same page, now at #top.
  const before = page.url();
  expect(new URL(before).hash).toBe('');
  await page.getByRole('link', { name: 'Back to the top' }).click();
  await page.waitForFunction(() => location.hash === '#top');
  expect(new URL(page.url()).pathname, `${label}: in-page link`).toBe(new URL(before).pathname);
  expect(new URL(page.url()).hash).toBe('#top');
}

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-preview-browser-'));
  server = new RunnerServer({
    port: PORT,
    host: 'localhost',
    outputDir: path.join(scratch, 'report'),
    dataDir: path.join(scratch, 'data'),
    accessToken: ACCESS,
  });
  await server.start();
  const store: AuditStore = server.auditWiring.store;
  const v = await store.createAudit({
    url: `${SITE}/`,
    limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
    language: 'en',
  });
  auditId = v.auditId;
  const result = { ...auditDocResult(), auditId, version: 1 };
  await store.saveResult(auditId, 1, result);
  const home = auditDocContents().find((c) => c.urlPath === PATHS.home)!;
  for (const content of auditDocContents())
    await store.writeVersionJson(auditId, 1, pageContentName(content.urlPath), content);
  await store.updateVersion(auditId, 1, { status: 'done', finishedAt: '2026-11-03T10:00:00.000Z' });

  // A real preview page: core's generator with a fake AI provider, stored as the create row would store it.
  const models: AuditAiModels = { preview: 'preview/model-x' };
  const resolved = await resolveAuditAi({
    setup: { provider: 'openrouter', text: 'default/text', vision: 'default/vision' },
    keys: { resolveKey: async () => ({ provider: 'openrouter', apiKey: 'test-key-not-real', source: 'keychain' }) },
    models,
    createProvider: () => provider,
  });
  if (!resolved.ok) throw new Error('fake AI did not resolve');
  const generated = await generatePreview(
    { result, home, edits: emptyOverlay(), language: 'en' },
    { ai: resolved.ai, fetchImage: async () => null }
  );
  if (!generated.ok) throw new Error(`preview not generated: ${generated.problem}`);
  await store.putVersionFile(auditId, 1, 'preview.html', new TextEncoder().encode(generated.html));

  const headers = { 'x-qa-access': ACCESS, 'content-type': 'application/json' };
  const created = await fetch(`${ORIGIN}/api/audits/${auditId}/share`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'preview', language: 'en', version: 1 }),
  });
  if (created.status !== 201) throw new Error(`share not created: ${created.status}`);
  linkId = ((await created.json()) as { link: ShareLink }).link.id;

  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('REQ-024 AC-1: the stored preview in Chromium', () => {
  it('opens through GET /api/audits/:id/preview, and its menu and in-page links navigate; no script runs', async () => {
    const context = await newContext(true);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const response = await page.goto(`${ORIGIN}/api/audits/${auditId}/preview`);
    expect(response!.status()).toBe(200);
    const csp = response!.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).not.toMatch(/script-src[^;]*('unsafe-inline'|'unsafe-eval'|https?:)/);
    expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(await page.getByRole('heading', { name: 'Fresh groceries' }).count()).toBe(1);

    await clickThrough(page, 'owner preview');
    await expectNoScript(page, errors);
    await context.close();
  });

  it('opens through its Shared Link with no access key, and its menu and in-page links navigate; no script runs', async () => {
    const context = await newContext(false);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const response = await page.goto(`${ORIGIN}/s/${linkId}`);
    expect(response!.status()).toBe(200);
    expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(response!.headers()['content-security-policy']).toMatch(/default-src 'none'/);
    expect(await page.getByRole('heading', { name: 'Fresh groceries' }).count()).toBe(1);

    await clickThrough(page, 'shared link');
    await expectNoScript(page, errors);
    await context.close();
  });

  it('contacted only the stubbed menu addresses: nothing else left the runner', async () => {
    expect(outside.length).toBeGreaterThan(0);
    for (const url of outside) expect(url.startsWith(`${SITE}/`), url).toBe(true);
  });
});
