import { TECHNOLOGIES, type DetectedTechnology, type TechnologyName, type TechnologyResult } from '@qa/types';
import type { RawPage } from './raw-page.js';

/**
 * What the site is built with (REQ-010): a fixed signature table matched against facts already read from
 * the pages (meta generator, script and stylesheet addresses, in-page markers) and response headers.
 * Pure and deterministic: no request of its own, no browser.
 *
 * Evidence uses fixed wording: 'meta generator', 'script from /wp-content/', 'stylesheet from cdn.shopify.com',
 * 'page marker __NEXT_DATA__', 'x-powered-by header', 'site address on blogspot.com'.
 */

/** Response headers: lower-case names (any case is accepted). */
export type ResponseHeaders = Record<string, string>;

type Signature =
  /** The meta generator content matches. */
  | { kind: 'generator'; pattern: RegExp }
  /** A script or stylesheet path contains this text (case-insensitive), e.g. '/wp-content/'. */
  | { kind: 'path'; contains: string }
  /** A script or stylesheet comes from this host or a sub-domain of it. */
  | { kind: 'host'; host: string }
  /** An in-page marker reported by the reader (exact name, case-insensitive). */
  | { kind: 'marker'; marker: string }
  /** A response header is present and, when given, its value matches. */
  | { kind: 'header'; name: string; value?: RegExp }
  /** The page itself is served from this host or a sub-domain of it. */
  | { kind: 'site-host'; host: string };

const gen = (pattern: RegExp): Signature => ({ kind: 'generator', pattern });
const path = (contains: string): Signature => ({ kind: 'path', contains });
const host = (h: string): Signature => ({ kind: 'host', host: h });
const marker = (m: string): Signature => ({ kind: 'marker', marker: m });
const header = (name: string, value?: RegExp): Signature => ({ kind: 'header', name, value });
const siteHost = (h: string): Signature => ({ kind: 'site-host', host: h });

/** One entry per TECHNOLOGIES name: the Record type makes a missing entry a compile error. */
const SIGNATURES: Record<TechnologyName, readonly Signature[]> = {
  WordPress: [gen(/^wordpress\b/i), path('/wp-content/'), path('/wp-includes/'), header('link', /api\.w\.org/i)],
  Wix: [
    gen(/\bwix\.com\b/i),
    host('parastorage.com'),
    host('wixstatic.com'),
    header('x-wix-request-id'),
    siteHost('wixsite.com'),
  ],
  Shopify: [
    gen(/^shopify\b/i),
    host('cdn.shopify.com'),
    header('x-shopid'),
    header('x-shopify-stage'),
    header('powered-by', /shopify/i),
    siteHost('myshopify.com'),
  ],
  Squarespace: [
    gen(/^squarespace\b/i),
    host('static1.squarespace.com'),
    host('assets.squarespace.com'),
    header('server', /squarespace/i),
  ],
  Webflow: [
    gen(/^webflow\b/i),
    marker('data-wf-site'),
    marker('data-wf-page'),
    host('website-files.com'),
    host('uploads-ssl.webflow.com'),
    siteHost('webflow.io'),
  ],
  Joomla: [
    gen(/^joomla!?/i),
    path('/media/jui/'),
    path('/media/system/js/'),
    header('x-content-encoded-by', /joomla/i),
  ],
  Drupal: [
    gen(/^drupal\b/i),
    path('/sites/default/files/'),
    path('/core/misc/drupal'),
    marker('data-drupal-selector'),
    header('x-generator', /drupal/i),
    header('x-drupal-cache'),
    header('x-drupal-dynamic-cache'),
  ],
  'Zoho Sites': [
    gen(/^zoho sites\b/i),
    host('zohositescontent.com'),
    host('sites.zohocdn.com'),
    siteHost('zohosites.com'),
    siteHost('zohosites.in'),
  ],
  'Google Sites': [gen(/^google sites\b/i), path('/_/atari/'), siteHost('sites.google.com')],
  Blogger: [gen(/^blogger\b/i), host('blogger.com'), siteHost('blogspot.com')],
  Dukaan: [gen(/^dukaan\b/i), host('mydukaan.io'), host('dukaan.app'), siteHost('mydukaan.io')],
  'GoDaddy Website Builder': [gen(/go ?daddy website builder/i), host('img1.wsimg.com'), host('img.secureserver.net')],
  React: [
    marker('data-reactroot'),
    marker('_reactRootContainer'),
    marker('__reactContainer'),
    path('/react.production.min.js'),
    path('/react-dom.production.min.js'),
  ],
  'Next.js': [
    gen(/^next\.js\b/i),
    marker('__NEXT_DATA__'),
    marker('next-route-announcer'),
    path('/_next/static/'),
    header('x-powered-by', /next\.js/i),
    header('x-nextjs-cache'),
  ],
  'Vue/Nuxt': [
    gen(/^nuxt\b/i),
    marker('__NUXT__'),
    marker('__NUXT_DATA__'),
    marker('data-v-app'),
    marker('data-server-rendered'),
    path('/_nuxt/'),
    path('/vue.min.js'),
    path('/vue.global.prod.js'),
    header('x-powered-by', /nuxt/i),
  ],
  Angular: [marker('ng-version'), path('/angular.min.js')],
  Gatsby: [gen(/^gatsby\b/i), marker('___gatsby')],
  Hugo: [gen(/^hugo\b/i)],
  Jekyll: [gen(/^jekyll\b/i)],
  Astro: [gen(/^astro\b/i), marker('astro-island'), path('/_astro/')],
  Eleventy: [gen(/^(eleventy|11ty)\b/i)],
};

