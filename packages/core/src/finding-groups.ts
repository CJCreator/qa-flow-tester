import { normalizeRoute, type Finding } from '@qa/types';

/**
 * One problem, one finding: the same finding seen by several test points, widths or roles is
 * merged into the first one, which records how often and where else it was seen.
 */
export function mergeDuplicateFindings(findings: Finding[]): Finding[] {
  const merged = new Map<string, Finding>();
  for (const f of findings) {
    // A failing file (named in the title) is one problem on however many pages load it, and so is
    // one element that appears on every page (a small link in the shared header). Anything about
    // a page as a whole (a dead end, a missing title) is one problem per page.
    const isFailedFile = f.checker === 'bug-detection' && (f.evidence.networkLogs?.length ?? 0) > 0;
    const element = f.where.dataTestId || f.where.cssSelector;
    const where = isFailedFile ? '' : element ? `element:${element}` : `page:${normalizeRoute(f.where.urlPath)}`;
    // A console error's title names the step that caught it; two steps catching one error is still
    // one problem, so the error's own text identifies it.
    const isConsoleError = f.checker === 'bug-detection' && !isFailedFile && (f.evidence.consoleLogs?.length ?? 0) > 0;
    const what = isConsoleError ? `console:${f.expectedVsActual.actual}` : f.title;
    const key = `${f.checker}|${what}|${where}`;
    const first = merged.get(key);
    if (!first) {
      merged.set(key, {
        ...f,
        occurrences: 1,
        seenAt: {
          pages: [normalizeRoute(f.where.urlPath)],
          breakpoints: [f.where.breakpoint],
          roles: [f.where.role],
          testCaseIds: f.testCaseId ? [f.testCaseId] : [],
        },
      });
      continue;
    }
    first.occurrences = (first.occurrences || 1) + 1;
    const seenAt = first.seenAt!;
    const page = normalizeRoute(f.where.urlPath);
    if (!seenAt.pages.includes(page)) seenAt.pages.push(page);
    if (!seenAt.breakpoints.includes(f.where.breakpoint)) seenAt.breakpoints.push(f.where.breakpoint);
    if (!seenAt.roles.includes(f.where.role)) seenAt.roles.push(f.where.role);
    if (f.testCaseId && !seenAt.testCaseIds.includes(f.testCaseId)) seenAt.testCaseIds.push(f.testCaseId);
  }
  // A problem seen only once needs no "seen at" note.
  return [...merged.values()].map((f) => (f.occurrences === 1 ? { ...f, occurrences: undefined, seenAt: undefined } : f));
}
