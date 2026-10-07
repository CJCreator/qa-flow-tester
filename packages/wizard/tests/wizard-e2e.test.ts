/**
 * Drives Release check-up in Chromium, served by the QA Tool itself as people run it: one server,
 * one address, one app. The site under test is the fixture app. Only the outside world is faked:
 * OpenRouter (key check + model list) and the AI model.
 *
 * The tests run in order and follow one site through: the first visit, a scan, the plan, a failed
 * and a stopped test run, the report, Test again, Past check-ups, Go deeper and Settings. Every
 * screen is read for words that must not reach people, and opened at phone size while it exists.
 * Set WIZARD_SCREENSHOTS=<dir> to also save a screenshot of every screen.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { build } from 'vite';
import { RunnerServer } from '@qa/runner';
import { KeyResolver, MockAIProvider, OpenRouterClient, type SecretStore } from '@qa/core';
import type { ReleaseReport, ReviewPlan, RunSummary } from '@qa/types';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { groupProblems, pageResults, summarizeReport } from '../src/lib/summary';

const FIXTURE_PORT = 3485;
const TOOL_PORT = 3486;
const fixtureHost = `localhost:${FIXTURE_PORT}`;
const fixtureUrl = `http://${fixtureHost}/`;
const toolUrl = `http://localhost:${TOOL_PORT}`;
const wizardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(wizardRoot, '..', '..');
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
 * names, error codes, broken values, selectors, checker ids and the prototype's labels.
 */
