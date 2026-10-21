import type { Page } from 'playwright';
import type { Finding, TestPointResult } from '@qa/types';
import { getBrowserPolicy } from '../browser.js';
import { safeGet } from '../safe-net.js';

/**
 * Opens a link's address with one request and fails only when the link is broken: the page is
 * gone (404, 410), the server fails (5xx), or nothing answers. Sites that turn automated requests
 * away (401, 403, 429, 999) can't be judged this way, so they pass.
 */
export async function checkLink(_page: Page, address: string): Promise<void> {
  // Pinned and redirect-checked like every outbound request (ADR 0031). Only a shared machine refuses private addresses.
  const got = await safeGet(address, {
    maxRedirects: 10,
    timeoutMs: 10000,
    allowPrivate: !getBrowserPolicy()?.guard,
  });
  // A body over the size cap still shows the status, which is all this check reads.
  if (!got.ok && got.reason !== 'too-large') throw new Error(`The link doesn’t open: ${address} (${got.reason})`);
  const status = got.status ?? 0;
  if (status === 404 || status === 410 || status >= 500)
    throw new Error(`The link is broken: ${address} answered ${status}`);
}

/** The checks a test point runs, in plain words, and how each went. */
export function checksRun(
  findings: Finding[],
  ran: { spec: boolean; permissions: boolean; design: boolean; ux: boolean; pageLevel: boolean; search: boolean }
): NonNullable<TestPointResult['checks']> {
  const outcome = (checker: Finding['checker']) => {
    const own = findings.filter((f) => f.checker === checker);
    if (own.some((f) => !f.needsConfirmation)) return 'failed' as const;
    return own.length > 0 ? ('could-not-verify' as const) : ('passed' as const);
  };
  const checks: NonNullable<TestPointResult['checks']> = [
    { checker: 'bug-detection', name: 'Works without errors', outcome: outcome('bug-detection') },
  ];
  if (ran.ux)
    checks.push({ checker: 'ux-quality', name: 'Accessible and easy to use', outcome: outcome('ux-quality') });
  if (ran.pageLevel) {
    checks.push(
      { checker: 'security', name: 'Secure connections and headers', outcome: outcome('security') },
      { checker: 'performance', name: 'Fast and mobile-ready', outcome: outcome('performance') }
    );
    if (ran.search) checks.push({ checker: 'seo', name: 'Search and link health', outcome: outcome('seo') });
  }
  if (ran.spec)
    checks.splice(1, 0, {
      checker: 'spec-conformance',
      name: 'Does what was expected',
      outcome: outcome('spec-conformance'),
    });
  if (ran.permissions)
    checks.push({
      checker: 'permission-matrix',
      name: 'Only the right people can see it',
      outcome: outcome('permission-matrix'),
    });
  if (ran.design)
    checks.push({ checker: 'design-standards', name: 'Matches the design', outcome: outcome('design-standards') });
  return checks;
}
