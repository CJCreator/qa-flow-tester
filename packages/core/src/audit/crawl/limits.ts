/**
 * Website Audit: the include/exclude path filter (REQ-002, Q-11).
 * - Include and exclude paths are prefixes matched on whole path segments: /blog covers /blog and
 *   /blog/x, not /blogger.
 * - Paths are compared decoded and case-preserved. A segment that cannot be decoded is compared as
 *   written; nothing here throws.
 * - An exclude match wins. With include paths set, a path matching none of them is excluded.
 * - The start page is always allowed.
 * Pure: the limits come already validated from `validateAuditStartBody`.
 */
import type { AuditLimits } from '@qa/types';

export type PathLimitVerdict = 'excluded';

/** Decodes one path segment; one that is not a valid escape stays as written. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * A path as decoded segments, trailing empty segments dropped: '/blog/' and '/blog' both give
 * ['', 'blog']; '/' gives ['']. Splitting before decoding keeps an encoded %2F inside its segment.
 */
function pathSegments(path: string): string[] {
  const segments = path.split('/').map(decodeSegment);
  while (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  return segments;
}

/** True when `prefix` covers `path` on whole segments. */
function segmentsStartWith(path: string[], prefix: string[]): boolean {
  if (prefix.length === 1 && prefix[0] === '') return true; // '/' covers every path
  if (prefix.length > path.length) return false;
  return prefix.every((segment, i) => path[i] === segment);
}

function sameSegments(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((segment, i) => b[i] === segment);
}

/**
 * Whether the include/exclude limits keep `pathname` out of the crawl: `'excluded'`, or undefined when
 * the page may be crawled. `startPath` is the path of the address the audit starts from.
 */
export function pathLimitVerdict(
  pathname: string,
  limits: Pick<AuditLimits, 'includePaths' | 'excludePaths'>,
  startPath: string
): PathLimitVerdict | undefined {
  const path = pathSegments(pathname);
  if (sameSegments(path, pathSegments(startPath))) return undefined;
  if (limits.excludePaths.some((prefix) => segmentsStartWith(path, pathSegments(prefix)))) return 'excluded';
  if (
    limits.includePaths.length > 0 &&
    !limits.includePaths.some((prefix) => segmentsStartWith(path, pathSegments(prefix)))
  ) {
    return 'excluded';
  }
  return undefined;
}
