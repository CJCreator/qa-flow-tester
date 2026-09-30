/**
 * Drives Release check-up in Chromium, served by the QA Tool itself as people run it: one server, one
 * address, one app. The site under test is the fixture app. Only the outside world is faked:
 * OpenRouter (key check and model list) and the AI model.
 *
 * The tests run in order, as one person's session: the first visit with no key, a scan, the plan,
 * a test run that fails, testing, stopping, the report, Go deeper, Past check-ups and Settings. A
 * second page at phone size visits every screen alongside.
 * Set WIZARD_SCREENSHOTS=<dir> to also save a screenshot of every screen.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request } from 'playwright';
import { build } from 'vite';
import { RunnerServer } from '@qa/runner';
import { KeyResolver, MockAIProvider, OpenRouterClient, type SecretStore } from '@qa/core';
import type { ReleaseReport, ReviewPlan, RunSummary } from '@qa/types';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { groupProblems, summarizeReport } from '../src/lib/summary';
import { runFileUrl } from '../src/api';

const FIXTURE_PORT = 3495;
const TOOL_PORT = 3496;
const fixtureHost = `localhost:${FIXTURE_PORT}`;
const fixtureUrl = `http://${fixtureHost}/`;
const toolUrl = `http://localhost:${TOOL_PORT}`;
const wizardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(process.cwd(), '.tmp-wizard-e2e');
const uiDir = `${outputDir}-ui`;
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
const SPECS = '# Invoices\n- Amount must be positive';

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

/**
 * What must never reach the plain-language layer (anything outside Details for developers): event
 * names, error codes, broken values, checker ids, selectors, and the prototype's labels.
 */
