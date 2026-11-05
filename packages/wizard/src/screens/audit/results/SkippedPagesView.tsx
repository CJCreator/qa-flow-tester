import type { AuditFinding, PageCoverage, RouteSkipReason } from '@qa/types/src/browser.js';

/** Why a Skipped Page was not recorded, in plain words. Every reason says the page was not checked. */
export const SKIP_REASON_TEXT: Readonly<Record<RouteSkipReason, string>> = {
  'page-limit': 'over the max pages limit',
  'depth-limit': 'more link steps from the start address than the max depth allows',
  excluded: 'left out by the include or exclude paths',
  payment: 'a payment page: nothing on it is clicked or sent',
  'did-not-load': 'it did not load',
  robots: 'robots.txt asks tools not to open it',
  'sign-in': 'it needs a sign-in, and a Website Audit never signs in',
  'http-error': 'the website answered with an error',
  timeout: 'it took too long to load',
  'off-site-redirect': 'it sends visitors to another website',
  'time-limit': 'the time limit was reached',
  'trap-limit': 'stopped to avoid an endless loop of pages',
  'session-lost': 'the visit was cut off part-way',
  duplicate: 'the same page as another one',
};

export const SKIP_REASON_GROUP_LABEL: Readonly<Record<RouteSkipReason, string>> = {
  'http-error': 'Website error (HTTP status)',
  timeout: 'Timed out loading',
  'did-not-load': 'Did not load',
  payment: 'Payment page',
  'sign-in': 'Sign-in required',
  robots: 'Excluded by robots.txt',
  'page-limit': 'Over max pages limit',
  'depth-limit': 'Over max depth limit',
  excluded: 'Excluded by path settings',
  'off-site-redirect': 'Redirects to another site',
  'time-limit': 'Time limit reached',
  'trap-limit': 'Endless loop protection',
  'session-lost': 'Session lost part-way',
  duplicate: 'Duplicate page',
};

export const SITE_CAUSED_SKIP_REASONS: ReadonlySet<RouteSkipReason> = new Set([
  'http-error',
  'timeout',
  'did-not-load',
]);

/** Site-caused skipped pages become findings; tool-caused ones stay not checked (T-88, ADR 0018). */
export function isSiteCaused(why: RouteSkipReason): boolean {
  return SITE_CAUSED_SKIP_REASONS.has(why);
}

export function skipText(why: RouteSkipReason): string {
  return SKIP_REASON_TEXT[why] ?? 'reason not recorded';
}

export function findFindingForPage(urlPath: string, findings?: AuditFinding[]): AuditFinding | undefined {
  if (!findings) return undefined;
  return findings.find((f) => f.urlPath === urlPath || f.pages?.includes(urlPath));
}

export interface SkippedPagesViewProps {
  coverage: PageCoverage;
  findings?: AuditFinding[];
}

/** Lists Skipped Pages grouped by reason, linking site-caused pages to findings (T-88, ADR 0018). */
export function SkippedPagesView({ coverage, findings }: SkippedPagesViewProps) {
  // Group skipped pages while preserving first-seen reason order
  const groupMap = new Map<RouteSkipReason, Array<{ urlPath: string; why: RouteSkipReason }>>();
  for (const page of coverage.skipped) {
    const list = groupMap.get(page.why) ?? [];
    list.push(page);
    groupMap.set(page.why, list);
  }

  return (
    <section aria-labelledby="audit-skipped-title" className="mt-8 space-y-3">
      <h2 id="audit-skipped-title" className="text-xl font-bold">
        Skipped Pages
      </h2>
      <p className="text-sm text-ink-soft">
        {`Pages found: ${coverage.found} · recorded: ${coverage.reached} · skipped: ${coverage.skipped.length}`}
      </p>
      {coverage.skipped.length === 0 ? (
        <p className="text-sm text-ink-soft">No pages were skipped.</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            A Skipped Page was found but not recorded, so it was not checked: it is not a clean result.
          </p>
          <div className="space-y-4">
            {[...groupMap.entries()].map(([why, pages]) => (
              <div key={why} data-skip-group={why} className="space-y-1">
                <h3 className="font-bold text-ink">{`${SKIP_REASON_GROUP_LABEL[why] ?? why} (${pages.length})`}</h3>
                <ul className="space-y-1 text-sm">
                  {pages.map((page, i) => {
                    const finding = isSiteCaused(page.why) ? findFindingForPage(page.urlPath, findings) : undefined;
                    return (
                      <li key={`${page.urlPath}-${i}`}>
                        <span className="break-all font-mono">{page.urlPath}</span>
                        {` · Not checked: ${skipText(page.why)}`}
                        {finding && (
                          <>
                            {' · '}
                            <a href={`#${finding.id}`} className="btn-link">
                              {`Finding: ${finding.title}`}
                            </a>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
