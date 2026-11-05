/**
 * Site-caused Skipped Pages become findings (T-84, ADR 0018, ADR 0042).
 *
 * A Skipped Page that failed due to the website (HTTP 4xx/5xx error, timeout, or failure to load)
 * is recorded as a finding in ADR 0018 wording (facts only, never "secure" or "compliant").
 * Tool-caused skips (page-limit, depth-limit, excluded, robots, sign-in, etc.) remain "not checked"
 * and do not produce findings.
 */
import type { RouteSkipReason, SkippedPageInfo } from '@qa/types';
import type { UnscoredAuditFinding } from '../ai/ranking.js';
import { hasClaimWords } from '../ai/claim-words.js';

export const SITE_CAUSED_SKIP_REASONS: ReadonlySet<RouteSkipReason> = new Set([
  'http-error',
  'timeout',
  'did-not-load',
]);

/**
 * Returns true if the skip reason was caused by the target website rather than crawler limits.
 */
export function isSiteCausedSkip(why: RouteSkipReason): boolean {
  return SITE_CAUSED_SKIP_REASONS.has(why);
}

/**
 * Formats timeout duration from skip detail string (e.g. '30000ms' -> '30s', '10s' -> '10s').
 * Defaults to '30s' if unset or unparseable.
 */
export function formatWaitTime(detail?: string): string {
  if (!detail) return '30s';
  const msMatch = detail.match(/^(\d+)\s*ms$/i);
  if (msMatch) {
    const s = Math.round(Number(msMatch[1]) / 1000);
    return `${s}s`;
  }
  const sMatch = detail.match(/^(\d+)\s*s$/i);
  if (sMatch) {
    return `${sMatch[1]}s`;
  }
  return '30s';
}

/**
 * Creates an unscored audit finding for a site-caused skipped page with ADR 0018 wording.
 */
export function createSkippedPageFinding(
  skip: SkippedPageInfo,
  id: string
): UnscoredAuditFinding {
  let title = 'Page failed to load';
  let detail = `The page at ${skip.urlPath} could not be loaded.`;
  let suggestion = 'Check network connectivity and ensure the web server is answering requests.';

  if (skip.why === 'http-error') {
    title = skip.status ? `Page failed to load: HTTP ${skip.status}` : 'Page failed to load: HTTP error';
    detail = `The page at ${skip.urlPath} answered with HTTP status ${skip.status ?? 'error'}.`;
    suggestion = 'Fix the server error or remove links pointing to this page.';
  } else if (skip.why === 'timeout') {
    const wait = formatWaitTime(skip.detail);
    title = `Page timed out after ${wait}`;
    detail = `The page at ${skip.urlPath} did not finish loading within ${wait}.`;
    suggestion = 'Check page loading performance, database queries, and external resources on this page.';
  }

  return {
    id,
    rule: skip.why,
    group: 'technical',
    area: 'usability',
    title: hasClaimWords(title) ? 'Page problem found' : title,
    detail: hasClaimWords(detail) ? `On ${skip.urlPath}: problem loading page.` : detail,
    suggestion: hasClaimWords(suggestion) ? 'Fix the issue loading this page.' : suggestion,
    urlPath: skip.urlPath,
    sectionId: null,
    source: 'checker',
    severity: 'Major',
    impact: 'high',
    effort: 'medium',
  };
}

/**
 * Creates unscored audit findings for all site-caused skipped pages.
 */
export function createSkippedPageFindings(
  skipped: readonly SkippedPageInfo[],
  ids: { next(): string }
): UnscoredAuditFinding[] {
  const findings: UnscoredAuditFinding[] = [];
  for (const s of skipped) {
    if (isSiteCausedSkip(s.why)) {
      findings.push(createSkippedPageFinding(s, ids.next()));
    }
  }
  return findings;
}
