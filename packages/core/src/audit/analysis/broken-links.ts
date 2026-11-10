import type { AuditFinding, AuditLimits, PageContent } from '@qa/types';
import type { FetchFn } from '@qa/checkers';
import type { RobotsPolicy } from '../../competitive/robots.js';
import { REDACTED } from '../../redact.js';
import { IMPACT_EFFORT_BY_RULE } from '../ai/ranking.js';
import { isCheckoutPath } from '../crawl/area-detect.js';
import { pathLimitVerdict } from '../crawl/limits.js';
import type { FindingIdAllocator } from './finding-ids.js';

/**
 * Broken internal links (REQ-014 AC-1). A target's status comes from the crawl when it is known; otherwise
 * one GET through the injected FetchFn, which the caller builds with makeOutboundFetch (ADR 0031): this
 * module has no other way to make a request. Requests go one after another, each target at most once, and
 * stop at `maxRequests`. Skipped Pages (sign-in, payment, robots, excluded, depth-limit...) are never
 * requested and never reported. A target that could not be checked (no answer, over the cap) is not
 * reported: only a status that was seen makes a finding.
 *
 * The crawl's own rules are applied again to every target (REQ-036), because the Skipped Page list is not
 * complete (the Spider stops listing once its time is up): a checkout or payment path is always refused,
 * robots.txt and the include/exclude limits when the caller passes them. A refused target is neither
 * requested nor reported.
 */

/** The include/exclude limits the crawl applied, with the path of the address the audit started from. */
export interface LinkPathLimits extends Pick<AuditLimits, 'includePaths' | 'excludePaths'> {
  /** The start address's pathname, as the crawl took it (`new URL(request.url).pathname`). */
  startPath: string;
}

export interface CheckLinksOptions {
  /** The audited site's origin ('https://example.com'): requested targets are its paths, nothing else. */
  origin: string;
  /** Main-frame status per page path, from the crawl. */
  statusByPath: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /** Paths of Skipped Pages that must not be requested. They win over a crawl status. */
  skippedPaths: Iterable<string>;
  /** The outbound fetch (makeOutboundFetch). Null from it means "could not check", never "broken". */
  fetch: FetchFn;
  /** Requests at most; targets past it are left unchecked. */
  maxRequests: number;
  /**
   * The robots.txt policy the crawl followed. A target it disallows is never requested or reported.
   * Omitted: robots.txt is not applied here (checkout and payment paths are still refused).
   */
  robots?: Pick<RobotsPolicy, 'isAllowed'>;
  /** The include/exclude limits the crawl applied. A target outside them is never requested or reported. */
  pathLimits?: LinkPathLimits;
}

/** A status that means the target is gone or failing (the orchestrator's link rule). */
export function isBrokenStatus(status: number): boolean {
  return status === 404 || status === 410 || (status >= 500 && status <= 599);
}

/** A query value hidden by redaction: requesting it would ask for a different page. */
const REDACTED_QUERY_VALUE = new RegExp(`[?&][^=&#]*=${REDACTED.replace(/[*]/g, '\\*')}(?=&|$)`);

function knownStatus(statusByPath: CheckLinksOptions['statusByPath'], path: string): number | undefined {
  if (statusByPath instanceof Map) return statusByPath.get(path);
  const record = statusByPath as Readonly<Record<string, number>>;
  return Object.prototype.hasOwnProperty.call(record, path) ? record[path] : undefined;
}

/** The address to request for a site path, or null when it would not stay on the audited origin. */
function targetUrl(site: URL | null, path: string): string | null {
  if (!site || !path.startsWith('/') || REDACTED_QUERY_VALUE.test(path)) return null;
  let url: URL;
  try {
    // Joined as text, never resolved: a path such as "//other.host/x" must stay on this origin.
    url = new URL(`${site.origin}${path}`);
  } catch {
    return null;
  }
  return url.origin === site.origin ? url.href : null;
}

/**
 * The key a path is matched against Skipped Pages with. A Skipped Page covers every address the server
 * would treat as the same page: query and fragment dropped, dot segments resolved the way the request URL
 * resolves them, percent-escapes decoded, trailing slashes and letter case ignored. Erring towards
 * "skipped" only leaves a link unchecked; erring the other way sends a request into a payment or sign-in area.
 */
