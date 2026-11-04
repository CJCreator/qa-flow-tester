import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { MARKETING_SIGNALS } from '@qa/types';
import type { AuditFinding, HierarchyNode } from '@qa/types';
import type { FetchFn, FetchedResponse } from '@qa/checkers';
import * as barrel from '../src/audit/analysis/index.js';
import {
  analyseSite,
  buildPageContent,
  contentProblems,
  createFindingIdAllocator,
  marketingSignals,
  type AnalysisAccessibility,
  type AnalysisInput,
  type AnalysisPage,
  type RawPage,
} from '../src/audit/analysis/index.js';

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

function page(urlPath: string, depth: number, overrides: Partial<RawPage> = {}): AnalysisPage {
  const raw = rawPage(urlPath, overrides);
  return { urlPath, depth, raw, content: buildPageContent(raw, { origin: ORIGIN, maxTextChars: 100_000 }) };
}

const ENGLISH = 'Fresh bread and cakes baked every morning in our small family bakery.';

function sitePages(): AnalysisPage[] {
  return [
    page('/', 0, {
      title: 'Home',
      description: 'A family bakery',
      lang: 'en',
      metaGenerator: 'WordPress 6.4',
      textChunks: [
        { text: 'Bakery', boundary: { kind: 'header' } },
        { text: 'Welcome', boundary: { kind: 'main', heading: 'Welcome' } },
        { text: ENGLISH },
      ],
      headings: [{ level: 1, text: 'Welcome', chunk: 1 }],
      images: [{ src: '/cake.jpg', alt: null, chunk: 2 }],
      anchors: [
        { href: '/about', text: 'About', region: 'menu', chunk: 0 },
        { href: '/blog', text: 'Blog', region: 'menu', chunk: 0 },
        { href: '/gone', text: 'Old offer', region: 'internal', chunk: 2 },
        { href: '/new', text: 'New offer', region: 'internal', chunk: 2 },
        { href: '/login', text: 'Sign in', region: 'internal', chunk: 2 },
      ],
      menu: [
        { text: 'About', href: '/about', children: [] },
        { text: 'Blog', href: '/blog', children: [] },
      ],
    }),
    page('/about', 1, {
      title: 'Home',
      lang: 'en',
      textChunks: [{ text: ENGLISH, boundary: { kind: 'main' } }],
      anchors: [{ href: '/', text: 'Home', region: 'internal', chunk: 0 }],
    }),
    // The same path again: the first copy wins.
    page('/about', 3, { title: 'Second copy' }),
    page('/blog', 1, {
      title: 'Blog',
      description: 'News from the bakery',
      lang: 'en',
      textChunks: [{ text: `${ENGLISH} Our news.`, boundary: { kind: 'main', heading: 'News' } }],
      headings: [
        { level: 1, text: 'News', chunk: 0 },
        { level: 3, text: 'Older', chunk: 0 },
      ],
    }),
  ];
}

function a11yFinding(id: string, rule: string, urlPath: string, target?: string): AuditFinding {
  return {
    id,
    rule,
    group: 'technical',
    area: 'accessibility',
    title: `Automatic check "${rule}" found a problem`,
    detail: `On ${urlPath}: elements break the automatic check "${rule}".`,
    suggestion: 'Fix the elements named in this finding.',
    impact: 'high',
    effort: 'low',
    urlPath,
    sectionId: null,
    source: 'checker',
    severity: 'Major',
    findingId: `F-A11Y-${rule}`,
    ...(target ? { target } : {}),
  };
}

function accessibility(): AnalysisAccessibility[] {
  // Ids from the browser stage's own series: analyseSite gives them their final numbers.
  const findings = [
    a11yFinding('AF-001', 'color-contrast', '/', '.hero'),
    a11yFinding('AF-002', 'color-contrast', '/', '.hero'),
    a11yFinding('AF-003', 'label', '/', '#email'),
  ];
  return [
    {
      urlPath: '/',
      findings,
      basics: {
        standard: 'WCAG 2.2',
        level: 'AA',
        method: 'automatic checks only',
        violations: 3,
        findingIds: ['AF-001', 'AF-002', 'AF-003'],
      },
    },
    {
      urlPath: '/blog',
      findings: [],
      basics: null,
      note: 'The accessibility checks did not run on /blog, so this page has not been checked.',
    },
    { urlPath: '/not-recorded', findings: [a11yFinding('AF-001', 'label', '/not-recorded', '#x')], basics: null },
  ];
}

/** A fake FetchFn: answers from a table (null when absent) and records each call. */
function fakeFetch(statuses: Record<string, number>) {
  const calls: string[] = [];
  const fetch: FetchFn = async (url) => {
    calls.push(url);
    const status = statuses[url];
    if (status === undefined) return null;
    const res: FetchedResponse = { status, headers: {}, text: async () => '' };
    return res;
  };
  return { fetch, calls };
}

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    origin: ORIGIN,
    startPath: '/',
    pages: sitePages(),
    statusByPath: new Map([
      ['/', 200],
      ['/about', 200],
      ['/blog', 200],
      ['/gone', 404],
    ]),
    skippedPaths: ['/login'],
    accessibility: accessibility(),
    fetch: fakeFetch({ [`${ORIGIN}/new`]: 500 }).fetch,
    firstFindingNumber: 10,
    ...overrides,
  };
}

