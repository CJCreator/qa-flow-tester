import { describe, it, expect } from 'vitest';
import type { HierarchyNode, LinkRegion, PageHierarchy } from '@qa/types';
import { buildPageContent } from '../src/audit/analysis/page-content.js';
import { buildPageHierarchy, internalLinking, type HierarchyPage } from '../src/audit/analysis/hierarchy.js';
import type { RawBreadcrumbItem, RawMenuItem, RawPage } from '../src/audit/analysis/raw-page.js';

const ORIGIN = 'https://bakery.example';

function rawPage(urlPath: string, overrides: Partial<RawPage> = {}): RawPage {
  return {
    url: `${ORIGIN}${urlPath}`,
    title: null,
    description: null,
    lang: null,
    textChunks: [],
    headings: [],
    images: [],
    anchors: [],
    contactLinks: [],
    forms: [],
    ctaCandidates: [],
    metaGenerator: null,
    scripts: [],
    stylesheets: [],
    iframes: [],
    jsonLd: [],
    socialMetaKeys: [],
    frameworkMarkers: [],
    addresses: [],
    menu: [],
    breadcrumb: [],
    ...overrides,
  };
}

function anchor(href: string, text: string, region: LinkRegion = 'internal') {
  return { href, text, region, chunk: -1 };
}

function menuItem(href: string | null, text: string, children: RawMenuItem[] = []): RawMenuItem {
  return { href, text, children };
}

function page(urlPath: string, title: string, overrides: Partial<RawPage> = {}): HierarchyPage {
  const raw = rawPage(urlPath, { title, ...overrides });
  const content = buildPageContent(raw, { origin: ORIGIN, maxTextChars: 100_000 });
  return { urlPath, title, raw, content };
}

/** A small shop's main menu, written inline (no fixture site). */
const MAIN_MENU: RawMenuItem[] = [
  menuItem('/', 'Home'),
  menuItem('/about', 'About us'),
  menuItem('/services', 'Services', [
    menuItem('/services/catering', 'Catering'),
    menuItem('/services/party-orders', 'Party orders'),
  ]),
  menuItem('/gallery', 'Gallery'),
  menuItem('/blog', 'Blog'),
  menuItem('/shop', 'Shop'),
];

const MENU_ANCHORS = MAIN_MENU.flatMap(function flat(item): ReturnType<typeof anchor>[] {
  return [anchor(item.href!, item.text, 'menu'), ...item.children.flatMap(flat)];
});

function crumbs(...items: Array<[string | null, string]>): RawBreadcrumbItem[] {
  return items.map(([href, text]) => ({ href, text }));
}

/** A fixture-shaped crawl: start page with the main menu, a blog trail and a sitemap-only page. */
function fixturePages(): HierarchyPage[] {
  const withMenu = (extra: ReturnType<typeof anchor>[] = []) => [...MENU_ANCHORS, ...extra];
  return [
    page('/', 'Home', {
      menu: MAIN_MENU,
      anchors: withMenu([
        anchor('https://instagram.com/bakery', 'Instagram', 'footer'),
        anchor('/blog/2025/diwali/sweets/kaju-katli', 'Kaju katli recipe'),
        anchor('tel:+914412345678', 'Call us'),
        anchor('#top', 'Back to top', 'footer'),
      ]),
    }),
    page('/about', 'About us', { menu: MAIN_MENU, anchors: withMenu() }),
    page('/services', 'Services', { menu: MAIN_MENU, anchors: withMenu() }),
    page('/services/catering', 'Catering', {
      menu: MAIN_MENU,
      anchors: withMenu(),
      breadcrumb: crumbs(['/', 'Home'], ['/blog', 'Blog'], [null, 'Catering']),
    }),
    page('/services/party-orders', 'Party orders', { menu: MAIN_MENU, anchors: withMenu() }),
    page('/blog', 'Blog', {
      menu: MAIN_MENU,
      anchors: withMenu([anchor('/blog/2025', '2025')]),
      breadcrumb: crumbs(['/', 'Home'], [null, 'Blog']),
    }),
    page('/blog/2025', '2025', {
      menu: MAIN_MENU,
      anchors: withMenu([anchor('/blog/2025/diwali', 'Diwali')]),
      breadcrumb: crumbs(['/', 'Home'], ['/blog', 'Blog'], [null, '2025']),
    }),
    page('/blog/2025/diwali', 'Diwali', {
      menu: MAIN_MENU,
      anchors: withMenu([anchor('/blog/2025/diwali/sweets/kaju-katli', 'Kaju katli')]),
      breadcrumb: crumbs(['/', 'Home'], ['/blog', 'Blog'], ['/blog/2025', '2025'], [null, 'Diwali']),
    }),
    // The breadcrumb trail names /blog/2025/diwali/sweets, which was not recorded: the last link is
    // that page, so the breadcrumb rule falls through to the URL path.
    page('/blog/2025/diwali/sweets/kaju-katli', 'Kaju katli', {
      menu: MAIN_MENU,
      anchors: withMenu(),
      breadcrumb: crumbs(
        ['/', 'Home'],
        ['/blog', 'Blog'],
        ['/blog/2025', '2025'],
        ['/blog/2025/diwali', 'Diwali'],
        ['/blog/2025/diwali/sweets', 'Sweets guide'],
        [null, 'Kaju katli']
      ),
    }),
    page('/seasonal-offers', 'Seasonal offers'),
  ];
}

