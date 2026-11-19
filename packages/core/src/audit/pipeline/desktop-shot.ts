import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { BREAKPOINT_VIEWPORTS } from '../../browser.js';
import { pageSlug } from '../store/keys.js';

/**
 * The 1440 px screenshot of a Sample Page (T-431, ADR 0049), taken on the page the lab work already has open:
 * only the viewport is resized (no navigation, so no second request to the site) and put back. It is the
 * "before" of the Improved version's desktop view, next to the phone screenshot. Never throws.
 */

const DESKTOP = BREAKPOINT_VIEWPORTS['1440px'];

/** `desktop/<slug>.png`, next to the `phone/` screenshots of the version folder. */
export function desktopScreenshotFile(urlPath: string): string {
  return `desktop/${pageSlug(urlPath)}.png`;
}

/** The path of the saved screenshot relative to `versionDir`, or null when it could not be taken. */
export async function recordDesktopShot(page: Page, versionDir: string, urlPath: string): Promise<string | null> {
  let previous: { width: number; height: number } | null = null;
  try {
    previous = page.viewportSize();
  } catch {
    previous = null;
  }
  try {
    const root = path.resolve(versionDir);
    const rel = desktopScreenshotFile(urlPath);
    const abs = path.resolve(root, rel);
    if (path.relative(root, abs).startsWith('..')) return null;
    await page.setViewportSize(DESKTOP);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // The top of the page, as a visitor first sees it.
    await page.screenshot({
      path: abs,
      type: 'png',
      clip: { x: 0, y: 0, width: DESKTOP.width, height: DESKTOP.height },
    });
    return rel;
  } catch {
    return null;
  } finally {
    if (previous) await page.setViewportSize(previous).catch(() => undefined);
  }
}