export function skipKey(path: string): string {
  let pathname = path.replace(/[?#].*$/s, '');
  if (pathname.startsWith('/')) {
    try {
      // Joined as text like targetUrl, so the key is the pathname that would actually be requested.
      pathname = new URL(`http://skip.invalid${pathname}`).pathname;
    } catch {
      // Keep the raw pathname.
    }
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed escape: keep it as written.
  }
  return pathname.replace(/\/+$/, '').toLowerCase() || '/';
}

/**
 * Whether the crawl's rules refuse a target, judged on the pathname and query that would be requested
 * (joined as text like targetUrl): a checkout or payment path always, then the include/exclude limits and
 * robots.txt when given, as the Spider asks them before it queues an address.
 */
function refusedByCrawlRules(path: string, opts: Pick<CheckLinksOptions, 'robots' | 'pathLimits'>): boolean {
  let pathname = path.replace(/[?#].*$/s, '');
  let search = '';
  if (path.startsWith('/')) {
    try {
      const url = new URL(`http://rules.invalid${path}`);
      pathname = url.pathname;
      search = url.search;
    } catch {
      // Keep the raw pathname: such a target is never requested anyway.
    }
  }
  if (isCheckoutPath(pathname)) return true;
  const limits = opts.pathLimits;
  if (limits && pathLimitVerdict(pathname, limits, limits.startPath)) return true;
  return opts.robots ? !opts.robots.isAllowed(pathname + search) : false;
}

function parseOrigin(origin: string): URL | null {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

interface Target {
  to: string;
  /** Pages linking to it, in page order, each once. */
  pages: string[];
  /** The link's Section on the first page. */
  sectionId: string | null;
}

export async function checkLinks(
  pages: readonly PageContent[],
  opts: CheckLinksOptions,
  ids: FindingIdAllocator
): Promise<AuditFinding[]> {
  const skipped = new Set([...opts.skippedPaths].map(skipKey));
  const recorded = new Set(pages.map((p) => p.urlPath));
  const site = parseOrigin(opts.origin);
  const maxRequests = Number.isFinite(opts.maxRequests) ? Math.max(0, Math.floor(opts.maxRequests)) : 0;

  // Internal link targets in page order, each once, with every page linking to it.
  const targets = new Map<string, Target>();
  const seenPages = new Map<string, Set<string>>();
  const refused = new Set<string>();
  for (const page of pages) {
    for (const link of page.links) {
      // A Skipped Page covers its query variants ('/checkout?item=x'), so match on the pathname.
      if (link.leavesSite || skipped.has(skipKey(link.to))) continue;
      const target = targets.get(link.to);
      if (!target) {
        // The crawl's rules again: a path the Spider would have refused is never requested or reported.
        if (refused.has(link.to)) continue;
        if (refusedByCrawlRules(link.to, opts)) {
          refused.add(link.to);
          continue;
        }
        targets.set(link.to, {
          to: link.to,
          pages: [page.urlPath],
          sectionId: link.sectionId ?? page.sections[0]?.id ?? null,
        });
        seenPages.set(link.to, new Set([page.urlPath]));
      } else {
        const seen = seenPages.get(link.to)!;
        if (!seen.has(page.urlPath)) {
          seen.add(page.urlPath);
          target.pages.push(page.urlPath);
        }
      }
    }
  }

  const findings: AuditFinding[] = [];
  let requests = 0;
  for (const target of targets.values()) {
    let status = knownStatus(opts.statusByPath, target.to);
    // A recorded page loaded in the crawl: no request needed.
    if (status === undefined && recorded.has(target.to)) continue;
    if (status === undefined) {
      if (requests >= maxRequests) continue;
      const url = targetUrl(site, target.to);
      if (!url) continue;
      requests++;
      // One at a time: the next request starts only after this one has settled.
      const response = await opts.fetch(url).catch(() => null);
      if (!response) continue;
      status = response.status;
    }
    if (!isBrokenStatus(status)) continue;

    const { impact, effort } = IMPACT_EFFORT_BY_RULE['broken-link'];
    const where =
      target.pages.length === 1 ? target.pages[0] : `${target.pages.length} pages (${target.pages.join(', ')})`;
    findings.push({
      id: ids.next(),
      rule: 'broken-link',
      group: 'technical',
      area: 'usability',
      title: 'Link leads to a missing or failing page',
      detail: `A link on ${where} goes to ${target.to}, which answered with status ${status}.`,
      suggestion: 'Point the link to a page that exists, or restore the missing page or redirect its address.',
      impact,
      effort,
      urlPath: target.pages[0],
      sectionId: target.sectionId,
      pages: target.pages,
      target: target.to,
      source: 'rule',
    });
  }
  return findings;
}
