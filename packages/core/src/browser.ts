import { chromium, webkit, firefox, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import type { Breakpoint, StorageStateData } from '@qa/types';
import { isSameSite } from './same-site.js';
import { abortError } from './abort.js';
import { classifyAddress, isPrivateTextHost } from './address-class.js';

export type BrowserEngine = 'chromium' | 'webkit' | 'firefox' | 'android-chrome';

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
  /** The App is a Test Copy: a self-signed certificate is accepted (T-312). */
  trustInvalidCertificates?: boolean;
}

/** Certificate errors are ignored only on this machine, a private network, or a Test Copy. */
export function ignoresCertificateErrors(baseUrl: string | undefined, testCopy: boolean): boolean {
  if (testCopy) return true;
  try {
    const host = new URL(baseUrl ?? '').hostname;
    return isPrivateTextHost(host) || classifyAddress(host) !== null;
  } catch {
    return false;
  }
}

/**
 * Browser-wide policy for a shared machine (ADR 0014). Null (the default) changes nothing. `guard` is
 * asked about every request and aborts it on false; `pinned` maps a host to the address that was
 * checked, so the browser cannot resolve it to anything else.
 */
export interface BrowserPolicy {
  guard?: (url: string, redirected: boolean) => Promise<boolean>;
  pinned?: Record<string, string>;
  /** The egress proxy every browser on this machine uses (ADR 0045). */
  proxy?: string;
}

let browserPolicy: BrowserPolicy | null = null;

export function setBrowserPolicy(policy: BrowserPolicy | null): void {
  browserPolicy = policy;
}

export function getBrowserPolicy(): BrowserPolicy | null {
  return browserPolicy;
}

type RequestGuard = (url: string, redirected: boolean) => Promise<boolean>;
/** Every guard installed on a context; its one WebSocket route asks all of them. */
const socketGuards = new WeakMap<BrowserContext, RequestGuard[]>();

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

  // route() never sees a WebSocket handshake: the same guard decides, and a refused socket is closed.
  const guards = socketGuards.get(context);
  if (guards) {
    guards.push(guard);
    return;
  }
  socketGuards.set(context, [guard]);
  await context.routeWebSocket(/.*/, async (ws) => {
    let allowed = false;
    try {
      const all = socketGuards.get(context) ?? [];
      allowed = (await Promise.all(all.map((g) => g(ws.url(), false)))).every(Boolean);
    } catch {
      allowed = false;
    }
    if (!allowed) return ws.close({ code: 1008, reason: 'Blocked: not a public address' });
    ws.connectToServer();
  });
}

/** No direct UDP for WebRTC: STUN/TURN packets cannot reach addresses the request guard never sees. */
export const WEBRTC_NO_DIRECT_UDP = '--force-webrtc-ip-handling-policy=disable_non_proxied_udp';

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
  private browsers = new Map<BrowserEngine, Browser>();
  private abandoned = false;
  /** Set per run: true only for a Test Copy (T-312). Used when a context's options leave it out. */
  trustInvalidCertificates = false;

  async launch(engineOrHeadless: BrowserEngine | boolean = 'chromium', headless = true): Promise<Browser> {
    if (this.abandoned) throw abortError();
    const engine: BrowserEngine = typeof engineOrHeadless === 'string' ? engineOrHeadless : 'chromium';
    const isHeadless = typeof engineOrHeadless === 'boolean' ? engineOrHeadless : headless;

    const existing = this.browsers.get(engine);
    if (existing && !existing.isConnected()) {
      await existing.close().catch(() => {});
      this.browsers.delete(engine);
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
              ...(browserPolicy?.guard ? [WEBRTC_NO_DIRECT_UDP] : []),
              ...(pinned.length ? [`--host-resolver-rules=${pinned.join(', ')}`] : []),
            ]
          : [];
      b = await launcher.launch({
        headless: isHeadless,
        args,
        ...(browserPolicy?.proxy ? { proxy: { server: browserPolicy.proxy } } : {}),
      });
      this.browsers.set(engine, b);
    }
    return b;
  }

  async createContext(options: BrowserOptions = {}): Promise<BrowserContext> {
    if (this.abandoned) throw abortError();
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
      ignoreHTTPSErrors: ignoresCertificateErrors(
        options.baseUrl,
        options.trustInvalidCertificates ?? this.trustInvalidCertificates
      ),
      serviceWorkers: 'block' as const,
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
      }
    }
  }

  async close(): Promise<void> {
    const closes: Promise<void>[] = [];
    for (const b of this.browsers.values()) {
      closes.push(
        (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const giveUp = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 3000);
          });
          try {
            await Promise.race([b.close().catch(() => {}), giveUp]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        })()
      );
    }
    await Promise.all(closes);
    this.browsers.clear();
  }

  /**
   * The run was abandoned (a stop did not tear down in time): close every browser, capped at 2 s each, and refuse
   * new ones. Playwright gives no process handle for launch(), so if close() itself hangs the Chromium process can
   * outlive this call (residual risk).
   */
  async abandon(): Promise<void> {
    this.abandoned = true;
    const browsers = [...this.browsers.values()];
    this.browsers.clear();
    await Promise.all(
      browsers.map(async (b) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const giveUp = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2000);
        });
        try {
          await Promise.race([b.close().catch(() => {}), giveUp]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      })
    );
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
  if (selector.startsWith('[data-testid=')) {
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
