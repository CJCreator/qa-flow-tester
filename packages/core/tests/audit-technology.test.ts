import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TECHNOLOGIES, type TechnologyName } from '@qa/types';
import { detectTechnology, type ResponseHeaders } from '../src/audit/analysis/technology.js';
import type { RawPage } from '../src/audit/analysis/raw-page.js';

const ORIGIN = 'https://shop.example';

function rawPage(overrides: Partial<RawPage> = {}): RawPage {
  return {
    url: `${ORIGIN}/`,
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

interface Case {
  name: TechnologyName;
  page: Partial<RawPage>;
  headers?: ResponseHeaders;
  evidence: string;
}

/** At least one signature per TECHNOLOGIES entry, each on an otherwise empty page. */
const CASES: Case[] = [
  { name: 'WordPress', page: { scripts: ['/wp-includes/js/jquery.js'] }, evidence: 'script from /wp-includes/' },
  { name: 'Wix', page: { metaGenerator: 'Wix.com Website Builder' }, evidence: 'meta generator' },
  { name: 'Wix', page: {}, headers: { 'x-wix-request-id': '1' }, evidence: 'x-wix-request-id header' },
  {
    name: 'Shopify',
    page: { stylesheets: ['https://cdn.shopify.com/s/files/1/theme.css'] },
    evidence: 'stylesheet from cdn.shopify.com',
  },
  { name: 'Shopify', page: {}, headers: { 'powered-by': 'Shopify' }, evidence: 'powered-by header' },
  {
    name: 'Squarespace',
    page: { scripts: ['https://static1.squarespace.com/static/ta/main.js'] },
    evidence: 'script from static1.squarespace.com',
  },
  { name: 'Squarespace', page: {}, headers: { server: 'Squarespace' }, evidence: 'server header' },
  { name: 'Webflow', page: { frameworkMarkers: ['data-wf-site'] }, evidence: 'page marker data-wf-site' },
  { name: 'Webflow', page: { metaGenerator: 'Webflow' }, evidence: 'meta generator' },
  {
    name: 'Joomla',
    page: { metaGenerator: 'Joomla! - Open Source Content Management' },
    evidence: 'meta generator',
  },
  { name: 'Joomla', page: { scripts: ['/media/system/js/core.js'] }, evidence: 'script from /media/system/js/' },
  { name: 'Drupal', page: { metaGenerator: 'Drupal 10 (https://www.drupal.org)' }, evidence: 'meta generator' },
  { name: 'Drupal', page: {}, headers: { 'x-generator': 'Drupal 10' }, evidence: 'x-generator header' },
  { name: 'Zoho Sites', page: { metaGenerator: 'Zoho Sites' }, evidence: 'meta generator' },
  {
    name: 'Zoho Sites',
    page: { url: 'https://bakery.zohosites.in/' },
    evidence: 'site address on zohosites.in',
  },
  {
    name: 'Google Sites',
    page: { url: 'https://sites.google.com/view/bakery' },
    evidence: 'site address on sites.google.com',
  },
  {
    name: 'Google Sites',
    page: { scripts: ['https://www.gstatic.com/_/atari/_/js/k=atari.vw.en.abc/m=view'] },
    evidence: 'script from /_/atari/',
  },
  { name: 'Blogger', page: { metaGenerator: 'blogger' }, evidence: 'meta generator' },
  { name: 'Blogger', page: { url: 'https://bakery.blogspot.com/' }, evidence: 'site address on blogspot.com' },
  {
    name: 'Dukaan',
    page: { scripts: ['https://web.mydukaan.io/static/app.js'] },
    evidence: 'script from mydukaan.io',
  },
  {
    name: 'GoDaddy Website Builder',
    page: { metaGenerator: 'Starfield Technologies; Go Daddy Website Builder 8.0.0000' },
    evidence: 'meta generator',
  },
  {
    name: 'GoDaddy Website Builder',
    page: { scripts: ['//img1.wsimg.com/blobby/go/app.js'] },
    evidence: 'script from img1.wsimg.com',
  },
  { name: 'React', page: { frameworkMarkers: ['data-reactroot'] }, evidence: 'page marker data-reactroot' },
  { name: 'Next.js', page: { frameworkMarkers: ['__NEXT_DATA__'] }, evidence: 'page marker __NEXT_DATA__' },
  { name: 'Next.js', page: { scripts: ['/_next/static/chunks/main.js'] }, evidence: 'script from /_next/static/' },
  { name: 'Next.js', page: {}, headers: { 'x-powered-by': 'Next.js' }, evidence: 'x-powered-by header' },
  { name: 'Vue/Nuxt', page: { frameworkMarkers: ['__NUXT__'] }, evidence: 'page marker __NUXT__' },
  { name: 'Vue/Nuxt', page: { scripts: ['/_nuxt/entry.js'] }, evidence: 'script from /_nuxt/' },
  { name: 'Angular', page: { frameworkMarkers: ['ng-version'] }, evidence: 'page marker ng-version' },
  { name: 'Gatsby', page: { metaGenerator: 'Gatsby 5.13.0' }, evidence: 'meta generator' },
  { name: 'Hugo', page: { metaGenerator: 'Hugo 0.125.4' }, evidence: 'meta generator' },
  { name: 'Jekyll', page: { metaGenerator: 'Jekyll v4.3.3' }, evidence: 'meta generator' },
  { name: 'Astro', page: { frameworkMarkers: ['astro-island'] }, evidence: 'page marker astro-island' },
  { name: 'Astro', page: { metaGenerator: 'Astro v4.5.0' }, evidence: 'meta generator' },
  { name: 'Eleventy', page: { metaGenerator: 'Eleventy v2.0.1' }, evidence: 'meta generator' },
];

describe('detectTechnology', () => {
  it('technology: every one of the TECHNOLOGIES has at least one tested signature', () => {
    const tested = new Set(CASES.map((c) => c.name));
    for (const tech of TECHNOLOGIES) expect(tested, tech.name).toContain(tech.name);
  });

  it.each(CASES.map((c) => [`${c.name} by ${c.evidence}`, c] as const))('technology: identifies %s', (_label, c) => {
    const result = detectTechnology([rawPage(c.page)], c.headers);
    const kind = TECHNOLOGIES.find((t) => t.name === c.name)!.kind;
    expect(result).toEqual({
      status: 'identified',
      technologies: [{ name: c.name, kind, evidence: [c.evidence] }],
    });
  });

  it('technology: no known signature gives not-identified, never an empty identified list', () => {
    expect(detectTechnology([])).toEqual({ status: 'not-identified' });
    const plain = rawPage({
      metaGenerator: 'Notepad',
      scripts: ['/js/app.js', 'https://cdn.example/lib.js', 'not a url ::'],
      stylesheets: ['/css/site.css'],
      frameworkMarkers: ['data-something'],
      responseHeaders: { server: 'nginx', 'x-powered-by': 'Express' },
    });
    expect(detectTechnology([plain], { server: 'Apache' })).toEqual({ status: 'not-identified' });
  });

  it('technology: a CMS-like framework and its base framework are both listed, each once', () => {
    const pages = [
      rawPage({ metaGenerator: 'Gatsby 5.13.0', frameworkMarkers: ['___gatsby', 'data-reactroot'] }),
      rawPage({ url: `${ORIGIN}/about`, metaGenerator: 'Gatsby 5.13.0', frameworkMarkers: ['___gatsby'] }),
    ];
    const result = detectTechnology(pages);
    expect(result).toEqual({
      status: 'identified',
      technologies: [
        { name: 'React', kind: 'framework', evidence: ['page marker data-reactroot'] },
        { name: 'Gatsby', kind: 'framework', evidence: ['meta generator', 'page marker ___gatsby'] },
      ],
    });
  });

  it('technology: a CMS and a framework on the same site are both listed in TECHNOLOGIES order', () => {
    const page = rawPage({
      stylesheets: ['/wp-content/themes/x/style.css'],
      scripts: ['/wp-content/plugins/app/react.production.min.js'],
      responseHeaders: { link: '<https://shop.example/wp-json/>; rel="https://api.w.org/"' },
    });
    const result = detectTechnology([page]);
    expect(result).toEqual({
      status: 'identified',
      technologies: [
        {
          name: 'WordPress',
          kind: 'cms',
          evidence: ['script from /wp-content/', 'stylesheet from /wp-content/', 'link header'],
        },
        { name: 'React', kind: 'framework', evidence: ['script from /react.production.min.js'] },
      ],
    });
  });

  it('technology: header names in any case and page headers merged with the given headers', () => {
    const result = detectTechnology([rawPage({ responseHeaders: { 'X-Drupal-Cache': 'HIT' } })], {
      'X-Powered-By': 'Next.js 14',
    });
    expect(result).toEqual({
      status: 'identified',
      technologies: [
        { name: 'Drupal', kind: 'cms', evidence: ['x-drupal-cache header'] },
        { name: 'Next.js', kind: 'framework', evidence: ['x-powered-by header'] },
      ],
    });
  });

  it('technology: host signatures match the host only, not a look-alike or the path', () => {
    const result = detectTechnology([
      rawPage({
        scripts: ['https://notcdn.shopify.com.evil.example/app.js', 'https://cdn.example/cdn.shopify.com/x.js'],
        url: 'https://blogspot.com.example/',
      }),
    ]);
    expect(result).toEqual({ status: 'not-identified' });
  });

  it('technology: pure, imports no browser or network module', () => {
    const source = readFileSync(new URL('../src/audit/analysis/technology.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./raw-page.js', '@qa/types']);
    expect(source).not.toMatch(/\bfetch\(|playwright/i);
  });

  it('technology: deterministic for the same facts', () => {
    const pages = [rawPage({ metaGenerator: 'WordPress 6.6.2', frameworkMarkers: ['__NEXT_DATA__'] })];
    expect(detectTechnology(pages)).toEqual(detectTechnology(pages));
  });
});