function treePaths(node: HierarchyNode): string[] {
  return [node.urlPath, ...node.children.flatMap(treePaths)];
}

const withoutId = ({ id: _id, ...rest }: AuditFinding) => rest;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analyseSite', () => {
  it('lists every recorded page once, in the page list and in the hierarchy (REQ-007 AC-2)', async () => {
    const result = await analyseSite(input());
    expect(result.pages.map((p) => p.urlPath)).toEqual(['/', '/about', '/blog']);
    expect(treePaths(result.hierarchy.root).sort()).toEqual(['/', '/about', '/blog']);
    const about = result.pages.find((p) => p.urlPath === '/about')!;
    expect(about.depth).toBe(1);
    expect(about.title).toBe('Home');
  });

  it('gives each page its language, Section summaries in page order and SEO basics (REQ-008, REQ-013, REQ-038)', async () => {
    const result = await analyseSite(input());
    const home = result.pages[0];
    expect(home.language).toEqual({ primary: 'en', others: [], declared: 'en' });
    expect(home.sections).toEqual([
      { id: 's1', kind: 'header' },
      { id: 's2', kind: 'main', heading: 'Welcome' },
    ]);
    for (const s of home.sections) expect(Object.keys(s)).not.toContain('start');
    expect(home.seo).toMatchObject({
      hasTitle: true,
      hasDescription: true,
      h1Count: 1,
      imagesWithoutAlt: 1,
      htmlLang: 'en',
    });
    const blog = result.pages[2];
    expect(blog.seo.skippedHeadingLevel).toBe(true);
    expect(result.pages[1].seo).toMatchObject({ hasDescription: false, h1Count: 0 });
  });

  it('always reports technology: identified, or not-identified (REQ-010 AC-2)', async () => {
    const found = await analyseSite(input());
    expect(found.technology.status).toBe('identified');
    if (found.technology.status === 'identified') {
      expect(found.technology.technologies.map((t) => t.name)).toContain('WordPress');
    }
    const plain = await analyseSite(input({ pages: [page('/', 0, { title: 'Home' })], accessibility: [] }));
    expect(plain.technology).toEqual({ status: 'not-identified' });
  });

  it('numbers findings AF-NNN from the given number, without gaps, and hands on the next number', async () => {
    const result = await analyseSite(input());
    const ids = result.findings.map((f) => f.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(ids.map((_, i) => `AF-${String(10 + i).padStart(3, '0')}`));
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.nextFindingNumber).toBe(10 + ids.length);
  });

  it('orders findings: content problems, then broken links, then accessibility', async () => {
    const result = await analyseSite(input());
    const kinds = result.findings.map((f) =>
      f.rule === 'broken-link' ? 'links' : f.source === 'checker' ? 'a11y' : 'content'
    );
    const firstLink = kinds.indexOf('links');
    const firstA11y = kinds.indexOf('a11y');
    expect(firstLink).toBeGreaterThan(0);
    expect(kinds.slice(0, firstLink).every((k) => k === 'content')).toBe(true);
    expect(kinds.slice(firstLink, firstA11y).every((k) => k === 'links')).toBe(true);
    expect(kinds.slice(firstA11y).every((k) => k === 'a11y')).toBe(true);
  });

  it('every findingIds entry (SEO, accessibility, marketing) names an existing finding', async () => {
    const result = await analyseSite(input());
    const known = new Set(result.findings.map((f) => f.id));
    const cited = [
      ...result.pages.flatMap((p) => p.seo.findingIds),
      ...result.pages.flatMap((p) => p.accessibility?.findingIds ?? []),
      ...result.marketing.signals.flatMap((s) => s.findingIds ?? []),
    ];
    expect(cited.length).toBeGreaterThan(0);
    for (const id of cited) expect(known.has(id)).toBe(true);
    // The home page's SEO basics cite its missing-alt and the duplicate title.
    const home = result.pages[0];
    const homeRules = home.seo.findingIds.map((id) => result.findings.find((f) => f.id === id)!.rule).sort();
    expect(homeRules).toEqual(['duplicate-title', 'missing-alt']);
  });

  it('passes content findings through unchanged apart from their ids (REQ-014)', async () => {
    const result = await analyseSite(input());
    const direct = contentProblems(
      sitePages()
        .filter((p, i, all) => all.findIndex((q) => q.urlPath === p.urlPath) === i)
        .map((p) => p.content),
      createFindingIdAllocator()
    );
    const passed = result.findings.filter((f) => f.source === 'rule' && f.rule !== 'broken-link');
    expect(passed.map(withoutId)).toEqual(direct.map(withoutId));
    expect(passed.map((f) => f.rule)).toEqual(
      expect.arrayContaining([
        'missing-alt',
        'missing-description',
        'no-h1',
        'skipped-heading-level',
        'duplicate-title',
      ])
    );
  });

  it('reports broken links from the crawl status and from the injected fetch, never a skipped page', async () => {
    const f = fakeFetch({ [`${ORIGIN}/new`]: 500, [`${ORIGIN}/login`]: 404 });
    const result = await analyseSite(input({ fetch: f.fetch }));
    const broken = result.findings.filter((x) => x.rule === 'broken-link').map((x) => x.target);
    expect(broken).toEqual(['/gone', '/new']);
    expect(f.calls).toEqual([`${ORIGIN}/new`]);
  });

  it('makes no request for, and reports nothing about, a link robots.txt disallows (F-054)', async () => {
    const f = fakeFetch({ [`${ORIGIN}/new`]: 500 });
    const robots = { isAllowed: (p: string) => !p.startsWith('/new') };
    const result = await analyseSite(input({ fetch: f.fetch, robots }));
    expect(f.calls).toEqual([]);
    expect(result.findings.filter((x) => x.rule === 'broken-link').map((x) => x.target)).toEqual(['/gone']);
  });

  it('gives the ten marketing signals, as marketingSignals does over the final findings (REQ-015 AC-1)', async () => {
    const result = await analyseSite(input());
    expect(result.marketing.signals.map((s) => s.key)).toEqual(MARKETING_SIGNALS.map((s) => s.key));
    expect(result.marketing.readPages).toEqual(['/', '/about', '/blog']);
    const direct = marketingSignals({
      pages: result.pages.map((p) => {
        const source = sitePages().find((q) => q.urlPath === p.urlPath)!;
        return { raw: source.raw, content: source.content };
      }),
      internalLinking: result.internalLinking,
      findings: result.findings,
    });
    expect(result.marketing.signals).toEqual(direct);
  });

  it('re-numbers accessibility findings, drops a repeat of the same rule, page and target, and re-points the basics', async () => {
    const result = await analyseSite(input());
    const a11y = result.findings.filter((f) => f.source === 'checker');
    expect(a11y.map((f) => [f.rule, f.urlPath, f.target])).toEqual([
      ['color-contrast', '/', '.hero'],
      ['label', '/', '#email'],
    ]);
    const home = result.pages[0];
    expect(home.accessibility).toEqual({
      standard: 'WCAG 2.2',
      level: 'AA',
      method: 'automatic checks only',
      violations: 2,
      findingIds: a11y.map((f) => f.id),
    });
    // No basics where the checks did not run, and the note says why; unrecorded pages are ignored.
    expect(result.pages[2].accessibility).toBeUndefined();
    expect(result.notes).toEqual(['The accessibility checks did not run on /blog, so this page has not been checked.']);
    expect(result.findings.some((f) => f.urlPath === '/not-recorded')).toBe(false);
  });

  it('never reports the same rule, page and target twice', async () => {
    const result = await analyseSite(input());
    const keys = result.findings.map((f) => `${f.rule}|${f.urlPath}|${f.target ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives the same output for the same input, and makes no request except through the injected fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('global fetch must not be used');
    });
    const dateNow = vi.spyOn(Date, 'now');
    const random = vi.spyOn(Math, 'random');
    const a = await analyseSite(input());
    const b = await analyseSite(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(globalFetch).not.toHaveBeenCalled();
    expect(dateNow).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it('starts at AF-001 with no findings, and rejects an invalid first number before any request', async () => {
    const empty = await analyseSite(input({ pages: [], accessibility: [], firstFindingNumber: 1 }));
    expect(empty.findings).toEqual([]);
    expect(empty.pages).toEqual([]);
    expect(empty.nextFindingNumber).toBe(1);
    expect(empty.technology).toEqual({ status: 'not-identified' });
    expect(empty.marketing.signals).toHaveLength(10);

    const f = fakeFetch({});
    await expect(analyseSite(input({ fetch: f.fetch, firstFindingNumber: 0 }))).rejects.toThrow(RangeError);
    expect(f.calls).toEqual([]);
  });
});

describe('audit/analysis barrel', () => {
  it('exports the public API of every analysis module', () => {
    const fns = [
      'readPage',
      'buildPageContent',
      'detectPageLanguage',
      'detectTechnology',
      'buildPageHierarchy',
      'internalLinking',
      'contentProblems',
      'checkLinks',
      'seoBasics',
      'marketingSignals',
      'auditMarketing',
      'accessibilityBasics',
      'analyseSite',
      'createFindingIdAllocator',
    ] as const;
    for (const name of fns) expect(typeof (barrel as Record<string, unknown>)[name], name).toBe('function');
  });

  it('pulls in no runner or wizard module', () => {
    const start = resolve(dirname(fileURLToPath(import.meta.url)), '../src/audit/analysis/index.ts');
    const visited = new Set<string>();
    const specifiers: string[] = [];
    const walk = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        specifiers.push(spec);
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
        if (existsSync(target)) walk(target);
      }
    };
    walk(start);
    expect(visited.size).toBeGreaterThan(10);
    for (const file of visited) expect(file.replace(/\\/g, '/')).toMatch(/\/packages\/core\/src\//);
    for (const spec of specifiers) expect(spec).not.toMatch(/runner|wizard/i);
  });
});