function walk(
  node: HierarchyNode,
  visit: (n: HierarchyNode, parent: HierarchyNode | null) => void,
  parent: HierarchyNode | null = null
): void {
  visit(node, parent);
  for (const child of node.children) walk(child, visit, node);
}

function placements(hierarchy: PageHierarchy): Map<string, { parent: string | null; placedBy: string }> {
  const out = new Map<string, { parent: string | null; placedBy: string }>();
  walk(hierarchy.root, (n, parent) => out.set(n.urlPath, { parent: parent?.urlPath ?? null, placedBy: n.placedBy }));
  return out;
}

function allPaths(hierarchy: PageHierarchy): string[] {
  const out: string[] = [];
  walk(hierarchy.root, (n) => out.push(n.urlPath));
  return out;
}

describe('buildPageHierarchy', () => {
  it('lists every recorded page exactly once, the start page as the root (REQ-007 AC-2)', () => {
    const pages = fixturePages();
    const hierarchy = buildPageHierarchy(pages, '/');
    expect(hierarchy.root.urlPath).toBe('/');
    expect(hierarchy.root.placedBy).toBe('start');
    expect(hierarchy.root.title).toBe('Home');
    const paths = allPaths(hierarchy);
    expect(paths).toHaveLength(pages.length);
    expect(new Set(paths)).toEqual(new Set(pages.map((p) => p.urlPath)));
  });

  it('places by menu nesting, then breadcrumbs, then the URL path (Q-23)', () => {
    const at = placements(buildPageHierarchy(fixturePages(), '/'));
    expect(at.get('/services/catering')).toEqual({ parent: '/services', placedBy: 'menu' });
    expect(at.get('/services/party-orders')).toEqual({ parent: '/services', placedBy: 'menu' });
    expect(at.get('/services')).toEqual({ parent: '/', placedBy: 'menu' });
    expect(at.get('/blog')).toEqual({ parent: '/', placedBy: 'menu' });
    expect(at.get('/blog/2025')).toEqual({ parent: '/blog', placedBy: 'breadcrumb' });
    expect(at.get('/blog/2025/diwali')).toEqual({ parent: '/blog/2025', placedBy: 'breadcrumb' });
    // Breadcrumb parent not recorded: nearest recorded ancestor path.
    expect(at.get('/blog/2025/diwali/sweets/kaju-katli')).toEqual({ parent: '/blog/2025/diwali', placedBy: 'path' });
    // Reachable by neither menu nor breadcrumb, no recorded ancestor but the root.
    expect(at.get('/seasonal-offers')).toEqual({ parent: '/', placedBy: 'path' });
  });

  it('uses the last breadcrumb link when the current page is itself a link in the trail', () => {
    const pages = [
      page('/', 'Home'),
      page('/news', 'News'),
      page('/news/launch', 'Launch', {
        breadcrumb: crumbs(['/', 'Home'], ['/news', 'News'], ['/news/launch', 'Launch']),
      }),
      page('/deep/post', 'Post', { breadcrumb: crumbs(['/', 'Home'], ['/news', 'News']) }),
    ];
    const at = placements(buildPageHierarchy(pages, '/'));
    expect(at.get('/news/launch')).toEqual({ parent: '/news', placedBy: 'breadcrumb' });
    expect(at.get('/deep/post')).toEqual({ parent: '/news', placedBy: 'breadcrumb' });
  });

  it('falls back to the next rule when menu or breadcrumb data would make a cycle', () => {
    const menu = [menuItem('/a', 'A', [menuItem('/a/b', 'B')])];
    const pages = [
      page('/', 'Home', { menu }),
      page('/a', 'A', { breadcrumb: crumbs(['/a/b', 'B'], [null, 'A']) }),
      page('/a/b', 'B'),
      // Breadcrumbs that point at each other.
      page('/x', 'X', { breadcrumb: crumbs(['/y', 'Y'], [null, 'X']) }),
      page('/y', 'Y', { breadcrumb: crumbs(['/x', 'X'], [null, 'Y']) }),
      // A breadcrumb to itself only.
      page('/z', 'Z', { breadcrumb: crumbs(['/z', 'Z']) }),
    ];
    const hierarchy = buildPageHierarchy(pages, '/');
    const at = placements(hierarchy);
    expect(at.get('/a')).toEqual({ parent: '/', placedBy: 'menu' });
    expect(at.get('/a/b')).toEqual({ parent: '/a', placedBy: 'menu' });
    expect(at.get('/x')).toEqual({ parent: '/y', placedBy: 'breadcrumb' });
    expect(at.get('/y')).toEqual({ parent: '/', placedBy: 'path' });
    expect(at.get('/z')).toEqual({ parent: '/', placedBy: 'path' });
    expect(allPaths(hierarchy)).toHaveLength(pages.length);
  });

  it('a path ancestor that would make a cycle is skipped for the next ancestor or the root', () => {
    // A breadcrumb puts /shop under /shop/cakes; /shop/cakes by path would go under /shop: a cycle.
    const pages = [
      page('/', 'Home'),
      page('/shop', 'Shop', { breadcrumb: crumbs(['/shop/cakes', 'Cakes'], [null, 'Shop']) }),
      page('/shop/cakes', 'Cakes'),
    ];
    const hierarchy = buildPageHierarchy(pages, '/');
    const at = placements(hierarchy);
    expect(at.get('/shop')).toEqual({ parent: '/shop/cakes', placedBy: 'breadcrumb' });
    expect(at.get('/shop/cakes')).toEqual({ parent: '/', placedBy: 'path' });
    expect(allPaths(hierarchy)).toHaveLength(pages.length);

    const pagesB = [
      page('/', 'Home', { menu: [menuItem('/p', 'P', [menuItem('/p/q', 'Q', [menuItem('/p/q/r', 'R')])])] }),
      page('/p/q/r', 'R'),
      page('/p', 'P'),
    ];
    // /p/q is not recorded: /p/q/r sits under /p (nearest recorded menu item above it).
    const atB = placements(buildPageHierarchy(pagesB, '/'));
    expect(atB.get('/p/q/r')).toEqual({ parent: '/p', placedBy: 'menu' });
  });

  it('matches menu and breadcrumb links that differ only by a trailing slash, ignores other hosts', () => {
    const menu = [menuItem('/menu/', 'Menu', [menuItem('https://other.example/menu/cakes', 'Elsewhere')])];
    const pages = [
      page('/', 'Home', { menu }),
      page('/menu', 'Menu'),
      page('/menu/cakes', 'Cakes', { breadcrumb: crumbs(['https://other.example/', 'Other'], [null, 'Cakes']) }),
    ];
    const at = placements(buildPageHierarchy(pages, '/'));
    expect(at.get('/menu')).toEqual({ parent: '/', placedBy: 'menu' });
    expect(at.get('/menu/cakes')).toEqual({ parent: '/menu', placedBy: 'path' });
  });

  it('menu and breadcrumb links to the www twin place the page', () => {
    const menu = [menuItem('https://www.bakery.example/menu', 'Menu')];
    const pages = [
      page('/', 'Home', { menu }),
      page('/menu', 'Menu'),
      page('/menu/cakes', 'Cakes', {
        breadcrumb: crumbs(['https://www.bakery.example/menu', 'Menu'], [null, 'Cakes']),
      }),
    ];
    const at = placements(buildPageHierarchy(pages, '/'));
    expect(at.get('/menu')).toEqual({ parent: '/', placedBy: 'menu' });
    expect(at.get('/menu/cakes')).toEqual({ parent: '/menu', placedBy: 'breadcrumb' });
  });

  it('keeps a duplicate recorded path once and builds a root when the start page is missing', () => {
    const pages = [page('/a', 'A'), page('/a', 'A again')];
    const hierarchy = buildPageHierarchy(pages, '/');
    expect(hierarchy.root).toMatchObject({ urlPath: '/', title: null, placedBy: 'start' });
    expect(allPaths(hierarchy)).toEqual(['/', '/a']);
    expect(hierarchy.root.children[0]!.title).toBe('A');
  });

  it('is deterministic: the same input gives the same tree and child order', () => {
    const first = buildPageHierarchy(fixturePages(), '/');
    const second = buildPageHierarchy(fixturePages(), '/');
    expect(second).toEqual(first);
    expect(first.root.children.map((c) => c.urlPath)).toEqual(['/about', '/blog', '/seasonal-offers', '/services']);
    // Children are sorted, so crawl order does not change the tree.
    const reversed = buildPageHierarchy([...fixturePages()].reverse(), '/');
    expect(reversed.root).toEqual(first.root);
  });
});