const BANNED: RegExp[] = [
  /RUN_STARTED|RUN_COMPLETED|RUN_FAILED|RUN_ABORTED|STEP_STARTED|STEP_COMPLETED|TEST_POINT|FINDINGS_UPDATED|DISCOVERY_|PLAN_READY|PLAN_UPDATE|TESTING_STARTED/,
  /ERR_[A-Z]/,
  /undefined|\[object/,
  /data-testid|\[data-|nth-child|xpath=/i,
  /bug-detection|ux-quality|spec-conformance|design-standards|permission-matrix|ai-review/,
  /Direction B|Blueprint|Architectural|GRID_LOCK|SCAN_LAYER|EXECUTION INSPECTOR/i,
];

/** The visible text of a screen, leaving out every Details for developers. */
function plainText(on: Page): Promise<string> {
  return on.evaluate(() => {
    const developerOnly = [...document.querySelectorAll('details')].filter(
      (d) => d.querySelector('summary')?.textContent?.trim() === 'Details for developers'
    );
    const display = developerOnly.map((d) => d.style.display);
    developerOnly.forEach((d) => (d.style.display = 'none'));
    const text = document.body.innerText;
    developerOnly.forEach((d, i) => (d.style.display = display[i]));
    return text;
  });
}

function expectPlain(text: string, where: string): void {
  for (const banned of BANNED) expect(text, `${where} shows ${banned}`).not.toMatch(banned);
}

/** The screen's main heading, tidied (textContent: the stamp's capitals are only CSS). */
async function heading(on: Page): Promise<string> {
  return ((await on.locator('h1').first().textContent()) || '').replace(/\s+/g, ' ').trim();
}

const api = async <T>(route: string): Promise<T> => (await fetch(`${toolUrl}${route}`)).json() as Promise<T>;
const runnerPhase = async () => (await api<{ phase: string }>('/api/runner/status')).phase;

const fixtureUp = () => new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
const fixtureDown = () =>
  new Promise<void>((resolve) => {
    fixtureServer.close(() => resolve());
    fixtureServer.closeAllConnections();
  });

describe('Release check-up end to end, on the one server', () => {
  let tool: RunnerServer;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const runRequests: Array<Record<string, unknown>> = [];
  let shot = 0;
  let firstRunId = '';
  let secondRunId = '';

  const screenshot = async (name: string, on: Page = page) => {
    if (!screenshotDir) return;
    await fs.mkdir(screenshotDir, { recursive: true });
    await on.screenshot({
      path: path.join(screenshotDir, `${String(++shot).padStart(2, '0')}-${name}.png`),
      fullPage: true,
    });
  };

  /**
   * Opens a screen at 375 px while it exists: nothing scrolls sideways, its main control can be
   * reached, and nothing technical shows.
   */
  const checkPhone = async (
    address: string,
    name: string,
    main: { role: 'button' | 'link'; name: string | RegExp }
  ) => {
    const phone = await context.newPage();
    try {
      await phone.setViewportSize({ width: 375, height: 800 });
      await phone.goto(`${toolUrl}${address}`);
      const control = phone.getByRole(main.role, { name: main.name }).first();
      await control.waitFor({ state: 'visible', timeout: 20000 });
      await control.scrollIntoViewIfNeeded();
      expect(await control.isVisible(), `${address}: main control`).toBe(true);
      expect(
        await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        `${address} scrolls sideways`
      ).toBe(false);
      expectPlain(await plainText(phone), `${address} on a phone`);
      await screenshot(`phone-${name}`, phone);
    } finally {
      await phone.close();
    }
  };

  /** Everything seen while a check-up runs: its text, and what the testing screen showed. */
  const watch = () => {
    const seen = { texts: [] as string[], testCount: false, screenshot: false, found: false, pinned: false };
    const timer = setInterval(async () => {
      try {
        seen.texts.push(await plainText(page));
        const now = await page.evaluate(() => ({
          testCount: /Test \d+ of \d+/.test(document.body.innerText),
          screenshot: [...document.querySelectorAll<HTMLImageElement>('img[alt^="The latest screen"]')].some(
            (img) => img.complete && img.naturalWidth > 0
          ),
          found: document.querySelectorAll('section[aria-labelledby="found-title"] li').length > 0,
          pinned: document.querySelectorAll('button[aria-label*=" problem"]').length > 0,
        }));
        seen.testCount ||= now.testCount;
        seen.screenshot ||= now.screenshot;
        seen.found ||= now.found;
        seen.pinned ||= now.pinned;
      } catch {
        // the page is changing screens
      }
    }, 300);
    return { seen, stop: () => clearInterval(timer) };
  };

  beforeAll(async () => {
    await fixtureUp();
    // The Wizard is built and served by the QA Tool, exactly as pnpm start does. It's the only app.
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
      openRouter: new OpenRouterClient(fakeOpenRouterFetch),
      createAIProvider: () => new MockAIProvider(),
      ui: [{ base: '/', dir: path.join(uiDir, 'wizard'), name: 'Wizard' }],
    });
    await tool.start();
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: toolUrl });
    context.on('request', (req) => {
      if (req.url() === `${toolUrl}/api/runner/run` && req.method() === 'POST') runRequests.push(req.postDataJSON());
    });
    page = await context.newPage();
  }, 180000);

  afterAll(async () => {
    await browser?.close();
    await tool?.stop();
    if (fixtureServer.listening) await fixtureDown();
    for (const dir of [outputDir, `${outputDir}-data`, uiDir])
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('opens on the landing page, which leads to a new check-up, with the top bar, and every address answers', async () => {
    await page.goto(`${toolUrl}/`);
    await expect.poll(() => heading(page), { timeout: 10000 }).toBe('QA without a QA team.');
    await expect
      .poll(() => page.title())
      .toBe('Release check-up | QA without a QA team: know if your site is ready to ship');
    // The landing page is public and has no app navigation, but offers the way in, a real sample report and the source.
    expect(await page.getByRole('link', { name: 'Past check-ups' }).count()).toBe(0);
    expect(await page.getByRole('link', { name: 'Source on GitHub' }).count()).toBe(1);
    expect(await page.getByRole('link', { name: 'See a sample report' }).getAttribute('href')).toBe(
      '/sample-report.html'
    );
    expectPlain(await plainText(page), 'the landing page');
    await screenshot('landing');
    await checkPhone('/', 'landing', { role: 'link', name: 'Run a free check-up' });
    await page.getByRole('link', { name: 'Run a free check-up' }).first().click();
    await page.waitForURL(`${toolUrl}/check`);
    await expect.poll(() => heading(page), { timeout: 10000 }).toBe('Enter the address of the site to check');
    await expect.poll(() => page.title()).toBe('New check-up · Release check-up');
    const topBar = page.getByRole('navigation', { name: 'Main' });
    for (const name of ['New check-up', 'Past check-ups', 'Settings'])
      expect(await topBar.getByRole('link', { name }).count(), name).toBe(1);
    // Served by the QA Tool, the page never needs to explain how to start it.
    expect(await page.getByText('Start Release check-up first').count()).toBe(0);
    // No key yet: connecting the AI comes first, on this screen.
    await page.getByRole('heading', { name: 'Connect the AI for a smarter plan' }).waitFor();
    expectPlain(await plainText(page), 'the new check-up');
    await screenshot('new-checkup-first-visit');

    // Studio's old address leads to Past check-ups, which is empty.
    await page.goto(`${toolUrl}/studio/`);
    await page.waitForURL(`${toolUrl}/reports`);
    await expect.poll(() => heading(page)).toBe('Past check-ups');
    await page.getByText('No check-ups yet.').waitFor();
    await checkPhone('/reports', 'past-empty', { role: 'link', name: 'Start a new check-up' });

    await page.goto(`${toolUrl}/no-such-page`);
    await expect.poll(() => heading(page)).toBe('Page not found');
    expect(await topBar.count()).toBe(1);
    expectPlain(await plainText(page), 'page not found');
    await checkPhone('/no-such-page', 'not-found', { role: 'link', name: 'Start a new check-up' });
  }, 60000);

  it('first visit: specs typed before the AI key are kept, and the key is checked on the same screen', async () => {
    await page.goto(`${toolUrl}/check`);
    const address = page.getByLabel('Site address');
    await address.fill(fixtureHost);
    // The address actually used shows once it's checked. A site not checked before starts unticked.
    await expect
      .poll(() => page.locator('#url-status').innerText(), { timeout: 15000 })
      .toContain(`Found ${fixtureUrl}`);
    // One question for what the check-up may do; a site not checked before is only looked at.
    const owner = page.getByRole('radio', { name: /Test it fully/ });
    expect(await owner.isChecked()).toBe(false);
    expect(await page.getByRole('radio', { name: 'Only look at it' }).isChecked()).toBe(true);
    expect(await page.locator('#url-status').innerText()).toContain('Only looked at, nothing is sent or changed.');
    // A local address is a test copy already: there's no live-site answer to give.
    expect(await page.getByRole('radio', { name: /my live site/ }).count()).toBe(0);

    await page.getByText('Add specs, design notes or journeys').click();
    await page.getByLabel('Specs', { exact: true }).fill(SPECS);
    // This copy isn't the shared one, so there is no shared-copy warning.
    expect(await page.getByText('This is a shared copy').count()).toBe(0);
    // No key yet doesn't stop a first scan: fixed rules write the plan, and the key is offered as an upgrade.
    const scan = page.getByRole('button', { name: 'Scan the site' });
    expect(await scan.isDisabled()).toBe(false);
    expect(await page.locator('#start-hint').innerText()).toBe(
      'No AI key yet, so fixed rules will write the plan. Nothing is tested until you approve it.'
    );

    const key = page.getByLabel('OpenRouter key');
    await key.fill('sk-or-v1-revoked');
    await expect
      .poll(() => page.locator('#ai-key-status').innerText())
      .toContain('The key doesn’t work, or it’s out of credit.');
    await key.fill(GOOD_KEY);
    await expect.poll(() => page.locator('#ai-key-status').innerText(), { timeout: 5000 }).toContain('The key works');
    const save = page.getByRole('button', { name: 'Save the key' });
    openRouterModels.list = [];
    await save.click();
    await expect
      .poll(() => page.getByRole('alert').first().innerText())
      .toBe('No free AI models are available right now. Please try again later.');
    openRouterModels.list = [FREE_MODEL];
    await save.click();
    await page.getByText('The AI is connected.').waitFor();
    expect(await page.getByRole('heading', { name: 'Connect the AI for a smarter plan' }).count()).toBe(0);
    // The QA Tool, not this browser, remembers the key and the model it chose.
    expect(await api('/api/ai/openrouter/key')).toMatchObject({ configured: true, model: FREE_MODEL.id });

    // Nothing typed was lost.
    expect(await address.inputValue()).toBe(fixtureHost);
    expect(await page.getByLabel('Specs', { exact: true }).inputValue()).toBe(SPECS);

    await owner.check();
    await expect
      .poll(() => page.locator('#url-status').innerText())
      .toContain('Test copy: forms can be filled in and sent.');
    // Search checks are off for a test copy unless asked for; this check-up asks for them.
    const search = page.getByRole('checkbox', { name: /Check how search engines/ });
    expect(await search.isChecked()).toBe(false);
    await search.check();
    // Before anything starts: about how many AI requests the scan needs, and a way to spend none.
    await page.getByText(/Planning needs about \d+ to \d+ AI requests/).waitFor({ timeout: 15000 });
    expect(await page.getByRole('checkbox', { name: /Plan with fixed rules now/ }).isChecked()).toBe(false);
    expect(await scan.isDisabled()).toBe(false);
    expectPlain(await plainText(page), 'the new check-up with its key');
    await screenshot('new-checkup-ready');

    // Another browser, with nothing stored in it, isn't asked for the key.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`${toolUrl}/check`);
    await expect.poll(() => heading(otherPage), { timeout: 10000 }).toBe('Enter the address of the site to check');
    expect(await otherPage.getByRole('heading', { name: 'Connect the AI for a smarter plan' }).count()).toBe(0);
    await other.close();
  }, 60000);

  it('scans, shows the plan, and keeps it waiting when you leave it', async () => {
    runRequests.length = 0;
    await page.getByRole('button', { name: 'Scan the site' }).click();
    await page.waitForURL(`${toolUrl}/check/scan`);
    await expect.poll(() => heading(page)).toBe(`Scanning ${fixtureHost}`);
    const steps = page.getByRole('navigation', { name: 'Check-up steps' });
    expect(await steps.locator('[aria-current="step"]').innerText()).toContain('Plan');
    await page.getByRole('region', { name: 'Scan progress' }).getByText('Pages found').waitFor();
    expectPlain(await plainText(page), 'the scan');
    await screenshot('scanning');
    await checkPhone('/check/scan', 'scanning', { role: 'button', name: 'Stop scanning' });

    // The plan waits for review: nothing is tested until it's approved.
    const approve = page.getByRole('button', { name: 'Approve the plan and start testing' });
    await approve.waitFor({ timeout: 120000 });
    expect(page.url()).toBe(`${toolUrl}/check/plan`);
    expect(await heading(page)).toBe(`Review the plan for ${fixtureHost}`);
    await expect.poll(() => page.title()).toBe(`Plan for ${fixtureHost} · Release check-up`);

    expect(runRequests).toHaveLength(1);
    expect(runRequests[0]).toMatchObject({
      targetUrl: fixtureUrl,
      owner: true,
      skipReview: false,
      mode: 'product',
      useAI: true,
      aiProvider: 'openrouter',
      searchChecks: true,
    });
    expect(runRequests[0].productContext).toContain('# Specs\n\n# Invoices\n- Amount must be positive');
    // The specs pasted before the key reached the plan.
    expect(await page.getByLabel('Specs, requirements or user stories').inputValue()).toContain(
      'Amount must be positive'
    );

    // The complete plan: every page found, every link, every journey.
    const plan = await api<ReviewPlan>('/api/runner/plan');
    expect(plan.planPages!.length).toBe(plan.pages.length);
    expect(plan.planPages!.length).toBeGreaterThan(5);
    const document = await page.locator('main').innerText();
    for (const p of plan.planPages!) expect(document, p.urlPath).toContain(p.urlPath);
    await expect
      .poll(() => page.getByRole('heading', { name: /^Navigation/ }).innerText())
      .toBe(`Navigation (${plan.navigation!.length})`);
    await expect
      .poll(() => page.getByRole('heading', { name: /^Journeys/ }).innerText())
      .toBe(`Journeys (${plan.flows.length})`);

    // Desktop only, and one page left out: both show in what approving runs.
    await page.getByRole('checkbox', { name: 'Phone (375px)' }).uncheck();
    await expect.poll(() => page.getByRole('checkbox', { name: 'Phone (375px)' }).isChecked()).toBe(false);
    await page.getByRole('checkbox', { name: 'Tablet (768px)' }).uncheck();
    await expect
      .poll(async () => (await page.locator('#plan-summary').innerText()).includes('at 1 screen size (1440px)'))
      .toBe(true);
    await page.getByRole('checkbox', { name: 'Test the page /about' }).uncheck();
    await expect.poll(() => page.locator('#plan-wontrun').innerText()).toContain('Page /about');
    expectPlain(await plainText(page), 'the plan');
    await screenshot('plan');

    const [planFile] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download the plan' }).click(),
    ]);
    const markdown = await fs.readFile((await planFile.path())!, 'utf8');
    expect(markdown).toContain(`# Test plan: ${fixtureHost}`);
    expect(markdown).toContain('- Page /about — Switched off in the review.');

    await page.getByRole('tab', { name: 'Map' }).click();
    await page.getByRole('group', { name: 'How to show the map' }).waitFor();
    await page.getByRole('tab', { name: 'Full plan' }).click();
    // On a phone the approval bar is one line with a short button.
    await checkPhone('/check/plan', 'plan', { role: 'button', name: 'Approve' });

    // Leaving the plan keeps it waiting, and the new check-up screen offers it again.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'New check-up' }).click();
    await page.waitForURL(`${toolUrl}/check`);
    const resume = page.getByRole('complementary', { name: 'Check-up in progress' });
    await expect
      .poll(() => resume.innerText())
      .toContain(`Your check-up of ${fixtureHost} is waiting for your review.`);
    expect(await runnerPhase()).toBe('awaiting-review');
    // Everything typed is still there.
    expect(await page.getByLabel('Site address').inputValue()).toBe(fixtureHost);

    // Starting another check-up asks first, and keeping the plan keeps it.
    await expect.poll(() => page.locator('#url-status').innerText(), { timeout: 15000 }).toContain('Found');
    await page.getByRole('button', { name: 'Scan the site' }).click();
    const ask = page.getByRole('dialog', { name: 'Start a new check-up?' });
    await ask.waitFor();
    expect(await ask.innerText()).toContain(
      `The plan for ${fixtureHost} that’s waiting for your review will be thrown away.`
    );
    await ask.getByRole('button', { name: 'Keep the plan' }).click();
    expect(await ask.count()).toBe(0);
    expect(page.url()).toBe(`${toolUrl}/check`);
    expect(await runnerPhase()).toBe('awaiting-review');
    expect(runRequests).toHaveLength(2); // the refused one; nothing was replaced

    await resume.getByRole('link', { name: /Open the plan/ }).click();
    await page.waitForURL(`${toolUrl}/check/plan`);
    await approve.waitFor();

    // Back, Forward and refresh land where they were; the plan's changes are still there.
    await page.goBack();
    await page.waitForURL(`${toolUrl}/check`);
    await expect.poll(() => heading(page)).toBe('Enter the address of the site to check');
    await page.goForward();
    await page.waitForURL(`${toolUrl}/check/plan`);
    await page.reload();
    await approve.waitFor({ timeout: 15000 });
    expect(await page.getByRole('checkbox', { name: 'Phone (375px)' }).isChecked()).toBe(false);

    // The step bar's finished step is a link that stops nothing.
    await page
      .getByRole('navigation', { name: 'Check-up steps' })
      .getByRole('link', { name: /Address/ })
      .click();
    await page.waitForURL(`${toolUrl}/check`);
    expect(await runnerPhase()).toBe('awaiting-review');
    await page.goBack();
    await approve.waitFor();

    // A check-up address for another step shows the step the check-up is at.
    await page.goto(`${toolUrl}/check/testing`);
    await page.waitForURL(`${toolUrl}/check/plan`, { timeout: 15000 });
  }, 240000);

  it('a test run that fails goes back to the plan and says why; stopping testing keeps the plan too', async () => {
    const approve = page.getByRole('button', { name: 'Approve the plan and start testing' });
    // The site goes down: testing can't start.
    await fixtureDown();
    await approve.click();
    const failed = page.getByRole('alert').filter({ hasText: 'Testing stopped before it finished' });
    await failed.waitFor({ timeout: 60000 });
    expect(page.url()).toBe(`${toolUrl}/check/plan`);
    expect(await failed.innerText()).toContain('Your site couldn’t be reached.');
    expect(await failed.innerText()).toContain('Your plan is kept');
    expect(await runnerPhase()).toBe('awaiting-review');
    expectPlain(await plainText(page), 'the plan after a failed run');
    await screenshot('plan-after-failure');

    // Back up: the same plan is approved again.
    await fixtureUp();
    const watching = watch();
    try {
      await approve.click();
      await page.waitForURL(`${toolUrl}/check/testing`);
      await expect.poll(() => heading(page)).toBe(`Testing ${fixtureHost}`);
      await expect
        .poll(
          () =>
            page
              .getByRole('status')
              .filter({ hasText: /Test \d+ of \d+/ })
              .count(),
          { timeout: 90000 }
        )
        .toBeGreaterThan(0);
      await page.locator('img[alt^="The latest screen"]').first().waitFor({ timeout: 60000 });
      await screenshot('testing');
      await checkPhone('/check/testing', 'testing', { role: 'button', name: 'Stop testing' });

      // A refresh mid-run picks up where testing is, from the replayed events.
      await page.reload();
      await expect
        .poll(
          () =>
            page
              .getByRole('status')
              .filter({ hasText: /Test \d+ of \d+/ })
              .count(),
          { timeout: 20000 }
        )
        .toBeGreaterThan(0);

      // The step bar never stops anything: the check-up is still being tested.
      await page
        .getByRole('navigation', { name: 'Check-up steps' })
        .getByRole('link', { name: /Address/ })
        .click();
      await page.waitForURL(`${toolUrl}/check`);
      const resume = page.getByRole('complementary', { name: 'Check-up in progress' });
      await expect.poll(() => resume.innerText()).toContain(`Your check-up of ${fixtureHost} is being tested.`);
      expect(await runnerPhase()).toBe('testing');
      await resume.getByRole('link', { name: /Watch the testing/ }).click();
      await page.waitForURL(`${toolUrl}/check/testing`);

      // Stopping asks first: a report from what's done, or back to the plan, throwing the results away.
      await page.getByRole('button', { name: 'Stop testing' }).click();
      const ask = page.getByRole('dialog', { name: 'Stop testing?' });
      expect(await ask.innerText()).toContain('Make a report from the tests done so far');
      await ask.getByRole('button', { name: 'Stop testing and keep the plan' }).click();
      await page.waitForURL(`${toolUrl}/check/plan`, { timeout: 30000 });
      await page.getByText('Testing stopped. Your plan is kept.').waitFor();
      expect(await runnerPhase()).toBe('awaiting-review');

      // Approved again, it runs to the end and the report opens at its own address.
      await approve.click();
      await page.waitForURL(/\/reports\/run-\d+$/, { timeout: 360000 });
    } finally {
      watching.stop();
    }
    firstRunId = decodeURIComponent(page.url().split('/').pop()!);
    for (const text of watching.seen.texts) expectPlain(text, 'the check-up in progress');
    // The testing screen showed the real test count, a screenshot and problems pinned to their pages.
    expect(watching.seen).toMatchObject({ testCount: true, screenshot: true, found: true, pinned: true });
  }, 600000);

  it('the report: one verdict, graded areas, problems by what to fix first, and details for developers', async () => {
    const report = await api<ReleaseReport>(`/api/runs/${firstRunId}`);
    const summary = summarizeReport(report);
    await expect.poll(() => heading(page), { timeout: 20000 }).toBe(summary.stamp);
    await expect.poll(() => page.title()).toBe(`Report for ${fixtureHost} · Release check-up`);
    expect(await page.getByText(summary.reason, { exact: true }).count()).toBe(1);
    // One verdict: no overall letter or score to contradict the stamp.
    const text = await plainText(page);
    expect(text).not.toMatch(/\/100|Readiness Grade|Overall/);
    expectPlain(text, 'the report');
    expect(
      await page.getByRole('navigation', { name: 'Check-up steps' }).locator('[aria-current="step"]').innerText()
    ).toContain('Report');

    // Six areas, each graded or "Not checked".
    const areas = page.getByRole('region', { name: 'How each area did' }).getByRole('listitem');
    expect(await areas.count()).toBe(6);
    for (const aspect of Object.keys(report.grades!.aspects) as Array<
      keyof NonNullable<ReleaseReport['grades']>['aspects']
    >) {
      const card = areas.filter({ hasText: aspect });
      const data = report.grades!.aspects[aspect];
      expect(await card.innerText(), aspect).toContain(data.checked === false ? 'Not checked' : data.grade);
    }

    // The planted defects on the dashboard colour it on the map.
    expect(['warn', 'fail']).toContain(pageResults(report).statuses['/dashboard']?.status);
    await screenshot('report');

    // Problems open with the keyboard alone.
    const problems = page.getByRole('region', { name: 'Problems found' });
    const firstProblem = problems.locator('button[aria-expanded]').first();
    await firstProblem.focus();
    await page.keyboard.press('Enter');
    expect(await firstProblem.getAttribute('aria-expanded')).toBe('true');
    await page.keyboard.press('Space');
    expect(await firstProblem.getAttribute('aria-expanded')).toBe('false');

    // Details for developers: the screenshot, and a bug report and a Playwright test to copy.
    const groups = Object.values(groupProblems(report.findings)).flat();
    const withScreenshot = groups.find((g) => g.findings[0].evidence.screenshotPath)!;
    expect(withScreenshot, 'a problem with a screenshot').toBeTruthy();
    const item = problems
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: withScreenshot.title }) })
      .first();
    await item.getByRole('button', { name: withScreenshot.title }).click();
    await item.getByText('Details for developers', { exact: true }).click();
    const image = item.getByRole('img').first();
    await image.waitFor();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 10000 })
      .toBe(true);
    await item.getByRole('button', { name: 'Copy bug report' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`### ${withScreenshot.title}`);
    await item.getByRole('button', { name: 'Copy Playwright test' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/from '(@playwright\/test|playwright)'/);
    // The technical layer is only in there.
    expectPlain(await plainText(page), 'the report with a problem open');
    await screenshot('report-details-for-developers');

    // An accessibility scan of the report finds nothing.
    const axePath = createRequire(
      createRequire(path.join(repoRoot, 'packages/checkers/package.json')).resolve('@axe-core/playwright')
    ).resolve('axe-core');
    await page.addScriptTag({ content: await fs.readFile(axePath, 'utf8') });
    const violations = await page.evaluate(async () => {
      const result = await (
        window as unknown as {
          axe: {
            run: (
              context: Document,
              options: unknown
            ) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }>;
          };
        }
      ).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    });
    expect(violations).toEqual([]);

    // Long reports get filters: by page, and by area.
    expect(report.findings.length).toBeGreaterThan(10);
    const shownTitles = () => problems.locator('button[aria-expanded] > span > span:first-child').allInnerTexts();
    const all = await shownTitles();
    await page.getByLabel('Page', { exact: true }).selectOption('/dashboard');
    await page.getByText('Showing the problems on').waitFor();
    const onDashboard = groupProblems(
      report.findings.filter((f) => f.where.urlPath === '/dashboard' || f.seenAt?.pages.includes('/dashboard'))
    );
    await expect.poll(async () => (await shownTitles()).length).toBe(Object.values(onDashboard).flat().length);
    await page.getByRole('button', { name: 'Show every page' }).click();
    await page.getByLabel('Area', { exact: true }).selectOption('Accessible');
    await expect.poll(async () => (await shownTitles()).length).toBeLessThan(all.length);
    for (const category of await problems.locator('button[aria-expanded] > span > span:nth-child(2)').allInnerTexts()) {
      expect(category).toMatch(/^(Hard for some people to use|Awkward to use)/);
    }
    await page.getByLabel('Area', { exact: true }).selectOption('all');

    // Choosing a page on the map filters the list to it. The map starts folded on a site this size.
    const map = page.getByRole('region', { name: 'Map of results' });
    await map.getByRole('heading', { name: 'Map of results' }).click();
    await map
      .getByRole('button', { name: /\/dashboard: \d+ problems?/ })
      .first()
      .click();
    await page.getByText('Showing the problems on').waitFor();
    await page.getByRole('button', { name: 'Show every page' }).click();

    // Downloads are the check-up's own files, byte for byte.
    const runFolder = path.join(outputDir, 'runs', firstRunId);
    const [html] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download the report' }).click(),
    ]);
    expect(
      (await fs.readFile((await html.path())!)).equals(await fs.readFile(path.join(runFolder, 'report.html')))
    ).toBe(true);
    await page.getByText('Details for developers', { exact: true }).last().click();
    for (const file of ['report.md', 'findings.json']) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: `Download ${file}` }).click(),
      ]);
      expect(
        (await fs.readFile((await download.path())!)).equals(await fs.readFile(path.join(runFolder, file))),
        file
      ).toBe(true);
    }

    await checkPhone(`/reports/${firstRunId}`, 'report', { role: 'button', name: 'Download the report' });
  }, 180000);

  it('Test again reuses the approved plan: nothing changed, so it tests at once', async () => {
    runRequests.length = 0;
    await page.getByRole('button', { name: 'Test again' }).click();
    await expect.poll(() => runRequests.length, { timeout: 30000 }).toBe(1);
    expect(runRequests[0]).toMatchObject({ targetUrl: fixtureUrl, owner: true, testAgain: true });
    // The first check-up's specs go along.
    expect(runRequests[0].productContext).toContain('Amount must be positive');
    // No review this time: from the scan straight to testing, then the new report.
    await page.waitForURL((url) => /^\/reports\/run-\d+$/.test(url.pathname) && !url.pathname.endsWith(firstRunId), {
      timeout: 360000,
    });
    await expect.poll(runnerPhase).toBe('done');
    secondRunId = decodeURIComponent(page.url().split('/').pop()!);
    expect(secondRunId).not.toBe(firstRunId);
    const report = await api<ReleaseReport>(`/api/runs/${secondRunId}`);
    expect(report.testedWithApprovedPlan).toEqual(expect.any(String));
    expect(new Set(report.results.map((r) => r.breakpoint))).toEqual(new Set(['1440px']));
    await page.getByText(/^Tested with the plan you approved on \d+ \w+ \d{4}\.$/).waitFor({ timeout: 20000 });
  }, 420000);

  it('Past check-ups: an older report opens, survives a reload, and can be deleted', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Past check-ups' }).click();
    await page.waitForURL(`${toolUrl}/reports`);
    await expect.poll(() => heading(page)).toBe('Past check-ups');
    await page.getByRole('heading', { name: `${fixtureHost} (2 check-ups)` }).waitFor();
    expectPlain(await plainText(page), 'past check-ups');
    await screenshot('past-checkups');
    await checkPhone('/reports', 'past', { role: 'link', name: /^Open the check-up/ });

    // Newest first: the older one is second.
    const open = page.getByRole('link', { name: /^Open the check-up/ });
    await open.nth(1).click();
    await page.waitForURL(`${toolUrl}/reports/${firstRunId}`);
    const first = summarizeReport(await api<ReleaseReport>(`/api/runs/${firstRunId}`));
    await expect.poll(() => heading(page)).toBe(first.stamp);
    await page.reload();
    await expect.poll(() => heading(page), { timeout: 15000 }).toBe(first.stamp);
    await page.goBack();
    await page.waitForURL(`${toolUrl}/reports`);
    await page.goForward();
    await page.waitForURL(`${toolUrl}/reports/${firstRunId}`);
    await page.goBack();

    await page
      .getByRole('button', { name: /^Delete the check-up/ })
      .nth(1)
      .click();
    const ask = page.getByRole('dialog', { name: 'Delete this check-up?' });
    expect(await ask.innerText()).toContain('This can’t be undone.');
    await ask.getByRole('button', { name: 'Delete the check-up' }).click();
    await page.getByRole('heading', { name: `${fixtureHost} (1 check-up)` }).waitFor();
    expect((await fetch(`${toolUrl}/api/runs/${firstRunId}`)).status).toBe(404);
    expect((await api<{ runs: RunSummary[] }>('/api/runs')).runs.map((r) => r.runId)).toEqual([secondRunId]);
  }, 60000);

  it('Go deeper starts a clean signed-in scan with the first check-up’s specs, and stopping keeps the form', async () => {
    await page.goto(`${toolUrl}/reports/${secondRunId}`);
    await page.getByRole('button', { name: 'Go deeper: test the signed-in pages' }).click();
    await page.getByLabel('Email or username').fill('manager@example.com');
    await page.getByLabel('Password').fill('manager-password');
    runRequests.length = 0;
    await page.getByRole('button', { name: 'Scan the signed-in pages' }).click();
    await page.waitForURL(`${toolUrl}/check/scan`, { timeout: 30000 });
    expect(runRequests[0]).toMatchObject({
      targetUrl: fixtureUrl,
      owner: true,
      roles: [{ role: 'member', username: 'manager@example.com' }],
    });
    expect(runRequests[0].productContext).toContain('Amount must be positive');
    expect(runRequests[0].testAgain).toBeUndefined();
    // The new scan's own progress shows, not the last one's.
    await expect.poll(() => heading(page)).toBe(`Scanning ${fixtureHost}`);
    await page.getByRole('region', { name: 'Scan progress' }).getByText('Pages found').waitFor({ timeout: 30000 });

    await page.getByRole('button', { name: 'Stop scanning' }).click();
    const ask = page.getByRole('dialog', { name: 'Stop scanning?' });
    expect(await ask.innerText()).toContain('or throw the scan away. AI requests already used stay used.');
    await ask.getByRole('button', { name: 'Throw it away' }).click();
    await page.waitForURL(`${toolUrl}/check`);
    expect(await page.getByLabel('Site address').inputValue()).toBe(fixtureHost);
    await expect.poll(runnerPhase).toBe('idle');
  }, 90000);

  it('remembers the owner choice for the site on the next check-up', async () => {
    // A fresh browser: only the QA Tool can remember it.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    try {
      await otherPage.goto(`${toolUrl}/check`);
      await otherPage.getByLabel('Site address').fill(fixtureHost);
      await expect.poll(() => otherPage.locator('#url-status').innerText(), { timeout: 15000 }).toContain('Found');
      await expect.poll(() => otherPage.getByRole('radio', { name: /Test it fully/ }).isChecked()).toBe(true);
      expect(await otherPage.locator('#url-status').innerText()).toContain(
        'Test copy: forms can be filled in and sent.'
      );
      await checkPhone('/check', 'new-checkup', { role: 'button', name: 'Scan the site' });
    } finally {
      await other.close();
    }
  }, 60000);

  it('Settings: the key in use, and replacing it', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
    await page.waitForURL(`${toolUrl}/settings`);
    await expect.poll(() => heading(page)).toBe('Settings');
    await page.getByText('✓ Saved').waitFor();
    await page.getByText(FREE_MODEL.id).waitFor();
    expectPlain(await plainText(page), 'settings');
    await checkPhone('/settings', 'settings', { role: 'button', name: 'Replace the key' });

    await page.getByRole('button', { name: 'Replace the key' }).click();
    // There's a key to keep, so keeping it is offered.
    await page.getByRole('button', { name: 'Keep my current key' }).click();
    await page.getByRole('button', { name: 'Replace the key' }).click();
    await page.getByLabel('OpenRouter key').fill(GOOD_KEY);
    await expect.poll(() => page.locator('#ai-key-status').innerText(), { timeout: 5000 }).toContain('The key works');
    await page.getByRole('button', { name: 'Save the new key' }).click();
    await page.getByText('The new key is saved and works.').waitFor();
    await screenshot('settings');

    await page.goBack();
    await page.waitForURL(`${toolUrl}/check`);
    await page.goForward();
    await page.waitForURL(`${toolUrl}/settings`);
    await expect.poll(() => heading(page)).toBe('Settings');
  }, 60000);
});
