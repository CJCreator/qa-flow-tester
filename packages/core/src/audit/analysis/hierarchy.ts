import type { HierarchyNode, InternalLinking, NavigationLink, PageContent, PageHierarchy } from '@qa/types';
import { redactUrl } from '../../redact.js';
import { isSameSite } from '../../same-site.js';
import type { RawMenuItem, RawPage } from './raw-page.js';

/**
 * The page hierarchy, the navigation map and the internal-linking figures (REQ-007, REQ-015).
 * Fixed rules, no AI, no request. Pure and deterministic.
 *
 * PageHierarchy.links contains each internal link once per page and region, at most
 * MAX_NAV_LINKS_PER_PAGE per page.
 *
 * Placement (Q-23), strongest rule first:
 * 1. the start page is the root ('start');
 * 2. menu nesting from the start page's menu tree ('menu'): a page's parent is the nearest menu item above
 *    it that links to a recorded page, or the root for a top-level item;
 * 3. breadcrumbs ('breadcrumb'): the parent is the last breadcrumb link before the current page;
 * 4. the URL path ('path'): the nearest recorded ancestor path, else the root.
 * A candidate parent that is not a recorded page, is the page itself, or would make the page its own
 * ancestor falls through to the next rule. Each rule is applied to every page before the next rule runs,
 * so menu placements always win over breadcrumb placements.
 */

/** Most navigation links kept per page in the hierarchy. */
export const MAX_NAV_LINKS_PER_PAGE = 200;

export interface HierarchyPage {
  urlPath: string;
  title: string | null;
  raw: RawPage;
  content: PageContent;
}

type Placement = Exclude<HierarchyNode['placedBy'], 'start'>;

export function buildPageHierarchy(pages: HierarchyPage[], startPath: string): PageHierarchy {
  // One entry per recorded path; the first occurrence wins.
  const unique: HierarchyPage[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.urlPath)) continue;
    seen.add(page.urlPath);
    unique.push(page);
  }
  const lookup = recordedLookup(unique.map((p) => p.urlPath));
  const startPage = unique.find((p) => p.urlPath === startPath);
  const rootPath = startPage?.urlPath ?? startPath;
  const others = unique.filter((p) => p.urlPath !== rootPath);

  const parentOf = new Map<string, { parent: string; placedBy: Placement }>();

  /** True when `candidate` is a usable parent for `child`: recorded, not itself, no cycle. */
  const canPlace = (child: string, candidate: string | null): candidate is string => {
    if (candidate === null || candidate === child) return false;
    if (candidate !== rootPath && !seen.has(candidate)) return false;
    let at: string | undefined = candidate;
    while (at !== undefined && at !== rootPath) {
      if (at === child) return false;
      at = parentOf.get(at)?.parent;
    }
    return true;
  };

  // 2. Menu nesting from the start page's menu tree.
  const menuParents = startPage ? menuParentCandidates(startPage.raw, lookup, rootPath) : new Map<string, string>();
  for (const page of others) {
    const candidate = menuParents.get(page.urlPath) ?? null;
    if (canPlace(page.urlPath, candidate)) parentOf.set(page.urlPath, { parent: candidate, placedBy: 'menu' });
  }

  // 3. Breadcrumbs.
  for (const page of others) {
    if (parentOf.has(page.urlPath)) continue;
    const candidate = breadcrumbParent(page, lookup);
    if (canPlace(page.urlPath, candidate)) parentOf.set(page.urlPath, { parent: candidate, placedBy: 'breadcrumb' });
  }

  // 4. URL path: nearest recorded ancestor, else the root.
  for (const page of others) {
    if (parentOf.has(page.urlPath)) continue;
    let parent = rootPath;
    for (const ancestor of ancestorPaths(page.urlPath)) {
      const recorded = lookup(ancestor);
      if (canPlace(page.urlPath, recorded)) {
        parent = recorded;
        break;
      }
    }
    parentOf.set(page.urlPath, { parent, placedBy: 'path' });
  }

  const nodes = new Map<string, HierarchyNode>();
  const root: HierarchyNode = { urlPath: rootPath, title: startPage?.title ?? null, placedBy: 'start', children: [] };
  nodes.set(rootPath, root);
  for (const page of others) {
    nodes.set(page.urlPath, {
      urlPath: page.urlPath,
      title: page.title,
      placedBy: parentOf.get(page.urlPath)!.placedBy,
      children: [],
    });
  }
  for (const page of others) {
    nodes.get(parentOf.get(page.urlPath)!.parent)!.children.push(nodes.get(page.urlPath)!);
  }
  for (const node of nodes.values()) node.children.sort((a, b) => compare(a.urlPath, b.urlPath));

  const links: NavigationLink[] = [];
  for (const page of unique) {
    const seenOnPage = new Set<string>();
    let countOnPage = 0;
    for (const link of page.content.links) {
      if (link.leavesSite) continue;
      const key = `${link.region}\n${link.to}`;
      if (seenOnPage.has(key)) continue;
      seenOnPage.add(key);
      links.push({ from: page.urlPath, to: link.to, region: link.region, text: link.text });
      countOnPage++;
      if (countOnPage >= MAX_NAV_LINKS_PER_PAGE) break;
    }
  }

  return { root, links };
}