describe('navigation map (REQ-007 AC-1)', () => {
  it('lists every internal link of every recorded page with from, to, region and text', () => {
    const pages = fixturePages();
    const { links } = buildPageHierarchy(pages, '/');
    const expected = pages.flatMap((p) =>
      p.content.links
        .filter((l) => !l.leavesSite)
        .map((l) => ({ from: p.urlPath, to: l.to, region: l.region, text: l.text }))
    );
    expect(links).toEqual(expected);
    expect(links).toContainEqual({ from: '/', to: '/services/catering', region: 'menu', text: 'Catering' });
    expect(links).toContainEqual({
      from: '/',
      to: '/blog/2025/diwali/sweets/kaju-katli',
      region: 'internal',
      text: 'Kaju katli recipe',
    });
  });

  it('leaves out links that leave the site and non-page links', () => {
    const { links } = buildPageHierarchy(fixturePages(), '/');
    expect(links.some((l) => l.to.includes('instagram.com'))).toBe(false);
    expect(links.some((l) => l.to.startsWith('tel:') || l.to.startsWith('#'))).toBe(false);
    expect(links.every((l) => l.to.startsWith('/'))).toBe(true);
  });
});

describe('internalLinking (REQ-015)', () => {
  it('counts inbound links from other recorded pages and lists unlinked pages', () => {
    const pages = fixturePages();
    const recorded = pages.map((p) => p.urlPath);
    const result = internalLinking(buildPageHierarchy(pages, '/'), recorded);
    expect(Object.keys(result.inboundCounts).sort()).toEqual([...recorded].sort());
    // Every menu page except /services/catering links to /services/catering: 9 menu pages, minus itself.
    expect(result.inboundCounts['/services/catering']).toBe(8);
    // Linked from the start page and from /blog/2025/diwali.
    expect(result.inboundCounts['/blog/2025/diwali/sweets/kaju-katli']).toBe(2);
    expect(result.inboundCounts['/blog/2025']).toBe(1);
    expect(result.inboundCounts['/seasonal-offers']).toBe(0);
    // The sitemap-only page appears; the start page never does.
    expect(result.unlinkedPages).toEqual(['/seasonal-offers']);
  });

  it('ignores self links and links from unrecorded pages, and lists the start page never', () => {
    const hierarchy: PageHierarchy = {
      root: { urlPath: '/', title: 'Home', placedBy: 'start', children: [] },
      links: [
        { from: '/a', to: '/a', region: 'internal', text: 'Self' },
        { from: '/ghost', to: '/b', region: 'internal', text: 'B' },
        { from: '/a', to: '/b/', region: 'internal', text: 'B with slash' },
        { from: '/b', to: '/missing', region: 'internal', text: 'Missing' },
      ],
    };
    const result = internalLinking(hierarchy, ['/', '/a', '/b']);
    expect(result.inboundCounts).toEqual({ '/': 0, '/a': 0, '/b': 1 });
    expect(result.unlinkedPages).toEqual(['/a']);
  });

  it('a page linked only through the www twin is not unlinked', () => {
    const pages = [
      page('/', 'Home', {
        anchors: [anchor('https://www.bakery.example/about', 'About')],
      }),
      page('/about', 'About'),
    ];
    const paths = pages.map((p) => p.urlPath);
    const result = internalLinking(buildPageHierarchy(pages, '/'), paths);
    expect(result.inboundCounts['/about']).toBe(1);
    expect(result.unlinkedPages).not.toContain('/about');
  });
});
