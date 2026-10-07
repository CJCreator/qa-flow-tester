import type { PageInventoryItem, PageLink, PlanOtherHost } from '@qa/types';

/** A link on many pages' headers, menus or footers: the site's shared menu, checked once. */
export interface SharedLink {
  key: string;
  link: PageLink;
  /** Pages it was found on. */
  pages: string[];
  /** Who saw it on any page. */
  seenBy: string[];
}

/** The App Flow: which page links to which, as the crawl found it. */
export interface SiteGraph {
  shared: SharedLink[];
  /** Each page's own links, with the shared ones left out. */
  inPage: Map<string, PageLink[]>;
  /** The link names a person clicks from the start page to reach each page. */
  clickPaths: Map<string, string[]>;
  /** Pages no link on the site leads to. */
  unlinked: string[];
  otherHosts: PlanOtherHost[];
}

/** The path part of a page address: pages are told apart by it. */
export function pathOf(urlPath: string): string {
  try {
    return new URL(urlPath, 'http://x').pathname;
  } catch {
    return urlPath;
  }
}

/** One link, told apart by what it's called and where it goes. */
export function linkKey(link: Pick<PageLink, 'name' | 'to'>): string {
  return `${link.name.trim().toLowerCase()}→${link.to}`;
}

/**
 * Builds the App Flow from the crawled pages. A link is shared when it is on two or more pages and
 * sits in a header, menu or footer, or when it is on at least half the pages (three or more).
 * Click paths follow links breadth-first from the start page, so each is the shortest one.
 */
export function buildSiteGraph(pages: PageInventoryItem[], startPath: string): SiteGraph {
  const onPages = new Map<string, { link: PageLink; pages: string[]; seenBy: Set<string> }>();
  for (const page of pages) {
    for (const link of page.links || []) {
      const key = linkKey(link);
      const entry = onPages.get(key) ?? { link, pages: [], seenBy: new Set<string>() };
      if (!entry.pages.includes(page.urlPath)) entry.pages.push(page.urlPath);
      for (const who of link.seenBy || page.reachedBy || ['visitor']) entry.seenBy.add(who);
      onPages.set(key, entry);
    }
  }

  const half = Math.max(3, Math.ceil(pages.length / 2));
  const shared: SharedLink[] = [];
  const sharedKeys = new Set<string>();
  for (const [key, entry] of onPages) {
    const inMenu = !!entry.link.landmark && entry.pages.length >= 2;
    if (inMenu || entry.pages.length >= half) {
      shared.push({ key, link: entry.link, pages: entry.pages, seenBy: [...entry.seenBy] });
      sharedKeys.add(key);
    }
  }

  const inPage = new Map<string, PageLink[]>();
  for (const page of pages) {
    inPage.set(
      page.urlPath,
      (page.links || []).filter((l) => !sharedKeys.has(linkKey(l)))
    );
  }

  // Shortest click paths from the start page, over every link on the site.
  const byPath = new Map(pages.map((p) => [pathOf(p.urlPath), p]));
  const clickPaths = new Map<string, string[]>();
  const start = byPath.get(pathOf(startPath)) ?? pages[0];
  if (start) {
    clickPaths.set(start.urlPath, []);
    const queue = [start];
    while (queue.length > 0) {
      const page = queue.shift()!;
      const route = clickPaths.get(page.urlPath)!;
      for (const link of page.links || []) {
        if (link.leavesSite) continue;
        const next = byPath.get(pathOf(link.to));
        if (!next || clickPaths.has(next.urlPath)) continue;
        clickPaths.set(next.urlPath, [...route, link.name]);
        queue.push(next);
      }
    }
  }

  const linkedTo = new Set(pages.flatMap((p) => (p.links || []).filter((l) => !l.leavesSite).map((l) => pathOf(l.to))));
  const unlinked = pages.filter((p) => p !== start && !linkedTo.has(pathOf(p.urlPath))).map((p) => p.urlPath);

  const hosts = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const link of page.links || []) {
      if (!link.leavesSite) continue;
      try {
        const host = new URL(link.to).host;
        hosts.set(host, (hosts.get(host) ?? new Set()).add(link.to));
      } catch {
        // not an address
      }
    }
  }
  const otherHosts = [...hosts]
    .map(([host, targets]) => ({ host, links: targets.size }))
    .sort((a, b) => b.links - a.links);

  return { shared, inPage, clickPaths, unlinked, otherHosts };
}
