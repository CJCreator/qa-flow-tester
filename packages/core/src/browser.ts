import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import type { Breakpoint } from '@qa/types';

export interface BrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  tunnelAuth?: string;
  baseUrl?: string;
  storageState?: string;
  /** When set, Playwright records a .webm of every page in the context into this directory. */
  recordVideoDir?: string;
}

export const BREAKPOINT_VIEWPORTS: Record<Breakpoint, { width: number; height: number }> = {
  '375px': { width: 375, height: 667 }, // Mobile
  '768px': { width: 768, height: 1024 }, // Tablet
  '1440px': { width: 1440, height: 900 }, // Desktop
};

export class BrowserManager {
  private browser: Browser | null = null;

  async launch(headless = true): Promise<Browser> {
    // A browser that crashed (low memory, a renderer fault) is replaced, not reused.
    if (this.browser && !this.browser.isConnected()) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless,
        // Small hosts have little memory: no GPU process or extensions to hold on to.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
        ],
      });
    }
    return this.browser;
  }

  async createContext(options: BrowserOptions = {}): Promise<BrowserContext> {
    const browser = await this.launch(options.headless ?? true);

    const extraHTTPHeaders: Record<string, string> = {};
    if (options.tunnelAuth) {
      extraHTTPHeaders['X-Tunnel-Skip-AntiPhishing-Page'] = 'true';
      extraHTTPHeaders['X-Tunnel-Authorization'] = options.tunnelAuth;
    }

    const viewport = options.viewport || BREAKPOINT_VIEWPORTS['1440px'];
    const contextOptions = {
      viewport,
      extraHTTPHeaders,
      baseURL: options.baseUrl,
      ignoreHTTPSErrors: true,
      storageState: options.storageState,
    };

    if (options.recordVideoDir) {
      try {
        return await browser.newContext({
          ...contextOptions,
          recordVideo: { dir: options.recordVideoDir, size: viewport },
        });
      } catch (err) {
        // Missing ffmpeg (`npx playwright install ffmpeg`) must not block the run.
        console.warn(
          `[Browser] Video recording unavailable, continuing without it: ${err instanceof Error ? err.message : err}`
        );
      }
    }
    return browser.newContext(contextOptions);
  }

  /**
   * A new context with one page. If the browser has crashed, it is restarted once, so one crash
   * costs one test point rather than the whole run.
   */
  async openPage(options: BrowserOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
    for (let attempt = 0; ; attempt++) {
      let context: BrowserContext | undefined;
      try {
        context = await this.createContext(options);
        return { context, page: await context.newPage() };
      } catch (err) {
        await context?.close().catch(() => {});
        if (attempt > 0) throw err;
        console.warn(`[Browser] Restarting the browser: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
        await this.browser?.close().catch(() => {});
        this.browser = null;
      }
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

// If an element is nested inside a closed <details> accordion/disclosure, auto-open it
async function revealIfInsideDetails(locator: Locator): Promise<void> {
  await locator
    .evaluate((el) => {
      let curr: HTMLElement | null = el as HTMLElement;
      while (curr) {
        if (curr.tagName === 'DETAILS' && !(curr as HTMLDetailsElement).open) {
          (curr as HTMLDetailsElement).open = true;
          curr.dispatchEvent(new Event('toggle'));
        }
        curr = curr.parentElement;
      }
    })
    .catch(() => {});
}

/**
 * Resilient element locator helper:
 * Prioritizes data-testid, then raw CSS selector, then label / accessible name, then visible text.
 */
export async function locateElement(page: Page, selector: string): Promise<Locator> {
  // If explicitly formatted as a data-testid selector
  if (selector.startsWith('[data-testid=') || selector.startsWith('[data-testid=')) {
    const loc = page.locator(selector);
    await revealIfInsideDetails(loc);
    return loc;
  }

  // If provided as raw testid identifier e.g. "submit-btn"
  if (/^[a-zA-Z0-9_\-]+$/.test(selector)) {
    const testIdLocator = page.locator(`[data-testid="${selector}"]`);
    if ((await testIdLocator.count()) > 0) {
      const loc = testIdLocator.first();
      await revealIfInsideDetails(loc);
      return loc;
    }
  }

  // Try standard locator. Plain prose ("Email address") is not valid CSS and makes count() throw.
  const standardLocator = page.locator(selector);
  if ((await standardLocator.count().catch(() => 0)) > 0) {
    // Sites often have the same link twice (a wide-screen menu and a phone menu): use the one on screen.
    const onScreen = standardLocator.filter({ visible: true });
    const loc = (await onScreen.count().catch(() => 0)) > 0 ? onScreen.first() : standardLocator.first();
    await revealIfInsideDetails(loc);
    return loc;
  }

  // Extract quoted text if prompt wrote `Click “...”`
  const quoted = selector.match(/["“]([^"”]+)["”]/)?.[1];
  const candidates = [selector];
  if (quoted && quoted !== selector) candidates.push(quoted);

  // Generate cleaned variants by stripping decorative symbols (e.g. checkmarks, arrows)
  for (const s of [...candidates]) {
    const clean = s
      .replace(/^[✓✕●–!•\s]+/, '')
      .replace(/[\s→←…><]+$/, '')
      .trim();
    if (clean && clean !== s) candidates.push(clean);
  }

  for (const target of candidates) {
    // Form control by its <label> / aria-label
    const labelLocator = page.getByLabel(target, { exact: false });
    if ((await labelLocator.count()) > 0) {
      const loc = labelLocator.first();
      await revealIfInsideDetails(loc);
      return loc;
    }

    // Button or link by accessible name
    const roleLocator = page.getByRole('button', { name: target }).or(page.getByRole('link', { name: target }));
    if ((await roleLocator.count()) > 0) {
      const loc = roleLocator.first();
      await revealIfInsideDetails(loc);
      return loc;
    }

    // Visible text
    const textLocator = page.getByText(target, { exact: false });
    if ((await textLocator.count()) > 0) {
      const loc = textLocator.first();
      await revealIfInsideDetails(loc);
      return loc;
    }
  }

  await revealIfInsideDetails(standardLocator);
  return standardLocator;
}
