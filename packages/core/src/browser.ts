import { chromium, webkit, firefox, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import type { Breakpoint, StorageStateData } from '@qa/types';
import { isSameSite } from './same-site.js';

export type BrowserEngine = 'chromium' | 'webkit' | 'firefox';

/** PRD FR-1.4 multi-browser engine display label. */
export function browserEngineLabel(engine: BrowserEngine): string {
  switch (engine) {
    case 'chromium':
      return 'Chrome/Chromium (primary)';
    case 'webkit':
      return 'WebKit (Playwright build)';
    case 'firefox':
      return 'Firefox (Playwright build)';
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

/** The host a target URL names, lower-cased; empty when there is no valid URL. */
function targetHostOf(baseUrl?: string): string {
  if (!baseUrl) return '';
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return '';
  }
}

/** One browser process per engine and target host. */
function browserKey(engine: BrowserEngine, host: string): string {
  return `${engine}|${host}`;
}

/**
 * A log-safe form of a URL: user name and password removed, so a target written as
 * `https://user:pass@site` is logged as `https://site/`. Text that is not a URL gets the same cut by pattern.
 */
export function urlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url.replace(/\/\/[^/?#\s]*@/, '//');
  }
}

export class BrowserManager {
  private browser: Browser | null = null;
  private browsers = new Map<string, Browser>();
  /** Launches still in progress, per key, so concurrent callers share one launch (T-56). */
  private launching = new Map<string, Promise<Browser>>();
  /** Pages from openPage that are still open, per key (T-56). */
  private live = new Map<string, number>();

  /**
   * `targetHost` is the host the browser serves. Decision 2 (T-52): Chromium keeps `--no-sandbox`, and that
   * is accepted only because each target host gets its own browser process, so one target's pages never
   * share a Chromium process with another's. The runner itself runs as the non-root `pwuser` (Dockerfile).
   * The `--no-sandbox` choice is documented in docs/CONFIGURATION.md, Browser section.
   */
  async launch(
    engineOrHeadless: BrowserEngine | boolean = 'chromium',
    headless = true,
    targetHost = ''
  ): Promise<Browser> {
    const engine: BrowserEngine = typeof engineOrHeadless === 'string' ? engineOrHeadless : 'chromium';
    const isHeadless = typeof engineOrHeadless === 'boolean' ? engineOrHeadless : headless;
    const key = browserKey(engine, targetHost);

    const existing = this.browsers.get(key);
    if (existing && !existing.isConnected()) {
      await existing.close().catch(() => {});
      // Identity check: another caller may have replaced the dead browser while the close was awaited.
      if (this.browsers.get(key) === existing) {
        this.browsers.delete(key);
        if (engine === 'chromium') this.browser = null;
      }
    }

    const current = this.browsers.get(key);
    if (current) return current;
    const inFlight = this.launching.get(key);
    if (inFlight) return inFlight;

    const started: Promise<Browser> = (async () => {
      const launcher = engine === 'webkit' ? webkit : engine === 'firefox' ? firefox : chromium;
      const pinned = Object.entries(browserPolicy?.pinned ?? {}).map(
        ([host, ip]) => `MAP ${host} ${ip.includes(':') ? `[${ip.replace(/^\[|\]$/g, '')}]` : ip}`
      );
      const args =
        engine === 'chromium'
          ? [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--disable-extensions',
              ...(pinned.length ? [`--host-resolver-rules=${pinned.join(', ')}`] : []),
            ]
          : [];
      const b = await launcher.launch({
        headless: isHeadless,
        args,
      });
      this.browsers.set(key, b);
      if (engine === 'chromium') {
        this.browser = b;
      }
      return b;
    })().finally(() => {
      // Cleared on success and on failure, so the next caller can try again.
      if (this.launching.get(key) === started) this.launching.delete(key);
    });
    this.launching.set(key, started);
    return started;
  }

  async createContext(options: BrowserOptions = {}): Promise<BrowserContext> {
    const engine = options.engine ?? 'chromium';
    const browser = await this.launch(engine, options.headless ?? true, targetHostOf(options.baseUrl));

    const viewport = options.viewport || BREAKPOINT_VIEWPORTS['1440px'];
    const contextOptions = {
      viewport,
      userAgent: options.userAgent,
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

    // A context that fails setup is closed here, so it cannot outlive the call.
    const openContext = async (opts: Parameters<Browser['newContext']>[0]): Promise<BrowserContext> => {
      const context = await browser.newContext(opts);
      try {
        return await setupContext(context);
      } catch (err) {
        await context.close().catch(() => {});
        throw err;
      }
    };

    if (options.recordVideoDir) {
      try {
        return await openContext({
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
    return openContext(contextOptions);
  }

  /**
   * A new context with one page. If the browser has crashed, it is restarted once, so one crash
   * costs one test point rather than the whole run.
   */
  async openPage(options: BrowserOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
    const engine = options.engine ?? 'chromium';
    const key = browserKey(engine, targetHostOf(options.baseUrl));
    for (let attempt = 0; ; attempt++) {
      let context: BrowserContext | undefined;
      try {
        context = await this.createContext(options);
        const page = await context.newPage();
        this.track(key, context);
        return { context, page };
      } catch (err) {
        await context?.close().catch(() => {});
        if (attempt > 0) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        const b = this.browsers.get(key);
        const isClosed =
          /Target (page, context or browser )?has been closed|Browser has been closed|browser has disconnected/i.test(
            msg
          ) || (b ? !b.isConnected() : false);
        if (!isClosed) throw err;
        // Other lanes still have live pages in this browser: retry in a new context, do not close it under them.
        if (b?.isConnected() && this.liveCount(key) > 0) {
          console.warn(`[Browser] Retrying the context (${engine}), browser shared with live pages`);
          continue;
        }
        console.warn(
          `[Browser] Restarting the browser (${engine}): ${err instanceof Error ? err.message.split('\n')[0] : err}`
        );
        const dead = this.browsers.get(key);
        await dead?.close().catch(() => {});
        if (this.browsers.get(key) === dead) {
          this.browsers.delete(key);
          if (engine === 'chromium') this.browser = null;
        }
      }
    }
  }

  private liveCount(key: string): number {
    return this.live.get(key) ?? 0;
  }

  /** Counts a page as live until its context closes. */
  private track(key: string, context: BrowserContext): void {
    this.live.set(key, this.liveCount(key) + 1);
    context.once('close', () => this.live.set(key, Math.max(0, this.liveCount(key) - 1)));
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
