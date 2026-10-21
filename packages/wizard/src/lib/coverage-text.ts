import type { RouteSkipReason } from '@qa/types/src/browser.js';
import type { ScanProgress } from './scan-progress';

/**
 * Plain-language descriptions for skipped crawl routes.
 * Fixed wording, never page text or user credentials.
 */
export function skipReasonText(reason: RouteSkipReason | string): string {
  switch (reason) {
    case 'sign-in':
      return 'Needs a sign-in';
    case 'robots':
      return 'Blocked by robots.txt';
    case 'did-not-load':
      return 'Did not load';
    case 'http-error':
      return 'The site answered with an error';
    case 'timeout':
      return 'Took too long';
    case 'off-site-redirect':
      return 'Sent to another site';
    case 'time-limit':
    case 'trap-limit':
      return 'Stopped to avoid an endless crawl';
    case 'session-lost':
      return 'Signed-out part-way';
    case 'page-limit':
      return 'Over the page limit';
    case 'duplicate':
      return 'Same page as another';
    default:
      return 'Skipped';
  }
}

/**
 * Notice when headers are needed to continue.
 * Strictly lists header names only; never echoes values or secrets.
 */
export function headersNotice(names: string[]): string {
  if (!names || names.length === 0) return '';
  return `Add your headers again to continue: ${names.join(', ')}`;
}

/**
 * Computes how many seconds the crawl has been stalled without finding new pages.
 * Returns 0 if history is empty or if growth just occurred.
 */
export function stalledForSeconds(history: Array<{ at: number; pagesFound: number }>, now: number): number {
  if (!history || history.length === 0) return 0;
  const latest = history[history.length - 1];
  let lastGrowthAt = latest.at;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].pagesFound === latest.pagesFound) {
      lastGrowthAt = history[i].at;
    } else {
      break;
    }
  }
  return Math.max(0, Math.floor((now - lastGrowthAt) / 1000));
}

/**
 * Accessible live-region status text announcing scan stage changes.
 * Strictly ignores individual URL path transitions to avoid screen-reader noise.
 */
export function statusText(progress: ScanProgress | null): string {
  if (!progress) return 'Opening the site…';
  switch (progress.stage) {
    case 'crawling':
      return 'Exploring the site…';
    case 'narrow-screens':
      return 'Looking at phone and tablet menus…';
    case 'planning':
      if (progress.asking) {
        return progress.what ?? 'Asking AI…';
      }
      return progress.what ?? 'Writing the plan…';
    default:
      return 'Exploring…';
  }
}
