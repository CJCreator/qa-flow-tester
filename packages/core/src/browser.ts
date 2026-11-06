import { chromium, webkit, firefox, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import type { Breakpoint, StorageStateData } from '@qa/types';
import { isSameSite } from './same-site.js';

export type BrowserEngine = 'chromium' | 'webkit' | 'firefox' | 'android-chrome';

/** PRD FR-1.4 multi-browser engine display label. */
export function browserEngineLabel(engine: BrowserEngine): string {
  switch (engine) {
    case 'chromium':
      return 'Chrome/Chromium (primary)';
    case 'webkit':
      return 'WebKit (Playwright build)';
    case 'firefox':
      return 'Firefox (Playwright build)';
    case 'android-chrome':
      return 'Android Chrome (Mobile Emulation)';
    default:
      return engine;
  }
}

export interface RunContextOptions {
  /** Target origin; headers go only to this host */
  baseUrl: string;
  /** Tunnel authentication secret */
  tunnelAuth?: string;
  /** Custom HTTP headers (e.g. X-QA-Bypass-Token) */
  customHeaders?: Record<string, string>;
  /** Custom user-agent string */
  userAgent?: string;
  /** Extra hosts that may receive secret headers (Domain Allowlist) */
  headerHosts?: string[];
}

export interface BrowserOptions extends Partial<RunContextOptions> {
  engine?: BrowserEngine;
  headless?: boolean;
  viewport?: { width: number; height: number };
  /** A file path, or the state itself (kept in memory so a saved session never touches disk). */
  storageState?: string | StorageStateData;
  /** When set, Playwright records a .webm of every page in the context into this directory. */
  recordVideoDir?: string;
}

/**
 * Browser-wide policy for a shared machine (ADR 0014). Null (the default) changes nothing. `guard` is
 * asked about every request and aborts it on false; `pinned` maps a host to the address that was
 * checked, so the browser cannot resolve it to anything else.
 */
export interface BrowserPolicy {
  guard?: (url: string, redirected: boolean) => Promise<boolean>;
  pinned?: Record<string, string>;
}

let browserPolicy: BrowserPolicy | null = null;

export function setBrowserPolicy(policy: BrowserPolicy | null): void {
  browserPolicy = policy;
}

export function getBrowserPolicy(): BrowserPolicy | null {
  return browserPolicy;
}

/** Adds the guard as the first route of a context; later routes (blockChanges) fall back to it. */
export async function installRequestGuard(
  context: BrowserContext,
  guard: (url: string, redirected: boolean) => Promise<boolean>
): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    let allowed = false;
    try {
      allowed = await guard(request.url(), !!request.redirectedFrom());
    } catch {
      allowed = false;
    }
    if (!allowed) return route.abort('blockedbyclient');
    return route.fallback();
  });
}

export const BREAKPOINT_VIEWPORTS: Record<Breakpoint, { width: number; height: number }> = {
  '375px': { width: 375, height: 667 }, // Mobile
  '768px': { width: 768, height: 1024 }, // Tablet
  '1440px': { width: 1440, height: 900 }, // Desktop
};

function tunnelHeaders(tunnelAuth?: string): Record<string, string> {
  if (!tunnelAuth) return {};
  return {
    'X-Tunnel-Skip-AntiPhishing-Page': 'true',
    'X-Tunnel-Authorization': tunnelAuth,
  };
}

export class BrowserManager {
  private browser: Browser | null = null;
  private browsers = new Map<BrowserEngine, Browser>();

  async launch(engineOrHeadless: BrowserEngine | boolean = 'chromium', headless = true): Promise<Browser> {
    const engine: BrowserEngine = typeof engineOrHeadless === 'string' ? engineOrHeadless : 'chromium';
    const isHeadless = typeof engineOrHeadless === 'boolean' ? engineOrHeadless : headless;

    const existing = this.browsers.get(engine);
    if (existing && !existing.isConnected()) {
      await existing.close().catch(() => {});
      this.browsers.delete(engine);
      if (engine === 'chromium') this.browser = null;
    }

    let b = this.browsers.get(engine);
    if (!b) {
      const launcher = engine === 'webkit' ? webkit : engine === 'firefox' ? firefox : chromium;
      const pinned = Object.entries(browserPolicy?.pinned ?? {}).map(
        ([host, ip]) => `MAP ${host} ${ip.includes(':') ? `[${ip.replace(/^\[|\]$/g, '')}]` : ip}`
      );
      const args =
        engine === 'chromium' || engine === 'android-chrome'
          ? [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--disable-extensions',
              ...(pinned.length ? [`--host-resolver-rules=${pinned.join(', ')}`] : []),
            ]
          : [];
      b = await launcher.launch({
        headless: isHeadless,
        args,
      });
      this.browsers.set(engine, b);
      if (engine === 'chromium' || engine === 'android-chrome') {
        this.browser = b;
      }
    }
    return b;
  }

