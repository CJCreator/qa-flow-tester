import { normalizeRoute, normalizeSelector, SEVERITY_ORDER, type Finding } from '@qa/types';

/** The files a site has once, at its root. A finding about one of them is about the whole site. */
const SITE_ROOT_PATHS = new Set(['/robots.txt', '/sitemap.xml', '/llms.txt']);

/**
 * A finding about the whole site, not one page: a missing favicon, robots.txt, sitemap.xml or llms.txt.
 * Such a finding is one problem per site, however many pages the check saw it on.
 */
export function isSiteScopedFinding(f: Pick<Finding, 'title' | 'where'>): boolean {
  return (
    SITE_ROOT_PATHS.has(normalizeRoute(f.where.urlPath)) ||
    /^Site is missing /.test(f.title) ||
    /^Page is missing a favicon link tag/i.test(f.title)
  );
}

/**
 * One problem, one finding: the same finding seen by several test points, widths or roles is
 * merged into the first one, which records how often and where else it was seen.
 */
export function mergeDuplicateFindings(findings: Finding[]): Finding[] {
  const merged = new Map<string, Finding>();
  for (const f of findings) {
    // A failing file (named in the title) is one problem on however many pages load it, and so is
    // one element that appears on every page (a small link in the shared header). A site-wide
    // finding (no favicon, no robots.txt) is one problem for the site. Anything about a page as a
    // whole (a dead end, a missing title) is one merged finding per page.
    const isFailedFile = f.checker === 'bug-detection' && (f.evidence.networkLogs?.length ?? 0) > 0;
    const isConsoleError = f.checker === 'bug-detection' && !isFailedFile && (f.evidence.consoleLogs?.length ?? 0) > 0;
    const rawElement = f.where.dataTestId || f.where.cssSelector;
    const element = rawElement ? normalizeSelector(rawElement) : undefined;
    const normUrlPath = normalizeRoute(f.where.urlPath);
    const siteScoped = isSiteScopedFinding(f);
    const where = isFailedFile ? '' : siteScoped ? 'site' : element ? `element:${element}` : `page:${normUrlPath}`;
    const what = isConsoleError ? `console:${f.expectedVsActual.actual}` : f.title;
    const key = f.issueKey || `${f.checker}|${what}|${where}`;
    // The problem's key names no page, so the same page-wide problem on N pages is one problem to
    // scoring and to the verdict, with the pages it was seen on (seenAt.pages).
    const problemWhere = where.startsWith('page:') ? '' : where;
    const problemKey = f.issueKey || `${f.checker}|${what}|${problemWhere}`;
    const first = merged.get(key);
    if (!first) {
      merged.set(key, {
        ...f,
        where: {
          ...f.where,
          urlPath: normUrlPath,
        },
        issueKey: problemKey,
        occurrences: 1,
        seenAt: {
          pages: [normUrlPath],
          breakpoints: [f.where.breakpoint],
          roles: [f.where.role],
          testCaseIds: f.testCaseId ? [f.testCaseId] : [],
        },
      });
      continue;
    }
    first.occurrences = (first.occurrences || 1) + 1;
    // The merged finding keeps the highest severity, and is confirmed if any member is.
    if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(first.severity)) first.severity = f.severity;
    if (!f.needsConfirmation) first.needsConfirmation = false;
    const seenAt = first.seenAt!;
    const page = normUrlPath;
    if (!seenAt.pages.includes(page)) seenAt.pages.push(page);
    if (!seenAt.breakpoints.includes(f.where.breakpoint)) seenAt.breakpoints.push(f.where.breakpoint);
    if (!seenAt.roles.includes(f.where.role)) seenAt.roles.push(f.where.role);
    if (f.testCaseId && !seenAt.testCaseIds.includes(f.testCaseId)) seenAt.testCaseIds.push(f.testCaseId);
  }
  // A problem seen only once needs no "seen at" note.
  return [...merged.values()].map((f) =>
    f.occurrences === 1 ? { ...f, occurrences: undefined, seenAt: undefined } : f
  );
}