const BANNED =
  /\b(?:RUN_[A-Z]+|STEP_[A-Z]+|TEST_POINT_[A-Z]+|FINDINGS_UPDATED|DISCOVERY_[A-Z]+|PLAN_[A-Z_]+|TESTING_STARTED|ERR_[A-Z_]+)\b|undefined|\[object|\b(?:bug-detection|ux-quality|spec-conformance|design-standards|permission-matrix|ai-review)\b|data-testid|:nth-|Direction B|Blueprint|Architectural|GRID_LOCK|SCAN_LAYER|EXECUTION INSPECTOR|QA Flow Studio/;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('Release check-up end to end, on the one server', () => {
  let tool: RunnerServer;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  /** The same app at phone size, visiting each screen alongside. */
  let phone: Page;
  const runRequests: Array<Record<string, unknown>> = [];
  const seenText: string[] = [];
  let shot = 0;
  let plan: ReviewPlan;
  let report: ReleaseReport;

  const screenshot = async (name: string, on: Page = page) => {
    if (!screenshotDir) return;
    await fs.mkdir(screenshotDir, { recursive: true });
    await on.screenshot({ path: path.join(screenshotDir, `${String(++shot).padStart(2, '0')}-${name}.png`), fullPage: true });
  };
  /** The screen's main heading, as written (text-transform ignored). */
  const heading = async (on: Page = page) => ((await on.locator('h1').first().textContent()) || '').replace(/\s+/g, ' ').trim();
  const toolStatus = async () => (await fetch(`${toolUrl}/api/runner/status`)).json();
  const dialog = () => page.getByRole('dialog');

  /** The text a person can see, outside Details for developers. */
  const plainText = (on: Page = page) =>
    on.evaluate(() => {
      const parts: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || el.closest('[data-developer], script, style, noscript')) continue;
        if (!el.checkVisibility()) continue;
        parts.push(node.textContent || '');
      }
      return parts.join(' ');
    });
  /** Checks this screen's words, and remembers them for the end. */
  const checkWords = async (on: Page = page) => {
    const text = await plainText(on);
    expect(text, `${on.url()}: ${text.match(BANNED)?.[0]}`).not.toMatch(BANNED);
    seenText.push(text);
  };
  /** Records the visible words every 300 ms while a scan or test run goes, to check nothing internal leaks. */
  const watchText = () => {
    const timer = setInterval(async () => {
      try {
        seenText.push(await plainText());
      } catch {
        // page navigating
      }
    }, 300);
    return () => clearInterval(timer);
  };

  /** A screen at phone size: its main button is on screen, and nothing scrolls sideways. */
  const onPhone = async (address: string, mainButton: Locator | ((p: Page) => Locator), name: string) => {
    await phone.goto(`${toolUrl}${address}`);
    const button = typeof mainButton === 'function' ? mainButton(phone) : mainButton;
    await button.waitFor({ state: 'visible', timeout: 20000 });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${name} scrolls sideways`).toBe(false);
    await checkWords(phone);
    await screenshot(`phone-${name}`, phone);
  };

  beforeAll(async () => {
    // A busy port fails at once, rather than hanging until the hook times out.
    await new Promise<void>((resolve, reject) => fixtureServer.once('error', reject).listen(FIXTURE_PORT, () => resolve()));
    // Built and served by the QA Tool, exactly as pnpm start does.
    await build({ root: wizardRoot, configFile: path.join(wizardRoot, 'vite.config.ts'), logLevel: 'error', build: { outDir: path.join(uiDir, 'wizard'), emptyOutDir: true } });
    tool = new RunnerServer({
      port: TOOL_PORT,
      outputDir,
      dataDir: `${outputDir}-data`,
      keyResolver: new KeyResolver(outputDir, new MemoryStore()),
      openRouter: new OpenRouterClient(fakeOpenRouterFetch),
      createAIProvider: () => new MockAIProvider(),
      ui: [{ base: '/', dir: path.join(uiDir, 'wizard'), name: 'Wizard' }],
    });
    await tool.start();
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: toolUrl });
    page = await context.newPage();
    page.on('request', (req: Request) => {
      if (req.url() === `${toolUrl}/api/runner/run` && req.method() === 'POST') runRequests.push(req.postDataJSON());
    });
    phone = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  }, 180000);

  afterAll(async () => {
    await browser?.close();
    await tool?.stop();
    if (fixtureServer.listening) await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    for (const dir of [outputDir, `${outputDir}-data`, uiDir]) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('first visit: the AI key comes first on the same screen, and nothing typed is lost', async () => {
    await page.goto(`${toolUrl}/`);
    await expect.poll(() => heading(), { timeout: 10000 }).toBe('Which site do you want to check?');
    expect(await page.title()).toBe('New check-up · Release check-up');
    // Served by the QA Tool, the page never needs to explain how to start it; no Hub, no Team Hub link.
    expect(await page.getByText('Start Release check-up first').count()).toBe(0);
    expect(await page.getByRole('link', { name: 'Team Hub' }).count()).toBe(0);
    await expect.poll(() => page.getByRole('heading', { name: 'First, connect an AI helper' }).isVisible()).toBe(true);
    const scan = page.getByRole('button', { name: 'Scan the site' });

    // The address and the specs first: the address is checked as it's typed.
    await page.locator('#url-input').fill(fixtureHost);
    await expect.poll(() => page.locator('#url-status').innerText(), { timeout: 15000 }).toBe(`Will check ${fixtureUrl}`);
    // A site not checked before: the owner box starts unticked, and it's look-only until it's ticked.
    const owner = page.getByRole('checkbox', { name: /I own this site/ });
    expect(await owner.isChecked()).toBe(false);
    expect(await page.getByText('Look-only:').isVisible()).toBe(true);
    await owner.check();
    expect(await page.getByText('Test copy:').isVisible()).toBe(true);
    // localhost is a test copy by itself: there's nothing to mark.
    expect(await page.getByRole('checkbox', { name: /This is a test copy/ }).count()).toBe(0);
    await page.getByText('Add specs, design notes or journeys').click();
    await page.getByLabel('Specs', { exact: true }).fill(SPECS);
    expect(await scan.isDisabled()).toBe(true);
    await checkWords();
    await screenshot('first-visit');

    // Then the key, checked as it's pasted.
    const keyInput = page.getByLabel('OpenRouter key');
    await keyInput.fill('sk-or-v1-revoked');
    await expect.poll(() => page.locator('#ai-key-status').innerText()).toContain('The key doesn’t work');
    openRouterModels.list = [];
    await keyInput.fill(GOOD_KEY);
    await expect.poll(() => page.getByRole('alert').first().innerText(), { timeout: 10000 }).toBe('No free AI models are available right now. Please try again later.');
    openRouterModels.list = [FREE_MODEL];
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => page.getByRole('heading', { name: 'First, connect an AI helper' }).count(), { timeout: 10000 }).toBe(0);
    // The QA Tool, not this browser, keeps the key and the model it chose.
    expect(await (await fetch(`${toolUrl}/api/ai/openrouter/key`)).json()).toMatchObject({ configured: true, model: FREE_MODEL.id });

    // Nothing typed was lost on the way.
    expect(await page.locator('#url-input').inputValue()).toBe(fixtureHost);
    expect(await page.getByLabel('Specs', { exact: true }).inputValue()).toBe(SPECS);
    expect(await owner.isChecked()).toBe(true);
    expect(await scan.isEnabled()).toBe(true);
  }, 60000);

  it('scans, then the plan waits for review, with the specs in it', async () => {
    runRequests.length = 0;
    const stopWatching = watchText();
    await page.getByRole('button', { name: 'Scan the site' }).click();
    await page.waitForURL(`${toolUrl}/check/scan`);
    expect(await heading()).toBe(`Scanning ${fixtureHost}`);
    expect(await page.getByRole('navigation', { name: 'Check-up steps' }).getByRole('link', { name: /Address/ }).count()).toBe(1);
    await expect.poll(() => page.getByText('Pages found').isVisible()).toBe(true);
    await screenshot('scanning');

    await page.waitForURL(`${toolUrl}/check/plan`, { timeout: 120000 });
    stopWatching();
    await expect.poll(() => heading()).toBe(`Review the plan for ${fixtureHost}`);
    expect(runRequests).toHaveLength(1);
    expect(runRequests[0]).toMatchObject({ targetUrl: fixtureUrl, owner: true, useAI: true, aiProvider: 'openrouter', skipReview: false });
    expect(runRequests[0].productContext).toContain(`# Specs\n\n${SPECS}`);
    // localhost is a test copy by itself, so nothing is marked.
    expect(runRequests[0]).not.toHaveProperty('stagingHost');
    await expect.poll(() => page.locator('#plan-product-context').inputValue()).toContain('- Amount must be positive');
    plan = await (await fetch(`${toolUrl}/api/runner/plan`)).json();
    expect(plan.planPages!.length).toBeGreaterThan(5);

    // Desktop only keeps the run short.
    await page.getByRole('checkbox', { name: 'Phone (375px)' }).uncheck();
    await expect.poll(() => page.getByRole('checkbox', { name: 'Phone (375px)' }).isChecked()).toBe(false);
    await page.getByRole('checkbox', { name: 'Tablet (768px)' }).uncheck();
    await expect.poll(async () => (await page.locator('#plan-summary').innerText()).includes('at 1 screen size (1440px)')).toBe(true);
    await checkWords();
    await screenshot('plan');
    await onPhone('/check/plan', (p) => p.getByRole('button', { name: 'Approve and start testing' }), 'plan');
  }, 180000);

  it('the plan keeps waiting: the Resume card leads back, starting another asks first, and nothing in the bars stops it', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'New check-up' }).click();
    await page.waitForURL(`${toolUrl}/`);
    const resume = page.getByRole('region', { name: 'Check-up in progress' });
    await expect.poll(() => resume.innerText()).toContain(`Your check-up of ${fixtureHost} is waiting for your review.`);
    await checkWords();
    await screenshot('resume-card');

    // Starting over the waiting plan asks first; keeping it changes nothing.
    await page.getByRole('button', { name: 'Scan the site' }).click();
    await expect.poll(() => dialog().isVisible()).toBe(true);
    expect(await dialog().innerText()).toContain(`The plan for ${fixtureHost} that’s waiting for your review will be thrown away.`);
    await dialog().getByRole('button', { name: 'Keep the plan' }).click();
    await expect.poll(() => dialog().count()).toBe(0);
    expect(page.url()).toBe(`${toolUrl}/`);
    expect((await toolStatus()).phase).toBe('awaiting-review');

    await resume.getByRole('link', { name: /Open the plan/ }).click();
    await page.waitForURL(`${toolUrl}/check/plan`);
    await expect.poll(() => heading()).toBe(`Review the plan for ${fixtureHost}`);
    await page.reload();
    await expect.poll(() => heading(), { timeout: 15000 }).toBe(`Review the plan for ${fixtureHost}`);

    // The step bar's finished step is a link that stops nothing.
    await page.getByRole('navigation', { name: 'Check-up steps' }).getByRole('link', { name: /Address/ }).click();
    await page.waitForURL(`${toolUrl}/`);
    expect((await toolStatus()).phase).toBe('awaiting-review');
    await page.goBack();
    await expect.poll(() => heading()).toBe(`Review the plan for ${fixtureHost}`);
    await page.goForward();
    await expect.poll(() => heading()).toBe('Which site do you want to check?');
    await page.goBack();
    await expect.poll(() => heading()).toBe(`Review the plan for ${fixtureHost}`);
    expect((await toolStatus()).phase).toBe('awaiting-review');
  }, 60000);

  it('a test run that fails says why, and keeps the plan to approve again', async () => {
    // The site goes down just as testing starts.
    fixtureServer.closeAllConnections();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    try {
      await page.getByRole('button', { name: 'Approve and start testing' }).click();
      const failure = page.getByRole('alert').filter({ hasText: 'Testing stopped before it finished' });
      await expect.poll(() => failure.count(), { timeout: 60000 }).toBe(1);
      expect(await failure.innerText()).toContain('couldn’t be reached');
      expect(await failure.innerText()).toContain('Your plan is kept');
      expect(page.url()).toBe(`${toolUrl}/check/plan`);
      expect((await toolStatus()).phase).toBe('awaiting-review');
      await checkWords();
      await screenshot('testing-failed');
    } finally {
      await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    }
  }, 90000);

  it('testing shows the real progress, and stopping keeps the plan', async () => {
    const stopWatching = watchText();
    await page.getByRole('button', { name: 'Approve and start testing' }).click();
    await page.waitForURL(`${toolUrl}/check/testing`);
    expect(await heading()).toBe(`Testing ${fixtureHost}`);
    const progress = page.getByRole('status').filter({ hasText: /^Test \d+ of \d+/ });
    await expect.poll(() => progress.first().innerText(), { timeout: 60000, interval: 100 }).toMatch(/^Test 1 of \d+/);
    // The latest screen, from the test's own steps.
    const latest = page.getByRole('img', { name: /after the latest step/ });
    await expect.poll(() => latest.count(), { timeout: 60000 }).toBe(1);
    await expect.poll(() => latest.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 10000 }).toBe(true);
    // A problem pinned to the page it was found on.
    const found = page.getByRole('region', { name: 'Found so far' }).getByRole('listitem');
    const pagePaths = plan.pages.map((p) => p.urlPath);
    await expect.poll(() => found.count(), { timeout: 180000 }).toBeGreaterThan(0);
    const pinnedTo = (await found.first().locator('.font-mono').innerText()).trim();
    expect(pagePaths).toContain(pinnedTo);
    await screenshot('testing');

    // A refresh lands back on the testing, caught up.
    await page.reload();
    await expect.poll(() => heading(), { timeout: 15000 }).toBe(`Testing ${fixtureHost}`);
    await expect.poll(() => progress.first().innerText(), { timeout: 15000 }).toMatch(/^Test \d+ of \d+/);
    await onPhone('/check/testing', (p) => p.getByRole('button', { name: 'Stop testing' }), 'testing');
    // No map on a phone.
    expect(await phone.getByRole('group', { name: 'How to show the map' }).isVisible()).toBe(false);

    // Stopping asks first, then the plan waits again.
    await page.getByRole('button', { name: 'Stop testing' }).click();
    expect(await dialog().innerText()).toContain('Your plan is kept, so you can change it and approve it again.');
    await dialog().getByRole('button', { name: 'Stop testing' }).click();
    await page.waitForURL(`${toolUrl}/check/plan`, { timeout: 20000 });
    await expect.poll(() => page.getByText('Testing was stopped').isVisible()).toBe(true);
    stopWatching();
    expect((await toolStatus()).phase).toBe('awaiting-review');
  }, 300000);

  it('approved again, it tests to the end, and the report opens at its own address with one verdict', async () => {
    const stopWatching = watchText();
    await page.getByRole('button', { name: 'Approve and start testing' }).click();
    await page.waitForURL(`${toolUrl}/check/testing`);
    await page.waitForURL(/\/reports\/run-\d+$/, { timeout: 400000 });
    stopWatching();
    const runId = page.url().split('/').pop()!;
    report = await (await fetch(`${toolUrl}/api/runs/${runId}`)).json();
    expect(report.runId).toBe(runId);
    const summary = summarizeReport(report);

    // The stamp is the verdict, with its reason; there's no overall grade to contradict it.
    await expect.poll(() => heading(), { timeout: 15000 }).toBe(summary.stamp);
    expect(await page.getByText(summary.reason).first().isVisible()).toBe(true);
    const text = await plainText();
    expect(text).not.toMatch(/\/100|Readiness Grade|[Oo]verall/);
    expect(await page.getByRole('heading', { name: 'How each area did' }).isVisible()).toBe(true);
    for (const [aspect, data] of Object.entries(report.grades!.aspects)) {
      const card = page.getByRole('heading', { name: 'How each area did' }).locator('xpath=..').getByRole('listitem').filter({ hasText: aspect });
      expect(await card.innerText(), aspect).toContain(data.checked === false ? 'Not checked' : data.grade);
    }
    expect(await page.title()).toBe(`Report for ${fixtureHost} · Release check-up`);
    await checkWords();
    await screenshot('report');

    // What ran is exactly what was approved.
    expect(new Set(report.results.map((r) => r.testCaseId)).size).toBeGreaterThan(0);
    for (const t of seenText) expect(t).not.toMatch(BANNED);
  }, 480000);

  it('the report: problems open from the keyboard, Details for developers hold the evidence and the copies, and axe finds nothing', async () => {
    // Keyboard alone: Tab until a problem is reached, then Enter opens it.
    const problems = page.getByRole('region', { name: 'Problems found' });
    let reached = false;
    for (let i = 0; i < 400 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => {
        const el = document.activeElement;
        return !!el && el.hasAttribute('aria-expanded') && !!el.closest('section[aria-labelledby="problems-heading"]');
      });
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))).toBe('true');

    // A problem with a screenshot: its details show it, and copy a bug report and a Playwright test.
    // (Each problem shows the details of its first five places.)
    const shown = Object.values(groupProblems(report.findings)).flat().flatMap((group) => group.findings.slice(0, 5).map((finding) => ({ group, finding })));
    const pick = shown.find(({ finding }) => finding.evidence.screenshotPath && !/^([a-z]:)?[\\/]/i.test(finding.evidence.screenshotPath));
    expect(pick, 'a problem with a screenshot').toBeTruthy();
    const { group, finding: withShot } = pick!;
    const named = new RegExp(`^${escapeRegExp(group.title)}`);
    const item = problems.getByRole('listitem').filter({ has: page.getByRole('button', { name: named }) }).first();
    const toggle = item.getByRole('button', { name: named });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const src = runFileUrl(report.runId, withShot.evidence.screenshotPath!);
    const details = item.locator('details[data-developer]').filter({ has: page.locator(`img[src="${src}"]`) }).first();
    await details.locator('summary').click();
    const image = details.locator(`img[src="${src}"]`);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 10000 }).toBe(true);
    expect(await details.innerText()).toContain(withShot.verifyCommand);
    await screenshot('details-for-developers');

    await details.getByRole('button', { name: 'Copy bug report' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`### ${group.title}`);
    // The repro script the core wrote for the finding, or else one built from its steps.
    const script = withShot.reproScriptPath
      ? await (await fetch(`${toolUrl}${runFileUrl(report.runId, withShot.reproScriptPath)}`)).text()
      : '@playwright/test';
    expect(script).toContain('playwright');
    await details.getByRole('button', { name: 'Copy Playwright test' }).click();
    // The system clipboard may change line endings.
    const lf = (text: string) => text.replace(/\r\n/g, '\n');
    await expect.poll(async () => lf(await page.evaluate(() => navigator.clipboard.readText()))).toContain(lf(script).trim().slice(0, 200));

    // An accessibility scan of the report, with a problem and its details open.
    const require = createRequire(path.join(wizardRoot, '..', 'checkers', 'package.json'));
    const axePath = createRequire(require.resolve('@axe-core/playwright')).resolve('axe-core');
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
    });
    expect(violations).toEqual([]);
  }, 90000);

  it('the report filters by page and by area, and the map filters by page', async () => {
    const counted = report.findings.filter((f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive');
    const problems = page.getByRole('region', { name: 'Problems found' });
    // A page with problems that the map draws as a card (the map draws the first dozen or so).
    const drawn = (report.siteMap?.pages || []).slice(0, 12).map((p) => p.urlPath);
    const pageWithProblems = counted.map((f) => f.where.urlPath).find((p) => drawn.includes(p)) ?? counted[0].where.urlPath;
    expect(drawn).toContain(pageWithProblems);

    if (counted.length > 10) {
      const filters = page.getByRole('search', { name: 'Filter the problems' });
      await filters.getByLabel('Page').selectOption(pageWithProblems);
      const shown = filters.getByRole('status');
      await expect.poll(() => shown.innerText()).toMatch(new RegExp(`^Showing \\d+ of ${counted.length} problems`));
      const onPage = counted.filter((f) => f.where.urlPath === pageWithProblems || f.seenAt?.pages.includes(pageWithProblems)).length;
      expect(await shown.innerText()).toContain(`Showing ${onPage} of`);
      await filters.getByRole('button', { name: 'Clear the filters' }).click();
      await filters.getByLabel('Area').selectOption('Accessible');
      const accessible = report.grades!.aspects.Accessible.findings.filter((id) => counted.some((f) => f.id === id)).length;
      await expect.poll(() => shown.innerText()).toContain(`Showing ${accessible} of`);
      await filters.getByRole('button', { name: 'Clear the filters' }).click();
    }

    // Choosing a page on the map shows only its problems.
    const map = page.getByRole('heading', { name: 'Map of results' }).locator('xpath=..');
    await map.getByRole('button', { name: 'List' }).click();
    await map
      .getByRole('listitem')
      .filter({ has: page.locator('span.font-mono', { hasText: new RegExp(`^${escapeRegExp(pageWithProblems)}$`) }) })
      .getByRole('button')
      .first()
      .click();
    if (counted.length > 10) {
      await expect.poll(() => page.getByRole('search', { name: 'Filter the problems' }).getByLabel('Page').inputValue()).toBe(pageWithProblems);
    } else {
      await expect.poll(() => problems.innerText()).toContain('Showing the problems on');
      await problems.getByRole('button', { name: 'Show every page' }).click();
    }
    await screenshot('report-filtered');
  }, 60000);

  it('the report downloads as one HTML file, byte for byte', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download the report' }).click()]);
    const bytes = await fs.readFile((await download.path())!);
    expect(bytes.equals(await fs.readFile(path.join(outputDir, 'runs', report.runId, 'report.html')))).toBe(true);
    expect(download.suggestedFilename()).toBe(`report-${fixtureHost.replace(':', '_')}-${report.runId}.html`);
    await onPhone(`/reports/${report.runId}`, (p) => p.getByRole('button', { name: 'Download the report' }), 'report');
  }, 60000);

  it('Go deeper starts a new scan of its own; stopping it goes back to the address with everything still filled in', async () => {
    runRequests.length = 0;
    await page.getByRole('button', { name: 'Go deeper: test the signed-in pages' }).click();
    await page.getByLabel('Email or username').fill('manager@example.com');
    await page.getByLabel('Password').fill('manager-password');
    await page.getByRole('button', { name: 'Sign in and scan again' }).click();
    await page.waitForURL(`${toolUrl}/check/scan`);
    expect(await heading()).toBe(`Scanning ${fixtureHost}`);
    // The new scan's own progress, not the last run's.
    await expect.poll(() => page.getByRole('region', { name: 'Scan progress' }).innerText(), { timeout: 30000 }).toMatch(/Exploring the site|Looking at the menus|writing the plan/);
    expect(runRequests).toHaveLength(1);
    expect(runRequests[0]).toMatchObject({ targetUrl: fixtureUrl, owner: true, roles: [{ role: 'member', username: 'manager@example.com', password: 'manager-password' }] });
    // The first check-up's specs and page limit come along.
    expect(runRequests[0].productContext).toContain(SPECS);
    await checkWords();
    await onPhone('/check/scan', (p) => p.getByRole('button', { name: 'Stop scanning' }), 'scanning');

    await page.getByRole('button', { name: 'Stop scanning' }).click();
    expect(await dialog().innerText()).toContain('The pages found so far are thrown away.');
    await dialog().getByRole('button', { name: 'Stop scanning' }).click();
    await page.waitForURL(`${toolUrl}/`);
    expect(await page.locator('#url-input').inputValue()).toBe(fixtureHost);
    expect(await page.getByLabel('Specs', { exact: true }).inputValue()).toBe(SPECS);
    await expect.poll(async () => (await toolStatus()).phase).toBe('idle');
    // Nothing in progress: no Resume card.
    expect(await page.getByRole('region', { name: 'Check-up in progress' }).count()).toBe(0);
    await onPhone('/', (p) => p.getByRole('button', { name: 'Scan the site' }), 'new-check-up');
  }, 90000);

  it('the owner choice is remembered for the site; a site not checked before starts unticked', async () => {
    const other = await browser.newContext();
    const fresh = await other.newPage();
    try {
      await fresh.goto(`${toolUrl}/`);
      await expect.poll(() => heading(fresh), { timeout: 10000 }).toBe('Which site do you want to check?');
      await fresh.locator('#url-input').fill(fixtureHost);
      await expect.poll(() => fresh.locator('#url-status').innerText(), { timeout: 15000 }).toContain('Will check');
      expect(await fresh.getByRole('checkbox', { name: /I own this site/ }).isChecked()).toBe(true);

      await fresh.locator('#url-input').fill(`127.0.0.1:${FIXTURE_PORT}`);
      await expect.poll(() => fresh.locator('#url-status').innerText(), { timeout: 15000 }).toBe(`Will check http://127.0.0.1:${FIXTURE_PORT}/`);
      expect(await fresh.getByRole('checkbox', { name: /I own this site/ }).isChecked()).toBe(false);
    } finally {
      await other.close();
    }
  }, 60000);

  it('Settings: the key in use, and replacing it', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
    await page.waitForURL(`${toolUrl}/settings`);
    await expect.poll(() => heading()).toBe('Settings');
    await expect.poll(() => page.getByText('Saved on this computer').isVisible()).toBe(true);
    expect(await page.getByText(FREE_MODEL.id).isVisible()).toBe(true);
    await checkWords();
    await page.getByRole('button', { name: 'Replace the key' }).click();
    // There's a key, so it can be kept.
    expect(await page.getByRole('button', { name: 'Keep my current key' }).isVisible()).toBe(true);
    await page.getByLabel('OpenRouter key').fill(GOOD_KEY);
    await expect.poll(() => page.locator('#ai-key-status').innerText()).toContain('The key works');
    await page.getByRole('button', { name: 'Save the key' }).click();
    await expect.poll(() => page.getByText('Your new key is saved.').isVisible(), { timeout: 10000 }).toBe(true);
    await screenshot('settings');
    await onPhone('/settings', (p) => p.getByRole('button', { name: 'Replace the key' }), 'settings');
  }, 60000);

  it('every screen has an address that survives refresh, Back and Forward; unknown ones say so', async () => {
    const screens: Array<[string, string]> = [
      ['/', 'Which site do you want to check?'],
      ['/reports', 'Past check-ups'],
      [`/reports/${report.runId}`, summarizeReport(report).stamp],
      ['/settings', 'Settings'],
      ['/no/such/page', 'Page not found'],
    ];
    for (const [address, title] of screens) {
      await page.goto(`${toolUrl}${address}`);
      await expect.poll(() => heading(), { timeout: 15000 }).toBe(title);
      await page.reload();
      await expect.poll(() => heading(), { timeout: 15000 }).toBe(title);
      await checkWords();
    }
    await onPhone('/no/such/page', (p) => p.getByRole('link', { name: 'Start a new check-up' }), 'not-found');

    // Moving through the top bar, then Back and Forward.
    await page.goto(`${toolUrl}/`);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Past check-ups' }).click();
    await expect.poll(() => heading()).toBe('Past check-ups');
    await page.getByRole('link', { name: /^Open the check-up of/ }).first().click();
    await expect.poll(() => heading()).toBe(summarizeReport(report).stamp);
    await page.goBack();
    await expect.poll(() => heading()).toBe('Past check-ups');
    await page.goBack();
    await expect.poll(() => heading()).toBe('Which site do you want to check?');
    await page.goForward();
    await expect.poll(() => heading()).toBe('Past check-ups');
    await page.goForward();
    await expect.poll(() => heading()).toBe(summarizeReport(report).stamp);
  }, 90000);

  it('Past check-ups: an older report opens, survives a reload, and deletes after asking', async () => {
    // A newer check-up of the site, so the one from this session is the older one.
    const started = await fetch(`${toolUrl}/api/runner/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetUrl: fixtureUrl, mode: 'safe-public' }) });
    expect(started.status).toBe(202);
    const newer = (await started.json()).runId;
    const listed = async (): Promise<RunSummary[]> => (await (await fetch(`${toolUrl}/api/runs`)).json()).runs;
    await expect.poll(async () => (await listed())[0]?.runId, { timeout: 120000, interval: 1000 }).toBe(newer);
    const runs = await listed();
    expect(runs.map((r) => r.runId)).toContain(report.runId);
    expect(runs[0].runId).not.toBe(report.runId);

    await page.goto(`${toolUrl}/reports`);
    await expect.poll(() => heading()).toBe('Past check-ups');
    await onPhone('/reports', (p) => p.getByRole('link', { name: /^Open the check-up of/ }).first(), 'past-check-ups');
    const older = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: /^Open the check-up of/ }) }).nth(1);
    await older.getByRole('link', { name: /^Open the check-up of/ }).click();
    await page.waitForURL(`${toolUrl}/reports/${report.runId}`);
    await page.reload();
    await expect.poll(() => heading(), { timeout: 15000 }).toBe(summarizeReport(report).stamp);

    await page.goBack();
    await expect.poll(() => heading()).toBe('Past check-ups');
    await page.getByRole('listitem').filter({ has: page.getByRole('link', { name: /^Open the check-up of/ }) }).nth(1).getByRole('button', { name: /^Delete the check-up of/ }).click();
    expect(await dialog().innerText()).toContain('The site’s grade history is kept.');
    await dialog().getByRole('button', { name: 'Delete it' }).click();
    await expect.poll(() => page.getByRole('link', { name: /^Open the check-up of/ }).count()).toBe(runs.length - 1);
    expect((await fetch(`${toolUrl}/api/runs/${report.runId}`)).status).toBe(404);
    await checkWords();
  }, 180000);

  it('QA Flow Studio’s old address leads to Past check-ups', async () => {
    await page.goto(`${toolUrl}/studio/`);
    await page.waitForURL(`${toolUrl}/reports`);
    await expect.poll(() => heading()).toBe('Past check-ups');
  }, 30000);
});
