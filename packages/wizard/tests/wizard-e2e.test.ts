/**
 * Drives the real wizard in Chromium against a real runner and the fixture app.
 * Only the outside world is faked: OpenRouter (key check + model list) and the AI model.
 * Set WIZARD_SCREENSHOTS=<dir> to also save a screenshot of every screen.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { RunnerServer } from '@qa/runner';
import { DiscoveryAgent, KeyResolver, MockAIProvider, OpenRouterClient, type SecretStore } from '@qa/core';
import type { ReleaseReport } from '@qa/types';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { summarizeReport } from '../src/lib/summary';

const FIXTURE_PORT = 3485;
const RUNNER_PORT = 3486;
const WIZARD_PORT = 3487;
const fixtureHost = `localhost:${FIXTURE_PORT}`;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const wizardUrl = `http://localhost:${WIZARD_PORT}/`;
const wizardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(process.cwd(), '.tmp-wizard-e2e');
const screenshotDir = process.env.WIZARD_SCREENSHOTS;

const GOOD_KEY = 'sk-or-v1-e2e-good-key';
const FREE_MODEL = {
  id: 'vendor/helpful:free',
  name: 'Helpful',
  context_length: 128000,
  pricing: { prompt: '0', completion: '0' },
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  supported_parameters: ['response_format'],
};

class MemoryStore implements SecretStore {
  secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
}

const openRouterModels: { list: unknown[] } = { list: [] };
const fakeOpenRouterFetch = (async (url: string, init?: RequestInit) => {
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
  if (url.endsWith('/key')) return new Response('{}', { status: auth === `Bearer ${GOOD_KEY}` ? 200 : 401 });
  if (url.endsWith('/models')) return new Response(JSON.stringify({ data: openRouterModels.list }));
  return new Response('', { status: 404 });
}) as typeof fetch;

/** Raw internals that must never be shown to the person using the wizard. */
const JARGON = /RUN_STARTED|RUN_COMPLETED|STEP_STARTED|TEST_POINT|FINDINGS_UPDATED|DISCOVERY_|data-testid|locator\.|Pre-flight|\bBlocker\b|\bMajor\b|undefined|\[object/;

describe('Wizard end to end', () => {
  let runner: RunnerServer;
  let vite: ViteDevServer;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const runRequests: Array<Record<string, unknown>> = [];
  const seenText: string[] = [];
  let shot = 0;

  const screenshot = async (name: string) => {
    if (!screenshotDir) return;
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, `${String(++shot).padStart(2, '0')}-${name}.png`), fullPage: true });
  };
  const heading = () => page.getByRole('heading', { level: 1 });
  const waitForRunnerIdle = async () => {
    for (let i = 0; i < 120; i++) {
      const status = await (await fetch(`${runnerUrl}/api/runner/status`)).json();
      if (!status.isRunning) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('runner stayed busy');
  };
  /** Records the visible text every 300 ms while a run is in progress, to check no jargon ever shows. */
  const watchText = () => {
    seenText.length = 0;
    const timer = setInterval(async () => {
      try {
        seenText.push(await page.locator('main').innerText());
      } catch {
        // page navigating
      }
    }, 300);
    return () => clearInterval(timer);
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir: `${outputDir}-data`,
      keyResolver: new KeyResolver(outputDir, new MemoryStore()),
      openRouter: new OpenRouterClient(fakeOpenRouterFetch),
      createAIProvider: () => new MockAIProvider(),
    });
    process.env.VITE_RUNNER_URL = runnerUrl;
    vite = await createServer({
      root: wizardRoot,
      configFile: path.join(wizardRoot, 'vite.config.ts'),
      server: { port: WIZARD_PORT, strictPort: true },
      logLevel: 'error',
    });
    await vite.listen();
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    page = await context.newPage();
    page.on('request', (req: Request) => {
      if (req.url() === `${runnerUrl}/api/runner/run` && req.method() === 'POST') runRequests.push(req.postDataJSON());
    });
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await runner?.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(`${outputDir}-data`, { recursive: true, force: true }).catch(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Task 1.2: explains how to start the QA Tool, polls gently, and continues once it is running', async () => {
    let statusChecks = 0;
    page.on('request', (req) => {
      if (req.url().endsWith('/api/runner/status')) statusChecks++;
    });

    await page.goto(wizardUrl);
    await expect.poll(() => heading().innerText()).toBe('Start the QA Tool first');
    await expect.poll(() => page.getByText('docker compose up').count()).toBeGreaterThan(0);
    await page.waitForTimeout(7000);
    // 7 s at one check every 3 s is about 3 checks; never a tight loop
    expect(statusChecks).toBeGreaterThanOrEqual(2);
    expect(statusChecks).toBeLessThanOrEqual(4);
    await screenshot('connection');

    await runner.start();
    const startedAt = Date.now();
    await expect.poll(() => heading().innerText(), { timeout: 5000 }).toBe('Connect an AI helper');
    expect(Date.now() - startedAt).toBeLessThan(4500);
  }, 30000);

  it('Tasks 1.3 / 1.4: checks the key as it is pasted, handles no free models, then remembers the setup', async () => {
    const keyInput = page.getByLabel('OpenRouter key');
    const save = page.getByRole('button', { name: 'Save key and continue' });

    await keyInput.fill('sk-or-v1-revoked');
    await expect.poll(() => page.locator('#ai-key-status').innerText()).toContain('Key invalid or out of credit');
    expect(await save.isDisabled()).toBe(true);
    await screenshot('key-invalid');

    await keyInput.fill(GOOD_KEY);
    const pastedAt = Date.now();
    await expect.poll(() => page.locator('#ai-key-status').innerText(), { timeout: 2000 }).toContain('Key is active');
    expect(Date.now() - pastedAt).toBeLessThan(2000);
    expect(await save.isDisabled()).toBe(false);
    await screenshot('key-valid');

    openRouterModels.list = [];
    await save.click();
    await expect
      .poll(() => page.getByRole('alert').innerText())
      .toBe('No free AI models are available right now — please try again later.');
    expect(await heading().innerText()).toBe('Connect an AI helper');

    openRouterModels.list = [FREE_MODEL];
    await save.click();
    await expect.poll(() => heading().innerText()).toBe('What would you like to check?');
    // The QA Tool, not this browser, remembers the key and the model it chose.
    expect(await (await fetch(`${runnerUrl}/api/ai/openrouter/key`)).json()).toMatchObject({ configured: true, model: FREE_MODEL.id });

    await page.reload();
    await expect.poll(() => heading().innerText()).toBe('What would you like to check?');

    // A different browser (nothing stored in it) skips the key screen too.
    const otherBrowser = await browser.newContext();
    const otherPage = await otherBrowser.newPage();
    await otherPage.goto(wizardUrl);
    await expect.poll(() => otherPage.locator('h1').first().innerText(), { timeout: 10000 }).toBe('What would you like to check?');
    await otherBrowser.close();

    await page.getByRole('button', { name: 'Change AI key' }).click();
    await expect.poll(() => heading().innerText()).toBe('Connect an AI helper');
    await page.getByRole('button', { name: 'Keep my current key' }).click();
    await expect.poll(() => heading().innerText()).toBe('What would you like to check?');
    await screenshot('target');
  }, 30000);

  it('Phases 2–4: product path from address to downloaded report', async () => {
    await page.getByRole('button', { name: /A product I work on/ }).click();
    await expect.poll(() => heading().innerText()).toBe('Where can we find your product?');

    // Unreachable address: stays put with a plain explanation (Enter submits)
    const urlField = page.getByLabel('Website address');
    await urlField.fill('localhost:3499');
    await urlField.press('Enter');
    await expect.poll(() => page.getByRole('alert').innerText()).toBe('Couldn’t reach that site — check the URL and try again.');
    expect(await heading().innerText()).toBe('Where can we find your product?');
    await screenshot('url-unreachable');

    // Back to the fork and forward again keeps the AI setup (no key screen)
    await page.getByRole('button', { name: 'Back' }).click();
    await expect.poll(() => heading().innerText()).toBe('What would you like to check?');
    await page.getByRole('button', { name: /A product I work on/ }).click();

    await urlField.fill(fixtureHost);
    await urlField.press('Enter');
    await expect.poll(() => heading().innerText(), { timeout: 15000 }).toBe('Do you need to sign in to test it?');

    // Two sign-ins added, the second removed: only the first is sent
    await page.getByRole('button', { name: 'Yes, add sign-in details' }).click();
    await page.getByLabel('Type of user').fill('manager');
    await page.getByLabel('Username or email').fill('admin@example.com');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('button', { name: 'Add another sign-in' }).click();
    await page.getByLabel('Type of user').nth(1).fill('viewer');
    await page.getByLabel('Username or email').nth(1).fill('viewer@example.com');
    await screenshot('roles');
    await page.getByRole('button', { name: 'Remove sign-in 2 (viewer)' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    await expect.poll(() => heading().innerText()).toBe('Anything that explains how it should work?');
    await page.getByLabel(/text or Markdown files/).setInputFiles([
      { name: 'prd.md', mimeType: 'text/markdown', buffer: Buffer.from('# Invoices\n- Amount must be positive') },
      { name: 'flows.txt', mimeType: 'text/plain', buffer: Buffer.from('Managers create invoices for customers.') },
      { name: 'design.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
    ]);
    await expect.poll(() => page.getByRole('alert').innerText()).toContain('“design.pdf” is a PDF.');
    expect(await page.getByRole('list', { name: 'Files added' }).innerText()).toMatch(/prd\.md[\s\S]*flows\.txt/);
    await page.getByLabel('Or paste notes here').fill('Invoices can be exported.');
    await screenshot('materials');

    runRequests.length = 0;
    const stopWatching = watchText();
    await page.getByRole('button', { name: 'Start the check-up' }).click();
    await expect.poll(() => heading().innerText()).toBe('Checking your site');
    await expect.poll(() => page.locator('main').innerText(), { timeout: 30000 }).toMatch(/Exploring your site|Getting ready|Testing/);
    await screenshot('progress');
    // Every page found is visited at three widths after the journeys: allow for a busy machine.
    await expect.poll(() => heading().innerText(), { timeout: 270000, interval: 1000 }).toMatch(/issues? found|No issues found/);
    stopWatching();
    await screenshot('report-product');

    // Exactly one run request, with every answer in the shape /api/runner/run accepts
    expect(runRequests).toHaveLength(1);
    const body = runRequests[0];
    expect(body).toMatchObject({
      targetUrl: `http://${fixtureHost}/`,
      useAI: true,
      aiProvider: 'openrouter',
      aiModel: FREE_MODEL.id,
      roles: [{ role: 'manager', username: 'admin@example.com', password: 'secret', loginPath: '/login' }],
    });
    expect(body.mode).toBeUndefined();
    const productContext = body.productContext as string;
    expect(productContext).toContain('# Reference file: prd.md\n\n# Invoices\n- Amount must be positive');
    expect(productContext).toContain('# Reference file: flows.txt\n\nManagers create invoices for customers.');
    expect(productContext).toContain('# Pasted notes\n\nInvoices can be exported.');
    expect(productContext).not.toContain('%PDF');

    // The summary on screen comes from the real report
    const report: ReleaseReport = await (await fetch(`${runnerUrl}/api/report`)).json();
    const summary = summarizeReport(report);
    expect(await heading().innerText()).toBe(summary.headline);
    const mainText = await page.locator('main').innerText();
    expect(mainText).toContain(`Verdict: ${summary.stamp}.`);
    for (const c of summary.counts) expect(mainText).toContain(c.sentence);
    for (const t of summary.top) expect(mainText).toContain(t.title);
    expect(mainText).not.toContain('read-only scan');

    // No internal names or selectors were ever on screen during the run
    for (const text of seenText) expect(text).not.toMatch(JARGON);

    // Download gives both files, byte-for-byte
    const downloads: Array<{ name: string; bytes: Buffer }> = [];
    page.on('download', async (d) => {
      const file = await d.path();
      downloads.push({ name: d.suggestedFilename(), bytes: await fs.readFile(file!) });
    });
    await page.getByRole('button', { name: 'Download the full report' }).click();
    await expect.poll(() => downloads.length, { timeout: 10000 }).toBe(2);
    for (const name of ['report.md', 'findings.json']) {
      const downloaded = downloads.find((d) => d.name === name);
      expect(downloaded?.bytes.equals(await fs.readFile(path.join(outputDir, name)))).toBe(true);
    }
  }, 330000);

  it('Phase 5: website path is read-only, says so up front, and handles a busy runner', async () => {
    await page.getByRole('button', { name: 'Check something else' }).click();
    await page.getByRole('button', { name: /A public website/ }).click();
    await expect.poll(() => heading().innerText()).toBe('Which website should we look at?');
    // Safety message is on screen before anything runs
    expect(await page.locator('main').innerText()).toContain('This is a read-only check. It only looks around the site.');
    await screenshot('website-url');

    // Someone else's run is in progress: plain message, nothing breaks
    await fetch(`${runnerUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: `http://${fixtureHost}/`, mode: 'safe-public' }),
    });
    runRequests.length = 0;
    // The fixture's dead-end page has real issues, so the report has something to summarise
    await page.getByLabel('Website address').fill(`${fixtureHost}/deadend`);
    await page.getByRole('button', { name: 'Start the read-only check' }).click();
    await expect
      .poll(() => page.getByRole('alert').innerText())
      .toBe('Another check is already running. Wait for it to finish, then start this one.');
    await waitForRunnerIdle();

    const stopWatching = watchText();
    await page.getByRole('button', { name: 'Start the read-only check' }).click();
    // Straight from the address to the run: no sign-in or reference screens
    await expect.poll(() => heading().innerText()).toBe('Checking your site');
    await expect
      .poll(() => page.locator('main').innerText(), { timeout: 20000 })
      .toContain('Looking around the site safely. Nothing will be submitted or changed.');
    await expect.poll(() => heading().innerText(), { timeout: 60000 }).toMatch(/issues? found|No issues found/);
    stopWatching();
    await screenshot('report-website');

    expect(runRequests.at(-1)).toEqual({ targetUrl: `http://${fixtureHost}/deadend`, productId: 'localhost', mode: 'safe-public' });
    const mainText = await page.locator('main').innerText();
    expect(mainText).toContain('This was a read-only scan.');
    const summary = summarizeReport(await (await fetch(`${runnerUrl}/api/report`)).json());
    expect(summary.total).toBeGreaterThan(0);
    expect(await heading().innerText()).toBe(summary.headline);
    for (const t of summary.top) expect(mainText).toContain(t.title);
    for (const text of seenText) {
      expect(text).not.toMatch(JARGON);
      expect(text).not.toMatch(/signing in/i);
    }
  }, 120000);

  it('Task 3.3: a failed run explains itself and "try again" keeps every answer', async () => {
    vi.spyOn(DiscoveryAgent.prototype, 'discover').mockRejectedValueOnce(
      new Error('Pre-flight check failed: Target URL is unreachable (fetch failed).')
    );
    await page.getByRole('button', { name: 'Check something else' }).click();
    await page.getByRole('button', { name: /A product I work on/ }).click();
    await page.getByLabel('Website address').fill(fixtureHost);
    await page.getByLabel('Website address').press('Enter');
    await page.getByRole('button', { name: 'No, skip this step' }).click();
    await page.getByLabel('Or paste notes here').fill('Keep me after a failure');
    await page.getByRole('button', { name: 'Start the check-up' }).click();

    await expect.poll(() => heading().innerText(), { timeout: 20000 }).toBe('The check stopped');
    expect(await page.getByRole('alert').innerText()).toBe(
      'Your site couldn’t be reached. Make sure it’s running and the address is right, then try again.'
    );
    await screenshot('failed');

    await page.getByRole('button', { name: 'Go back and try again' }).click();
    await expect.poll(() => heading().innerText()).toBe('Anything that explains how it should work?');
    expect(await page.getByLabel('Or paste notes here').inputValue()).toBe('Keep me after a failure');
    await waitForRunnerIdle();
  }, 60000);

  it('Task 3.3: shows a reconnecting state when the live connection drops, then finishes', async () => {
    // Nothing added on the reference step and sign-in skipped: productContext is omitted, roles is []
    await page.getByLabel('Or paste notes here').fill('');
    runRequests.length = 0;
    const stopWatching = watchText();
    await page.getByRole('button', { name: 'Skip and start the check-up' }).click();
    await expect.poll(() => heading().innerText()).toBe('Checking your site');
    expect(runRequests).toHaveLength(1);
    expect(runRequests[0].roles).toEqual([]);
    expect('productContext' in runRequests[0]).toBe(false);

    // Kill the event stream from the server side while the run carries on
    await (runner as unknown as { streamClients: Set<{ destroy(): void }> }).streamClients.forEach((c) => c.destroy());
    await expect.poll(() => page.locator('main').innerText(), { timeout: 5000 }).toContain('Lost touch with the QA Tool');
    await screenshot('reconnecting');

    await expect.poll(() => heading().innerText(), { timeout: 150000, interval: 1000 }).toMatch(/issues? found|No issues found/);
    stopWatching();
  }, 200000);

  it('Task 1.5: stays usable on a phone-sized screen', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByRole('button', { name: 'Check something else' }).click();
    await page.getByRole('button', { name: /A product I work on/ }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    expect(await page.locator('main').innerText()).toContain('Where can we find your product?');
    await screenshot('mobile-url');
  }, 30000);
});
