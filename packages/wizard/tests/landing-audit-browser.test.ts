/**
 * The landing page in Chromium: the light/dark toggle, an axe pass in both themes and at phone width,
 * and no third-party requests. Slow: builds the wizard and serves it from the QA Tool, like
 * wizard-e2e.test.ts. axe-core is taken from the checkers package, so nothing new is installed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { build } from 'vite';
import { RunnerServer } from '@qa/runner';
import { KeyResolver, type SecretStore } from '@qa/core';

const TOOL_PORT = 3487;
const toolUrl = `http://localhost:${TOOL_PORT}`;
const wizardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(wizardRoot, '..', '..');
const outputDir = path.join(process.cwd(), '.tmp-landing-audit');
const uiDir = `${outputDir}-ui`;
const axePath = createRequire(path.join(repoRoot, 'packages/checkers/package.json')).resolve('axe-core');

class MemoryStore implements SecretStore {
  secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
}

interface Violation {
  id: string;
  impact?: string | null;
  nodes: Array<{ target: unknown[] }>;
}

describe('landing page in a browser', () => {
  let tool: RunnerServer;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const requested: string[] = [];

  const theme = (on: Page = page) => on.evaluate(() => document.documentElement.getAttribute('data-theme'));

  async function openLanding(on: Page = page): Promise<void> {
    await on.goto(`${toolUrl}/`);
    await on.getByRole('heading', { level: 1, name: 'QA without a QA team.' }).waitFor({ timeout: 15000 });
  }

  /** Serious and critical axe findings, as readable lines. The sample report is its own page, so its frame is left out. */
  async function seriousViolations(on: Page = page): Promise<string[]> {
    await on.addScriptTag({ path: axePath });
    const found = await on.evaluate(async () => {
      const axe = (
        window as unknown as { axe: { run: (ctx: unknown, opts?: unknown) => Promise<{ violations: Violation[] }> } }
      ).axe;
      return (await axe.run({ include: [['body']], exclude: [['iframe']] })).violations;
    });
    return found
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  }

  beforeAll(async () => {
    await build({
      root: wizardRoot,
      configFile: path.join(wizardRoot, 'vite.config.ts'),
      logLevel: 'error',
      build: { outDir: path.join(uiDir, 'wizard'), emptyOutDir: true },
    });
    tool = new RunnerServer({
      port: TOOL_PORT,
      outputDir,
      dataDir: `${outputDir}-data`,
      keyResolver: new KeyResolver(outputDir, new MemoryStore()),
      ui: [{ base: '/', dir: path.join(uiDir, 'wizard'), name: 'Wizard' }],
    });
    await tool.start();
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    context.on('request', (req) => requested.push(req.url()));
    page = await context.newPage();
  }, 180000);

  afterAll(async () => {
    await browser?.close();
    await tool?.stop();
    for (const dir of [outputDir, `${outputDir}-data`, uiDir])
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('Light theme button sets data-theme=light on <html>, survives reload, switching back removes it', async () => {
    await openLanding();
    expect(await theme()).toBeNull();
    const toggle = page.getByRole('button', { name: 'Light theme' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    await toggle.click();
    expect(await theme()).toBe('light');
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');

    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'QA without a QA team.' }).waitFor();
    expect(await theme()).toBe('light');

    await page.getByRole('button', { name: 'Light theme' }).click();
    expect(await theme()).toBeNull();
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'QA without a QA team.' }).waitFor();
    expect(await theme()).toBeNull();
  }, 60000);

  it('app screens (/check) stay dark', async () => {
    await openLanding();
    await page.getByRole('button', { name: 'Light theme' }).click();
    expect(await theme()).toBe('light');
    await page.goto(`${toolUrl}/check`);
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
    expect(await theme()).toBeNull();
    // Back on the landing page the choice is still remembered; put it back for the next test.
    await openLanding();
    expect(await theme()).toBe('light');
    await page.getByRole('button', { name: 'Light theme' }).click();
    expect(await theme()).toBeNull();
  }, 60000);

  it('landing has no serious or critical axe violations (dark)', async () => {
    await openLanding();
    expect(await theme()).toBeNull();
    expect(await seriousViolations()).toEqual([]);
  }, 60000);

  it('landing has no serious or critical axe violations (light)', async () => {
    await openLanding();
    await page.getByRole('button', { name: 'Light theme' }).click();
    expect(await theme()).toBe('light');
    expect(await seriousViolations()).toEqual([]);
    await page.getByRole('button', { name: 'Light theme' }).click();
  }, 60000);

  it('landing has no serious or critical axe violations at 375 px, with no sideways scroll', async () => {
    const phone = await context.newPage();
    try {
      await phone.setViewportSize({ width: 375, height: 800 });
      await openLanding(phone);
      expect(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      expect(await seriousViolations(phone)).toEqual([]);
    } finally {
      await phone.close();
    }
  }, 60000);

  it('the landing page asks nobody but the tool itself', () => {
    const others = requested.filter((u) => {
      const { protocol, origin } = new URL(u);
      return (protocol === 'http:' || protocol === 'https:') && origin !== toolUrl;
    });
    expect(others).toEqual([]);
  });
});
