import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { Finding, PhoneLayout } from '@qa/types';
import { UXQualityChecker } from '@qa/checkers';
import { BREAKPOINT_VIEWPORTS } from '../browser.js';

/**
 * Phone layout of a Sample Page (REQ-037, Q-28): a phone-width screenshot plus the existing overflow and
 * tap-target findings. Works on the page the audit pipeline already loaded; it makes no request of its own.
 */

const PHONE = BREAKPOINT_VIEWPORTS['375px'];
/** Chromium cannot capture taller images reliably; longer pages are cut at this height. */
const MAX_SCREENSHOT_HEIGHT_PX = 16000;
/** The UX checker rules this recorder keeps: tap targets and horizontal overflow. */
const PHONE_FINDING_PREFIXES = ['F-UX-TARGET-', 'F-UX-OVERFLOW-'];

export interface PhoneLayoutOptions {
  /** The version's folder; the screenshot is saved under it and its path returned relative to it. */
  versionDir: string;
  /** The page's URL path, for the findings and the screenshot name. */
  urlPath: string;
  /** Screenshot path relative to `versionDir`. Default: `phone/<slug>-<hash>.png` from `urlPath`. */
  screenshotFile?: string;
  /** Makes finding ids unique per page (the checker's ids end in a per-call counter). */
  testCaseId?: string;
  role?: string;
}

export interface PhoneLayoutRecord {
  phone: PhoneLayout;
  /** The overflow and tap-target findings named in `phone.findingIds`. */
  findings: Finding[];
}

/** `phone/<slug>-<hash>.png`: readable, and two paths that slug alike still get different files. */
export function phoneScreenshotFile(urlPath: string): string {
  const slug =
    urlPath
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'home';
  const hash = createHash('sha256').update(urlPath).digest('hex').slice(0, 8);
  return `phone/${slug}-${hash}.png`;
}

/** The absolute screenshot path, or null when `rel` would leave the version folder. */
function resolveInside(versionDir: string, rel: string): string | null {
  const root = path.resolve(versionDir);
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null;
  return abs;
}

async function waitForLayout(page: Page): Promise<void> {
  // Two animation frames: the resize has been laid out and painted.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
}

/** ADR 0018: say what was found. The checker's overflow title says "detected". */
function reword(f: Finding): Finding {
  if (!f.id.startsWith('F-UX-OVERFLOW-')) return f;
  return { ...f, title: `Horizontal page overflow found (${f.where.breakpoint})` };
}

export async function recordPhoneLayout(page: Page, opts: PhoneLayoutOptions): Promise<PhoneLayoutRecord> {
  let previous: { width: number; height: number } | null = null;
  try {
    previous = page.viewportSize();
  } catch {
    previous = null;
  }

  let overflow: boolean | null = null;
  let findings: Finding[] = [];
  let screenshotPath: string | null = null;

  try {
    await page.setViewportSize(PHONE);
    await waitForLayout(page);

    try {
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    } catch {
      overflow = null;
    }

    try {
      const all = await new UXQualityChecker().check(page, {
        testCaseId: opts.testCaseId,
        role: opts.role ?? 'visitor',
        breakpoint: '375px',
        urlPath: opts.urlPath,
        enableAxe: false,
      });
      findings = all.filter((f) => PHONE_FINDING_PREFIXES.some((p) => f.id.startsWith(p))).map(reword);
    } catch {
      findings = [];
    }

    const rel = opts.screenshotFile ?? phoneScreenshotFile(opts.urlPath);
    const abs = resolveInside(opts.versionDir, rel);
    if (abs) {
      try {
        const height = await page.evaluate(() =>
          Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)
        );
        await fs.mkdir(path.dirname(abs), { recursive: true });
        // Clip to the phone width: an overflowing page is shown as the phone shows it, 375px wide.
        await page.screenshot({
          path: abs,
          type: 'png',
          fullPage: true,
          clip: { x: 0, y: 0, width: PHONE.width, height: Math.max(1, Math.min(height, MAX_SCREENSHOT_HEIGHT_PX)) },
        });
        screenshotPath = path.relative(path.resolve(opts.versionDir), abs).split(path.sep).join('/');
      } catch {
        screenshotPath = null;
      }
    }
  } catch {
    // Closed page or a failed resize: record what is known, never throw.
  } finally {
    if (previous) {
      try {
        await page.setViewportSize(previous);
      } catch {
        // The page may be closed.
      }
    }
  }

  return {
    phone: { widthPx: PHONE.width, screenshotPath, overflow, findingIds: findings.map((f) => f.id) },
    findings,
  };
}
