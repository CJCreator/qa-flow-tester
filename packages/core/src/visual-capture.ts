/**
 * Capture for the Perceptual Visual Diff (ADR 0019): settle the page, then take a screenshot with
 * volatile regions (dates, ads, password fields) painted over by Playwright. Never clicks, scrolls
 * or submits. A sidecar file beside each new baseline records that it was taken masked, so older
 * baselines keep comparing exactly as before.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { Page, Locator } from 'playwright';

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const ORD = '(?:st|nd|rd|th)?';

/** Each source matches a whole trimmed text; joined and anchored in `VOLATILE_DATE_SOURCE`. */
export const VOLATILE_DATE_PATTERNS: readonly string[] = [
  '\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?',
  '\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}',
  `${MONTH}\\s+\\d{1,2}${ORD},?\\s+\\d{4}`,
  `\\d{1,2}${ORD}\\s+${MONTH},?\\s+\\d{4}`,
  '\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:am|pm)?',
  '(?:\\d+|an?)\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago',
  'just now',
];

export const VOLATILE_DATE_SOURCE = `^(?:${VOLATILE_DATE_PATTERNS.join('|')})$`;
const MAX_DATE_TEXT = 40;

/** True when the whole trimmed text is a date, time or "N minutes ago". Prose containing a date is not. */
export function isVolatileDateText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_DATE_TEXT) return false;
  return new RegExp(VOLATILE_DATE_SOURCE, 'i').test(t);
}

/** Conservative: well-known ad markup only. Never a loose `[id*=ad]`. */
export const AD_SELECTORS: readonly string[] = [
  'ins.adsbygoogle',
  '[data-ad-slot]',
  '[data-ad-client]',
  '[id^="google_ads"]',
  '[id^="div-gpt-ad"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  '[aria-label="Advertisement" i]',
];
export const DATE_SELECTORS: readonly string[] = ['time', '[datetime]'];
export const PASSWORD_SELECTOR = 'input[type="password"]';
const TAG_ATTR = 'data-qa-visual-mask';
const MASK_COLOR = '#FF00FF';

/** Bump when the mask rules change: older masked baselines then compare unmasked. */
export const VISUAL_SIDECAR_VERSION = 1;

export async function stabilisePage(page: Page, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const started = Date.now();
  const remaining = () => Math.max(0, timeoutMs - (Date.now() - started));
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const work = (async () => {
    // Fonts ready, then lazy images forced eager and settled (each image bounded in the page).
    await page
      .evaluate(
        async (imgWaitMs: number) => {
          try {
            await document.fonts?.ready;
          } catch {
            /* ignore */
          }
          const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]'));
          imgs.forEach((i) => {
            i.loading = 'eager';
          });
          await Promise.all(
            imgs.map(
              (i) =>
                new Promise<void>((resolve) => {
                  if (i.complete) return resolve();
                  const done = () => resolve();
                  i.addEventListener('load', done, { once: true });
                  i.addEventListener('error', done, { once: true });
                  setTimeout(done, imgWaitMs);
                })
            )
          );
        },
        Math.min(2000, remaining())
      )
      .catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: Math.min(1500, remaining()) }).catch(() => undefined);
    await page
      .evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
      .catch(() => undefined);
  })().catch(() => undefined);
  try {
    await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CaptureOptions {
  masked: boolean;
  extraSelectors?: string[];
  stabiliseMs?: number;
}

export async function captureVisualShot(page: Page, opts: CaptureOptions): Promise<Buffer> {
  await stabilisePage(page, { timeoutMs: opts.stabiliseMs });
  if (!opts.masked) return page.screenshot({ animations: 'disabled', caret: 'hide' });

  let tagged = false;
  try {
    tagged = await page
      .evaluate(
        ({ source, maxLen, attr }) => {
          const re = new RegExp(source, 'i');
          let any = false;
          for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
            if (el.children.length > 0) continue;
            const text = (el.textContent ?? '').trim();
            if (text && text.length <= maxLen && re.test(text)) {
              el.setAttribute(attr, '1');
              any = true;
            }
          }
          return any;
        },
        { source: VOLATILE_DATE_SOURCE, maxLen: MAX_DATE_TEXT, attr: TAG_ATTR }
      )
      .catch(() => false);

    const selectors = [`[${TAG_ATTR}]`, ...DATE_SELECTORS, ...AD_SELECTORS, PASSWORD_SELECTOR];
    for (const s of opts.extraSelectors ?? []) {
      const ok = await page
        .evaluate((sel: string) => {
          try {
            document.querySelector(sel);
            return true;
          } catch {
            return false;
          }
        }, s)
        .catch(() => false);
      if (ok) selectors.push(s);
    }
    const mask: Locator[] = selectors.map((s) => page.locator(s));
    return await page.screenshot({ animations: 'disabled', caret: 'hide', mask, maskColor: MASK_COLOR });
  } finally {
    if (tagged) {
      await page
        .evaluate((attr: string) => {
          document.querySelectorAll(`[${attr}]`).forEach((e) => e.removeAttribute(attr));
        }, TAG_ATTR)
        .catch(() => undefined);
    }
  }
}

export function sidecarPath(pngPath: string): string {
  return pngPath.replace(/\.png$/i, '') + '.visual.json';
}

const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

export async function writeVisualBaseline(
  pngPath: string,
  buf: Buffer,
  opts: { extraSelectors?: string[] } = {}
): Promise<void> {
  await fs.mkdir(path.dirname(pngPath), { recursive: true });
  await fs.writeFile(pngPath, buf);
  await fs.writeFile(
    sidecarPath(pngPath),
    JSON.stringify(
      {
        version: VISUAL_SIDECAR_VERSION,
        masked: true,
        sha256: sha256(buf),
        extraSelectors: opts.extraSelectors ?? [],
      },
      null,
      2
    )
  );
}

export type BaselineMode = { masked: false } | { masked: true; extraSelectors: string[] };

/** Masked only when a valid sidecar vouches for exactly these PNG bytes; anything else is legacy. */
export async function readBaselineMode(pngPath: string, baselineBuf: Buffer): Promise<BaselineMode> {
  try {
    const raw = JSON.parse(await fs.readFile(sidecarPath(pngPath), 'utf8')) as Record<string, unknown>;
    if (
      raw.version !== VISUAL_SIDECAR_VERSION ||
      raw.masked !== true ||
      typeof raw.sha256 !== 'string' ||
      raw.sha256 !== sha256(baselineBuf)
    ) {
      return { masked: false };
    }
    const extra = Array.isArray(raw.extraSelectors)
      ? raw.extraSelectors.filter((s): s is string => typeof s === 'string')
      : [];
    return { masked: true, extraSelectors: extra };
  } catch {
    return { masked: false };
  }
}
