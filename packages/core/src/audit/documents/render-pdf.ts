/**
 * Prints a rendered document (render-html.ts) to PDF with Chromium through the existing `playwright`
 * dependency (REQ-022). The HTML is self-contained (ADR 0021), so nothing may load: every request that is not
 * a `data:` URI is aborted, the context is offline and runs no script. The browser is always closed, also when
 * printing fails or takes too long.
 *
 * Node-only module: never imported by the wizard.
 */

import { chromium, errors, type Browser } from 'playwright';

export const PDF_TIMEOUT_MS = 60_000;

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

/** The HTML document printed to a PDF file. Throws a plain-sentence Error on failure or timeout. */
export async function renderPdf(html: string, options: RenderPdfOptions = {}): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? PDF_TIMEOUT_MS;
  const format = options.format ?? 'A4';
  let browser: Browser | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    try {
      browser = await chromium.launch({
        headless: true,
        timeout: timeoutMs,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--dns-prefetch-disable',
        ],
      });
    } catch (err) {
      throw new Error(err instanceof errors.TimeoutError ? TOO_LONG : FAILED, { cause: err });
    }
    const open = browser;
    const print = (async () => {
      const context = await open.newContext({ javaScriptEnabled: false, offline: true, serviceWorkers: 'block' });
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('data:')) return route.continue();
        options.onBlockedRequest?.(url);
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
      return page.pdf({ format, printBackground: true, preferCSSPageSize: false });
    })();
    // Closing the browser below rejects whatever is still pending; this keeps that from going unhandled.
    print.catch(() => {});
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(TOO_LONG)), timeoutMs);
    });
    try {
      return await Promise.race([print, timeout]);
    } catch (err) {
      if (err instanceof Error && err.message === TOO_LONG) throw err;
      throw new Error(err instanceof errors.TimeoutError ? TOO_LONG : FAILED, { cause: err });
    }
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}
