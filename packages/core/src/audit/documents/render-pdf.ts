/**
 * Prints a rendered document (render-html.ts) to PDF with Chromium through the existing `playwright`
 * dependency (REQ-022). The HTML is self-contained (ADR 0021), so nothing may load: every request that is not
 * a `data:` URI is aborted, the context is offline and runs no script.
 *
 * One Chromium is launched on the first PDF and shared by the next ones (T-410); each PDF gets its own context,
 * always closed, also when printing fails or takes too long. The browser closes after 5 idle minutes, and at
 * once when a print fails or times out with no other PDF in progress (a stuck browser is not reused).
 *
 * Node-only module: never imported by the wizard.
 */

import { chromium, errors, type Browser } from 'playwright';
import { LAB_CHROMIUM_ARGS } from '../lab-browser.js';

export const PDF_TIMEOUT_MS = 60_000;
/** How long the shared browser stays up with no PDF in progress. */
export const PDF_BROWSER_IDLE_MS = 5 * 60_000;

export interface RenderPdfOptions {
  /** Paper size. Only A4 for now (the HTML print CSS lays out A4). */
  format?: 'A4';
  /** Bounds the browser start and, separately, the printing. Default 60 s. */
  timeoutMs?: number;
  /** Called with the address of each request that was stopped. Addresses only, never page content. */
  onBlockedRequest?: (url: string) => void;
}

const TOO_LONG = 'Printing the document to PDF took too long. Try again, or export fewer documents at once.';
const FAILED = 'The document could not be printed to PDF.';

let shared: Promise<Browser> | undefined;
let active = 0;
let idleTimer: NodeJS.Timeout | undefined;

function clearIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
}

/** Closes the shared browser, if any. Safe to call at any time; the next PDF launches a fresh one. */
export async function closePdfBrowser(): Promise<void> {
  clearIdleTimer();
  const pending = shared;
  shared = undefined;
  if (!pending) return;
  const browser = await pending.catch(() => undefined);
  await browser?.close().catch(() => {});
}

function armIdleTimer(): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (active === 0) void closePdfBrowser();
  }, PDF_BROWSER_IDLE_MS);
  idleTimer.unref?.();
}

function sharedBrowser(timeoutMs: number): Promise<Browser> {
  if (shared) return shared;
  const launching = chromium.launch({
    headless: true,
    timeout: timeoutMs,
    args: [...LAB_CHROMIUM_ARGS],
  });
  shared = launching;
  launching.then(
    (browser) => {
      // A browser that dies on its own is dropped, so the next PDF starts a new one.
      browser.on('disconnected', () => {
        if (shared === launching) shared = undefined;
      });
    },
    () => {
      if (shared === launching) shared = undefined;
    }
  );
  return launching;
}

/** The HTML document printed to a PDF file. Throws a plain-sentence Error on failure or timeout. */
export async function renderPdf(html: string, options: RenderPdfOptions = {}): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? PDF_TIMEOUT_MS;
  const format = options.format ?? 'A4';
  let timer: NodeJS.Timeout | undefined;
  let failed = false;
  active += 1;
  clearIdleTimer();
  try {
    let browser: Browser;
    try {
      browser = await sharedBrowser(timeoutMs);
    } catch (err) {
      failed = true;
      throw new Error(err instanceof errors.TimeoutError ? TOO_LONG : FAILED, { cause: err });
    }
    const print = (async () => {
      const context = await browser.newContext({ javaScriptEnabled: false, offline: true, serviceWorkers: 'block' });
      try {
        await context.route('**/*', (route) => {
          const url = route.request().url();
          if (url.startsWith('data:')) return route.continue();
          options.onBlockedRequest?.(url);
          return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
        return await page.pdf({ format, printBackground: true, preferCSSPageSize: false });
      } finally {
        await context.close().catch(() => {});
      }
    })();
    // Closing the browser below rejects whatever is still pending; this keeps that from going unhandled.
    print.catch(() => {});
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(TOO_LONG)), timeoutMs);
    });
    try {
      return await Promise.race([print, timeout]);
    } catch (err) {
      failed = true;
      if (err instanceof Error && err.message === TOO_LONG) throw err;
      throw new Error(err instanceof errors.TimeoutError ? TOO_LONG : FAILED, { cause: err });
    }
  } finally {
    if (timer) clearTimeout(timer);
    active -= 1;
    if (active === 0) {
      // A failed or stuck print may have left the browser unusable: close it. Otherwise keep it for the next PDF.
      if (failed) await closePdfBrowser();
      else armIdleTimer();
    }
  }
}

/**
 * Thumbnails of self-contained pages (the Improved version's variants, T-415): each page is put in an offline
 * context of the shared PDF browser (T-410, one new context per call) with setContent, no script and no
 * request but `data:`, and its top `width` x `height` CSS pixels are taken as a JPEG at half scale. A page that
 * cannot be taken gives null. The context is always closed; the browser stays for the next PDF or thumbnail.
 */
export async function renderThumbnails(
  pages: readonly string[],
  options: { width?: number; height?: number; timeoutMs?: number } = {}
): Promise<Array<Buffer | null>> {
  if (pages.length === 0) return [];
  const width = options.width ?? 1440;
  const height = options.height ?? 900;
  const timeoutMs = options.timeoutMs ?? PDF_TIMEOUT_MS;
  let failed = false;
  active += 1;
  clearIdleTimer();
  try {
    const browser = await sharedBrowser(timeoutMs);
    const context = await browser.newContext({
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: 'block',
      viewport: { width, height },
      deviceScaleFactor: 0.5,
    });
    try {
      await context.route('**/*', (route) =>
        route.request().url().startsWith('data:') ? route.continue() : route.abort('blockedbyclient')
      );
      const out: Array<Buffer | null> = [];
      for (const html of pages) {
        const page = await context.newPage();
        try {
          await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
          out.push(await page.screenshot({ type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width, height } }));
        } catch {
          out.push(null);
        } finally {
          await page.close().catch(() => {});
        }
      }
      return out;
    } finally {
      await context.close().catch(() => {});
    }
  } catch {
    failed = true;
    return pages.map(() => null);
  } finally {
    active -= 1;
    if (active === 0) {
      // A failed launch or context may have left the browser unusable: close it. Otherwise keep it.
      if (failed) await closePdfBrowser();
      else armIdleTimer();
    }
  }
}