/**
 * Inbound internal links per recorded page (links from other recorded pages; a page's links to itself do
 * not count) and the recorded pages, other than the start page, that no other recorded page links to.
 */
export function internalLinking(hierarchy: PageHierarchy, recordedPaths: string[]): InternalLinking {
  const recorded = [...new Set(recordedPaths)];
  const recordedSet = new Set(recorded);
  const lookup = recordedLookup(recorded);
  const inboundCounts: Record<string, number> = {};
  for (const path of recorded) inboundCounts[path] = 0;
  for (const link of hierarchy.links) {
    if (!recordedSet.has(link.from)) continue;
    const target = lookup(link.to);
    if (target === null || target === link.from) continue;
    inboundCounts[target] = (inboundCounts[target] ?? 0) + 1;
  }
  const startPath = hierarchy.root.urlPath;
  const unlinkedPages = recorded.filter((path) => path !== startPath && inboundCounts[path] === 0);
  return { inboundCounts, unlinkedPages };
}

/** Plain code-unit order: the same on every machine and locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Splits a site path into its path and its query ('' when none). */
function splitQuery(path: string): { pathname: string; query: string } {
  const at = path.indexOf('?');
  return at === -1 ? { pathname: path, query: '' } : { pathname: path.slice(0, at), query: path.slice(at) };
}

/** '/services/' and '/services' are the same page for matching; '/' stays '/'. */
function matchKey(path: string): string {
  const { pathname, query } = splitQuery(path);
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return `${trimmed === '' ? '/' : trimmed}${query}`;
}

/** Finds the recorded path a site path refers to (exact first, then ignoring a trailing slash). */
function recordedLookup(paths: string[]): (path: string) => string | null {
  const exact = new Set(paths);
  const byKey = new Map<string, string>();
  for (const path of paths) if (!byKey.has(matchKey(path))) byKey.set(matchKey(path), path);
  return (path) => (exact.has(path) ? path : (byKey.get(matchKey(path)) ?? null));
}

/** An href as written, resolved against the page it is on: a site path on the same host, else null. */
function hrefToSitePath(href: string | null, pageUrl: string): string | null {
  if (href === null) return null;
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  let base: URL;
  let url: URL;
  try {
    base = new URL(pageUrl);
    url = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isSameSite(url.host, base.host)) return null;
  return redactUrl(`${url.pathname}${url.search}`);
}

/**
 * Menu parent candidates: for each recorded page in the start page's menu (first occurrence in page order),
 * the nearest enclosing menu item that links to a recorded page, or the root for a top-level item.
 */
function menuParentCandidates(
  start: RawPage,
  lookup: (path: string) => string | null,
  rootPath: string
): Map<string, string> {
  const parents = new Map<string, string>();
  const walk = (items: RawMenuItem[], parent: string): void => {
    for (const item of items) {
      const sitePath = hrefToSitePath(item.href, start.url);
      const target = sitePath === null ? null : lookup(sitePath);
      if (target !== null && target !== rootPath && !parents.has(target)) parents.set(target, parent);
      walk(item.children, target ?? parent);
    }
  };
  walk(start.menu, rootPath);
  return parents;
}

/**
 * The breadcrumb parent: the last breadcrumb link before the current page. The current page is the first
 * crumb that links to the page itself, else the trail ends at the current page.
 */
function breadcrumbParent(page: HierarchyPage, lookup: (path: string) => string | null): string | null {
  const trail = page.raw.breadcrumb.map((item) => {
    const sitePath = hrefToSitePath(item.href, page.raw.url);
    return sitePath === null ? null : (lookup(sitePath) ?? sitePath);
  });
  const self = trail.findIndex((target) => target === page.urlPath);
  const before = self === -1 ? trail : trail.slice(0, self);
  for (let i = before.length - 1; i >= 0; i--) {
    const target = before[i];
    if (target !== null && target !== undefined) return target;
  }
  return null;
}

/** Ancestor paths of a site path, nearest first: '/a/b/c?x' gives '/a/b', '/a', '/'. */
function ancestorPaths(path: string): string[] {
  const { pathname } = splitQuery(path);
  const segments = pathname.split('/').filter((s) => s !== '');
  const out: string[] = [];
  for (let n = segments.length - 1; n >= 1; n--) out.push(`/${segments.slice(0, n).join('/')}`);
  if (segments.length > 0) out.push('/');
  return out;
}