  async createContext(options: BrowserOptions = {}): Promise<BrowserContext> {
    const engine = options.engine ?? 'chromium';
    const browser = await this.launch(engine, options.headless ?? true);

    const isAndroid = engine === 'android-chrome';
    const defaultViewport = isAndroid ? { width: 412, height: 915 } : BREAKPOINT_VIEWPORTS['1440px'];
    const viewport = options.viewport || defaultViewport;
    const contextOptions = {
      viewport,
      isMobile: isAndroid ? true : undefined,
      hasTouch: isAndroid ? true : undefined,
      userAgent:
        options.userAgent ??
        (isAndroid
          ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'
          : undefined),
      baseURL: options.baseUrl,
      ignoreHTTPSErrors: true,
      storageState: options.storageState as NonNullable<Parameters<Browser['newContext']>[0]>['storageState'],
    };

    const hostAllowed = (reqUrl: string): boolean => {
      try {
        const reqHost = new URL(reqUrl).host.toLowerCase();
        if (options.baseUrl) {
          const baseHost = new URL(options.baseUrl).host.toLowerCase();
          if (isSameSite(reqHost, baseHost) || reqHost === baseHost) return true;
        }
        if (options.headerHosts) {
          for (const h of options.headerHosts) {
            const allowedHost = h.toLowerCase();
            if (isSameSite(reqHost, allowedHost) || reqHost === allowedHost) return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    };

    const secret = { ...tunnelHeaders(options.tunnelAuth), ...options.customHeaders };

    const setupContext = async (context: BrowserContext): Promise<BrowserContext> => {
      // 1. Scoped headers route: registered before guard, so Playwright's LIFO runs guard first.
      if (Object.keys(secret).length > 0) {
        await context.route('**/*', async (route) => {
          if (hostAllowed(route.request().url())) {
            return route.fallback({
              headers: { ...route.request().headers(), ...secret },
            });
          }
          return route.fallback();
        });
      }

      // 2. Request guard: registered after, so it runs first in LIFO order.
      if (browserPolicy?.guard) {
        await installRequestGuard(context, browserPolicy.guard);
      }
      return context;
    };

    if (options.recordVideoDir) {
      try {
        return await setupContext(
          await browser.newContext({
            ...contextOptions,
            recordVideo: { dir: options.recordVideoDir, size: viewport },
          })
        );
      } catch (err) {
        // Missing ffmpeg (`npx playwright install ffmpeg`) must not block the run.
        console.warn(
          `[Browser] Video recording unavailable, continuing without it: ${err instanceof Error ? err.message : err}`
        );
      }
    }
    return setupContext(await browser.newContext(contextOptions));
  }

  /**
   * A new context with one page. If the browser has crashed, it is restarted once, so one crash
   * costs one test point rather than the whole run.
   */
  async openPage(options: BrowserOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
    const engine = options.engine ?? 'chromium';
    for (let attempt = 0; ; attempt++) {
      let context: BrowserContext | undefined;
      try {
        context = await this.createContext(options);
        return { context, page: await context.newPage() };
      } catch (err) {
        await context?.close().catch(() => {});
        if (attempt > 0) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        const b = this.browsers.get(engine);
        const isClosed =
          /Target (page, context or browser )?has been closed|Browser has been closed|browser has disconnected/i.test(
            msg
          ) || (b ? !b.isConnected() : false);
        if (!isClosed) throw err;
        console.warn(
          `[Browser] Restarting the browser (${engine}): ${err instanceof Error ? err.message.split('\n')[0] : err}`
        );
        const dead = this.browsers.get(engine);
        await dead?.close().catch(() => {});
        this.browsers.delete(engine);
        if (engine === 'chromium') this.browser = null;
      }
    }
  }

  async close(): Promise<void> {
    const closes: Promise<void>[] = [];
    for (const b of this.browsers.values()) {
      closes.push(Promise.race([b.close().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, 3000))]));
    }
    await Promise.all(closes);
    this.browsers.clear();
    this.browser = null;
  }
}

// If an element is nested inside a closed <details> accordion/disclosure, auto-open it
async function revealIfInsideDetails(locator: Locator): Promise<void> {
  // evaluate() waits up to Playwright's 30 s default for a missing element, which ate the step budget.
  if ((await locator.count().catch(() => 0)) === 0) return;
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