/** Fixed wording for one signature that matched. */
function evidenceFor(sig: Signature, source: 'script' | 'stylesheet' | null): string {
  switch (sig.kind) {
    case 'generator':
      return 'meta generator';
    case 'path':
      return `${source} from ${sig.contains}`;
    case 'host':
      return `${source} from ${sig.host}`;
    case 'marker':
      return `page marker ${sig.marker}`;
    case 'header':
      return `${sig.name} header`;
    case 'site-host':
      return `site address on ${sig.host}`;
  }
}

function parseUrl(address: string, base: string): URL | null {
  try {
    return new URL(address, base);
  } catch {
    try {
      return new URL(address);
    } catch {
      return null;
    }
  }
}

function onHost(hostname: string, wanted: string): boolean {
  const h = hostname.toLowerCase();
  return h === wanted || h.endsWith(`.${wanted}`);
}

interface AddressFact {
  source: 'script' | 'stylesheet';
  url: URL;
}

interface SiteFacts {
  generators: string[];
  addresses: AddressFact[];
  markers: Set<string>;
  headers: Array<Record<string, string>>;
  siteHosts: string[];
}

function lowerHeaders(headers: ResponseHeaders | undefined): Record<string, string> | null {
  if (!headers) return null;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name.toLowerCase()] = value;
  }
  return out;
}

function collectFacts(pages: RawPage[], headers: ResponseHeaders | undefined): SiteFacts {
  const facts: SiteFacts = { generators: [], addresses: [], markers: new Set(), headers: [], siteHosts: [] };
  const given = lowerHeaders(headers);
  if (given) facts.headers.push(given);
  for (const page of pages) {
    if (page.metaGenerator) facts.generators.push(page.metaGenerator.trim());
    const pageUrl = parseUrl(page.url, page.url);
    if (pageUrl) facts.siteHosts.push(pageUrl.hostname);
    const base = pageUrl?.href ?? 'http://invalid.invalid/';
    for (const [source, list] of [
      ['script', page.scripts],
      ['stylesheet', page.stylesheets],
    ] as const) {
      for (const address of list ?? []) {
        const url = parseUrl(address, base);
        if (url) facts.addresses.push({ source, url });
      }
    }
    for (const m of page.frameworkMarkers ?? []) facts.markers.add(m.toLowerCase());
    const own = lowerHeaders(page.responseHeaders);
    if (own) facts.headers.push(own);
  }
  return facts;
}

/** Every evidence string this signature produces against the facts (0, 1 or 2: script and stylesheet). */
function match(sig: Signature, facts: SiteFacts): string[] {
  switch (sig.kind) {
    case 'generator':
      return facts.generators.some((g) => sig.pattern.test(g)) ? [evidenceFor(sig, null)] : [];
    case 'path':
    case 'host': {
      const out: string[] = [];
      for (const source of ['script', 'stylesheet'] as const) {
        const hit = facts.addresses.some(
          (a) =>
            a.source === source &&
            (sig.kind === 'path'
              ? decodePath(a.url.pathname).toLowerCase().includes(sig.contains.toLowerCase())
              : onHost(a.url.hostname, sig.host))
        );
        if (hit) out.push(evidenceFor(sig, source));
      }
      return out;
    }
    case 'marker':
      return facts.markers.has(sig.marker.toLowerCase()) ? [evidenceFor(sig, null)] : [];
    case 'header':
      return facts.headers.some((h) => {
        const value = h[sig.name];
        return value !== undefined && (!sig.value || sig.value.test(value));
      })
        ? [evidenceFor(sig, null)]
        : [];
    case 'site-host':
      return facts.siteHosts.some((h) => onHost(h, sig.host)) ? [evidenceFor(sig, null)] : [];
  }
}

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Detect the CMS and frameworks from the recorded pages' facts. `headers` are extra response headers
 * (for example the start page's), merged with each page's own `responseHeaders`.
 * Technologies come in TECHNOLOGIES order, each once; evidence in signature-table order, each once.
 */
export function detectTechnology(pages: RawPage[], headers?: ResponseHeaders): TechnologyResult {
  const facts = collectFacts(pages, headers);
  const technologies: DetectedTechnology[] = [];
  for (const tech of TECHNOLOGIES) {
    const evidence: string[] = [];
    for (const sig of SIGNATURES[tech.name]) {
      for (const e of match(sig, facts)) if (!evidence.includes(e)) evidence.push(e);
    }
    if (evidence.length > 0) technologies.push({ name: tech.name, kind: tech.kind, evidence });
  }
  return technologies.length > 0 ? { status: 'identified', technologies } : { status: 'not-identified' };
}
