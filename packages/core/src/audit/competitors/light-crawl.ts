/**
 * Competitors, the light crawl (T-416, ADR 0049). Node only.
 *
 * Each competitor is read at its homepage plus up to 10 key pages from its menu (pricing, services, product,
 * about, contact): GET only, through the pinned outbound path for public addresses (`makeOutboundFetch`,
 * ADR 0031; private addresses are never reached, whatever the runner allows), with the audit's pacer gap and
 * robots.txt rules (ADR 0015). No form is sent, no sign-in, no script runs: the page's HTML is read as text.
 * A site that cannot be read is "not read" with a reason.
 */
import {
  COMPETITOR_MAX_PAGES,
  type CompetitorContactOption,
  type CompetitorPageFacts,
  type CompetitorPageType,
  type CompetitorSite,
} from '@qa/types';
import { makeOutboundFetch, type OutboundFetchFn } from '../../safe-net.js';
import { RobotsPolicy, ROBOTS_USER_AGENT_TOKEN } from '../../competitive/robots.js';
import { HostPacer } from '../../host-pacer.js';
import { AUDIT_MIN_GAP_MS, AUDIT_PAGE_TIMEOUT_MS } from '../crawl/crawl.js';

/** A competitor page body larger than this is cut: the facts sit near the top. */
export const COMPETITOR_PAGE_MAX_BYTES = 2_000_000;

export const NOT_READ = {
  robots: 'Its robots.txt asks crawlers not to read the homepage.',
  unreachable: 'The site could not be reached.',
  status: 'The homepage did not answer with a page.',
  noPages: 'No pages were left within the page limit.',
} as const;

/** The page types a menu link is picked for, in the order they are picked. */
const TYPE_PATTERNS: ReadonlyArray<[Exclude<CompetitorPageType, 'home' | 'other'>, RegExp]> = [
  ['pricing', /\b(pricing|prices?|plans?|packages?|tariffs?|fees|rates)\b/i],
  ['services', /\b(services?|solutions?|what-we-do|treatments?|offerings?)\b/i],
  ['product', /\b(products?|shop|store|catalog(ue)?|collections?|features?)\b/i],
  ['about', /\b(about(-us)?|who-we-are|our-story|company|team)\b/i],
  ['contact', /\b(contact(-us)?|get-in-touch|reach-us|locations?|enquiry|enquire)\b/i],
];

/** The page type of a path (and its link text, when known). '/' is the homepage. */
export function pageTypeOf(urlPath: string, text = ''): CompetitorPageType {
  const path = urlPath.split(/[?#]/)[0] || '/';
  if (path === '/' || /^\/(index\.(html?|php))?$/i.test(path)) return 'home';
  const words = `${path.replace(/[/_.]/g, ' ')} ${text}`;
  for (const [type, pattern] of TYPE_PATTERNS) if (pattern.test(words)) return type;
  return 'other';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
      if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)) || 32);
      return ENTITIES[lower] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inner text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
function textOf(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ' '));
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? decode(match[2] ?? match[3] ?? match[4] ?? '') : undefined;
}

/** The HTML without scripts, styles and other parts nobody reads. */
function visibleHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');
}

const CTA_WORDS =
  /\b(get|book|buy|start|call|request|try|sign up|subscribe|order|schedule|enquire|enquiry|quote|download|join|shop|contact|talk|apply|register|demo|consult)\b/i;

const TRUST_SIGNALS: ReadonlyArray<[string, RegExp]> = [
  ['testimonials', /\btestimonials?\b|\bwhat (our )?(clients|customers|patients) say\b/i],
  ['reviews or ratings', /\breviews?\b|\bratings?\b|★|\bstars?\b/i],
  ['client names or logos', /\b(our )?(clients|customers|partners|trusted by)\b/i],
  ['case studies', /\bcase stud(y|ies)\b/i],
  ['awards', /\bawards?\b|\baward-winning\b/i],
  ['years in business', /\b(since (19|20)\d\d|\d+\+? years (of )?(experience|in business))\b/i],
  ['guarantee or refund terms', /\b(guarantee|money-back|refund policy)\b/i],
];

/** The trust signals a page's visible text shows, as fixed labels. */
export function trustSignalsIn(text: string): string[] {
  return TRUST_SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

const CHAT_HOSTS =
  /tawk\.to|intercom|crisp\.chat|zendesk|livechat|freshchat|drift\.com|tidio|wati\.io|zoho\.com\/salesiq/i;

function unique(list: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

/** A link of the page: its target and text. */
export interface PageLinkFact {
  href: string;
  text: string;
}

/** The menu links of a page: anchors in its `<nav>` and `<header>`, or every anchor when it has neither. */
export function menuLinks(html: string): PageLinkFact[] {
  const clean = visibleHtml(html);
  const regions = [...clean.matchAll(/<(nav|header)\b[\s\S]*?<\/\1\s*>/gi)].map((m) => m[0]);
  const source = regions.length > 0 ? regions.join(' ') : clean;
  return [...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].flatMap((m) => {
    const href = attr(m[1], 'href');
    return href ? [{ href, text: textOf(m[2]) }] : [];
  });
}

/** The facts of one page, read from its HTML only. Deterministic. */
export function pageFactsFromHtml(html: string, urlPath: string, speedMs: number | null): CompetitorPageFacts {
  const clean = visibleHtml(html);
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const sections = [...clean.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map((m) => textOf(m[2]));

  const buttons = [...clean.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button\s*>/gi)].map((m) => textOf(m[1]));
  const anchors = [...clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
  const actionLinks = anchors
    .filter((m) => /\b(btn|button|cta)\b/i.test(attr(m[1], 'class') ?? '') || CTA_WORDS.test(textOf(m[2])))
    .map((m) => textOf(m[2]))
    .filter((t) => t.length <= 60);
  const ctas = unique(
    [...buttons, ...actionLinks].filter((t) => t.length > 0 && t.length <= 60),
    10
  );

  const hrefs = anchors.map((m) => attr(m[1], 'href') ?? '');
  const contact = new Set<CompetitorContactOption>();
  if (hrefs.some((h) => /^tel:/i.test(h))) contact.add('phone');
  if (hrefs.some((h) => /^mailto:/i.test(h))) contact.add('email');
  if (hrefs.some((h) => /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(h))) contact.add('whatsapp');
  for (const form of clean.matchAll(/<form\b[\s\S]*?<\/form\s*>/gi)) {
    if (/<textarea\b|type\s*=\s*["']?(email|tel)\b/i.test(form[0])) contact.add('form');
  }
  if (/<address\b/i.test(clean) || /"PostalAddress"/.test(html)) contact.add('address');
  if (CHAT_HOSTS.test(html)) contact.add('chat');

  const trustSignals = trustSignalsIn(textOf(clean));

  return {
    urlPath,
    pageType: pageTypeOf(urlPath),
    title: titleMatch ? textOf(titleMatch[1]) : null,
    sections: unique(sections, 12),
    ctas,
    trustSignals,
    contactOptions: [...contact],
    speedMs,
  };
}

/** The key pages of a site from its homepage menu: same site, one per type first, at most `max`. */
export function keyPages(
  homeHtml: string,
  origin: string,
  max: number
): Array<{ urlPath: string; type: CompetitorPageType }> {
  const base = new URL(origin);
  const twin = base.hostname.startsWith('www.') ? base.hostname.slice(4) : `www.${base.hostname}`;
  const found: Array<{ urlPath: string; type: CompetitorPageType }> = [];
  const seen = new Set<string>(['/']);
  for (const link of menuLinks(homeHtml)) {
    let url: URL;
    try {
      url = new URL(link.href, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.hostname !== base.hostname && url.hostname !== twin) continue;
    const urlPath = url.pathname || '/';
    if (seen.has(urlPath)) continue;
    const type = pageTypeOf(urlPath, link.text);
    if (type === 'other' || type === 'home') continue;
    seen.add(urlPath);
    found.push({ urlPath, type });
  }
  // One page of each type before a second of any, so 10 pages cover as many types as the menu has.
  const order = TYPE_PATTERNS.map(([t]) => t as CompetitorPageType);
  const firsts: typeof found = [];
  const rest: typeof found = [];
  const typesSeen = new Set<CompetitorPageType>();
  for (const page of found) {
    if (typesSeen.has(page.type)) rest.push(page);
    else {
      typesSeen.add(page.type);
      firsts.push(page);
    }
  }
  firsts.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return [...firsts, ...rest].slice(0, Math.max(0, max));
}

export interface LightCrawlOptions {
  /** Pages this site may read, homepage included; at most COMPETITOR_MAX_PAGES. */
  maxPages?: number;
  signal?: AbortSignal;
  /** Test seam: the GET. Default: `makeOutboundFetch`, public addresses only, paced. */
  fetch?: OutboundFetchFn;
  /** Test seam: the pacer. Default: one request at a time, AUDIT_MIN_GAP_MS apart (or the Crawl-delay). */
  minGapMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** The light crawl of one competitor (its homepage address). Never throws for a site problem. */
export async function lightCrawlSite(
  site: { url: string; host: string; reason: string },
  options: LightCrawlOptions = {}
): Promise<CompetitorSite> {
  const maxPages = Math.min(COMPETITOR_MAX_PAGES, Math.max(0, Math.floor(options.maxPages ?? COMPETITOR_MAX_PAGES)));
  const notRead = (reason: string): CompetitorSite => ({
    ...site,
    status: 'not-read',
    notReadReason: reason,
    pages: [],
  });
  if (maxPages === 0) return notRead(NOT_READ.noPages);

  const origin = new URL(site.url).origin;
  const get: OutboundFetchFn =
    options.fetch ??
    makeOutboundFetch({ allowPrivate: false, maxBytes: COMPETITOR_PAGE_MAX_BYTES, timeoutMs: AUDIT_PAGE_TIMEOUT_MS });
  const robots = await RobotsPolicy.fetch(origin, ROBOTS_USER_AGENT_TOKEN, get);
  const pacer = new HostPacer({
    minGapMs: options.minGapMs ?? AUDIT_MIN_GAP_MS,
    crawlDelayMs: robots.crawlDelayMs,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const now = options.now ?? Date.now;
  const host = new URL(origin).host;

  const read = async (urlPath: string): Promise<{ html: string; speedMs: number } | null> => {
    return pacer.run(
      host,
      async () => {
        const started = now();
        const res = await get(new URL(urlPath, origin).toString());
        if (!res || res.status < 200 || res.status >= 300) return null;
        const type = res.headers['content-type'] ?? 'text/html';
        if (!/html/i.test(type)) return null;
        const html = await res.text();
        return { html, speedMs: Math.max(0, Math.round(now() - started)) };
      },
      options.signal
    );
  };

  if (!robots.isAllowed('/')) return notRead(NOT_READ.robots);
  let home: { html: string; speedMs: number } | null;
  try {
    home = await read('/');
  } catch {
    return notRead(NOT_READ.unreachable);
  }
  if (!home) return notRead(NOT_READ.status);

  const pages: CompetitorPageFacts[] = [pageFactsFromHtml(home.html, '/', home.speedMs)];
  const wanted = keyPages(home.html, origin, maxPages - 1).filter((p) => robots.isAllowed(p.urlPath));
  for (const page of wanted) {
    if (options.signal?.aborted) break;
    let got: { html: string; speedMs: number } | null = null;
    try {
      got = await read(page.urlPath);
    } catch {
      got = null;
    }
    if (!got) continue;
    const facts = pageFactsFromHtml(got.html, page.urlPath, got.speedMs);
    pages.push({ ...facts, pageType: page.type });
  }
  return { ...site, status: 'read', pages };
}

/**
 * The light crawl of every kept competitor, one after another. `pageAllowance` is shared: on the hosted copy it
 * is the 200-page cap minus the audit's own recorded pages, so competitor pages count toward the cap.
 */
export async function lightCrawlSites(
  sites: Array<{ url: string; host: string; reason: string }>,
  options: LightCrawlOptions & { pageAllowance?: number } = {}
): Promise<CompetitorSite[]> {
  let left = options.pageAllowance ?? Infinity;
  const out: CompetitorSite[] = [];
  for (const site of sites) {
    const maxPages = Math.min(COMPETITOR_MAX_PAGES, Math.max(0, left));
    const read = await lightCrawlSite(site, { ...options, maxPages });
    left -= read.pages.length;
    out.push(read);
  }
  return out;
}
