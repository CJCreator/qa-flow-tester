import { MARKETING_SIGNALS } from '@qa/types';
import type {
  AuditFinding,
  AuditMarketing,
  ContentForm,
  InternalLinking,
  MarketingSignal,
  MarketingSignalKey,
  NapDetails,
  PageContent,
} from '@qa/types';
import { isLocalBusinessType, napFromPage } from './nap.js';
import type { RawPage } from './raw-page.js';

/**
 * The ten marketing signals of a Website Audit (REQ-015, FR-15, Q-27), per page and site-wide. Fixed rules
 * over the facts read from each page: no AI, no request, nothing submitted (forms are only read). Pure and
 * deterministic. "Found" says it is there, never that it is good (ADR 0018); details are fixed wording.
 */

export interface MarketingPage {
  raw: RawPage;
  content: PageContent;
}

export interface MarketingSignalsInput {
  pages: MarketingPage[];
  /** From `internalLinking` (BE-304). */
  internalLinking: InternalLinking;
  /** The audit's findings so far; on-page SEO cites the content findings among them. */
  findings: AuditFinding[];
}

/** The content findings on-page SEO cites (title, description and H1 problems). */
export const ON_PAGE_SEO_RULES: ReadonlySet<string> = new Set([
  'missing-title',
  'missing-description',
  'duplicate-title',
  'duplicate-description',
  'no-h1',
  'multiple-h1',
  'skipped-heading-level',
]);

/** Analytics and tag tools recognised from a script or iframe address (host, optionally a path start). */
export const TAG_TOOLS: ReadonlyArray<{ name: string; host: string; path?: RegExp }> = [
  { name: 'Google Tag Manager', host: 'googletagmanager.com', path: /^\/(?:gtm\.js|ns\.html)/ },
  { name: 'Google Analytics', host: 'googletagmanager.com', path: /^\/gtag\/js/ },
  { name: 'Google Analytics', host: 'google-analytics.com' },
  { name: 'Google Ads', host: 'googleadservices.com' },
  { name: 'Google Ads', host: 'googleads.g.doubleclick.net' },
  { name: 'Meta Pixel', host: 'connect.facebook.net' },
  { name: 'Microsoft Clarity', host: 'clarity.ms' },
  { name: 'Hotjar', host: 'hotjar.com' },
  { name: 'LinkedIn Insight Tag', host: 'snap.licdn.com' },
  { name: 'TikTok Pixel', host: 'analytics.tiktok.com' },
  { name: 'Microsoft Advertising', host: 'bat.bing.com' },
  { name: 'HubSpot', host: 'js.hs-scripts.com' },
  { name: 'HubSpot', host: 'js.hs-analytics.net' },
  { name: 'Segment', host: 'cdn.segment.com' },
  { name: 'Mixpanel', host: 'cdn.mxpnl.com' },
  { name: 'Plausible', host: 'plausible.io' },
  { name: 'Zoho PageSense', host: 'cdn.pagesense.io' },
];

/** Map embeds recognised from an iframe or script address. */
const MAP_EMBEDS: ReadonlyArray<{ host: string; path?: RegExp }> = [
  { host: 'google.com', path: /^\/maps/ },
  { host: 'maps.google.com' },
  { host: 'maps.googleapis.com' },
  { host: 'openstreetmap.org' },
  { host: 'bing.com', path: /^\/maps/ },
  { host: 'api.mapbox.com' },
];

/** Review widgets recognised from a script or iframe address. */
const REVIEW_WIDGET_HOSTS = ['trustpilot.com', 'elfsightcdn.com', 'birdeye.com', 'yotpo.com', 'judge.me'];

const REVIEW_TYPES = new Set(['Review', 'AggregateRating', 'Rating']);
const REVIEW_TEXT =
  /\b(?:customer reviews?|reviews from|read (?:our |all |more )?reviews|google reviews?|\d+ reviews|rated \d(?:\.\d)?|\d(?:\.\d)?\s*(?:\/\s*5|out of 5)(?:\s*stars?)?|\d(?:\.\d)?\s*stars?)\b|★/i;
const TESTIMONIAL_TEXT = /\btestimonials?\b|\bwhat (?:our )?(?:customers|clients|patients|students) say\b/i;
const CERTIFICATION_TEXT =
  /\b(?:certifications?|accredited|accreditations?|iso\s?\d{4,5}(?::\d{4})?|award[- ]winning|licen[cs]ed and insured|registered with)\b/i;

/** Most pages named in a detail before "and N more". */
const DETAIL_PAGES_CAP = 5;
/** Most names (JSON-LD types, tools) named in a detail before "and N more". */
const DETAIL_NAMES_CAP = 8;
/** Longest JSON-LD type name shown in a detail. */
const TYPE_NAME_CAP = 60;

export function marketingSignals(input: MarketingSignalsInput): MarketingSignal[] {
  const pages = uniquePages(input.pages ?? []);
  if (pages.length === 0) {
    return MARKETING_SIGNALS.map(({ key, label }) => ({
      key,
      label,
      status: 'not-checked' as const,
      pages: [],
      detail: 'Not checked: no page was read.',
    }));
  }
  const total = pages.length;
  const build: Record<MarketingSignalKey, () => Omit<MarketingSignal, 'key' | 'label'>> = {
    'on-page-seo': () => onPageSeo(pages, input.findings ?? []),
    schema: () => schema(pages),
    'internal-linking': () => internalLinks(pages, input.internalLinking),
    'social-tags': () => socialTags(pages),
    analytics: () => analytics(pages),
    ctas: () => ctas(pages),
    'lead-forms': () => leadForms(pages),
    'click-to-call': () => clickToCall(pages),
    'trust-signals': () => trustSignals(pages),
    'local-signals': () => localSignals(pages),
  };
  return MARKETING_SIGNALS.map(({ key, label }) => {
    const result = build[key]();
    if (result.status === 'not-found' && result.detail === '') result.detail = notFound(label, total);
    return { key, label, ...result };
  });
}

/** The Website Audit's marketing review: the pages read, no Check-up checks, and the ten signals. */
export function auditMarketing(readPages: string[], signals: MarketingSignal[]): AuditMarketing {
  return { readPages: [...readPages], checks: [], signals: [...signals] };
}

/** True when the form asks for a name, email or phone and is neither a sign-in form nor a search form. */
export function isLeadForm(form: Pick<ContentForm, 'fields' | 'action'>): boolean {
  const fields = (form.fields ?? []).filter((f) => !IGNORED_FIELD_TYPES.has(lower(f.type)));
  if (fields.some((f) => lower(f.type) === 'password')) return false;
  if (isSearchForm(form, fields)) return false;
  return fields.some((field) => {
    const type = lower(field.type);
    if (type === 'email' || type === 'tel') return true;
    const words = `${field.name ?? ''} ${field.label ?? ''}`.toLowerCase();
    return LEAD_FIELD_WORDS.test(words);
  });
}

// ---------------------------------------------------------------------------------------------------
// The ten signals
// ---------------------------------------------------------------------------------------------------

type SignalResult = Omit<MarketingSignal, 'key' | 'label'>;

function onPageSeo(pages: MarketingPage[], findings: AuditFinding[]): SignalResult {
  const withTitle = pages.filter((p) => nonEmpty(p.content.title));
  const withDescription = pages.filter((p) => nonEmpty(p.content.description));
  const withH1 = pages.filter((p) => p.content.headings.some((h) => h.level === 1 && nonEmpty(h.text)));
  const found = pathsOf(
    pages.filter((p) => withTitle.includes(p) || withDescription.includes(p) || withH1.includes(p))
  );
  const read = new Set(pathsOf(pages));
  const findingIds = (findings ?? [])
    .filter((f) => ON_PAGE_SEO_RULES.has(f.rule) && [f.urlPath, ...(f.pages ?? [])].some((p) => read.has(p)))
    .map((f) => f.id);
  const total = pages.length;
  const counts =
    `title on ${withTitle.length} of ${total} ${plural(total, 'page')}, ` +
    `meta description on ${withDescription.length}, H1 on ${withH1.length}`;
  const findingNote =
    findingIds.length > 0
      ? `; ${findingIds.length} title, description or heading ${plural(findingIds.length, 'finding')}`
      : '';
  const result: SignalResult =
    found.length > 0
      ? { status: 'found', pages: found, detail: `Found: ${counts}${findingNote}.` }
      : {
          status: 'not-found',
          pages: [],
          detail: `Not found: no title, meta description or H1 on the ${total} ${plural(total, 'page')} read${findingNote}.`,
        };
  if (findingIds.length > 0) result.findingIds = unique(findingIds);
  return result;
}

function schema(pages: MarketingPage[]): SignalResult {
  const types: string[] = [];
  const found: string[] = [];
  for (const page of pages) {
    const pageTypes = page.raw.jsonLd
      .flatMap((block) => block.types ?? [])
      .filter((t) => typeof t === 'string' && t.trim());
    if (pageTypes.length === 0) continue;
    found.push(page.content.urlPath);
    for (const type of pageTypes) {
      const name = clip(type.trim(), TYPE_NAME_CAP);
      if (!types.includes(name)) types.push(name);
    }
  }
  if (found.length === 0) return { status: 'not-found', pages: [], detail: '' };
  return {
    status: 'found',
    pages: found,
    detail: `Found: JSON-LD types ${nameList(types)} on ${pageCount(found)}: ${pageList(found)}.`,
  };
}

function internalLinks(pages: MarketingPage[], linking: InternalLinking): SignalResult {
  const found = pathsOf(pages.filter((p) => p.content.links.some((link) => !link.leavesSite)));
  if (found.length === 0) return { status: 'not-found', pages: [], detail: '' };
  const counts = linking?.inboundCounts ?? {};
  const reached = pathsOf(pages).filter((path) => (counts[path] ?? 0) > 0);
  const unlinked = (linking?.unlinkedPages ?? []).filter((path) => typeof path === 'string');
  const total = pages.length;
  const unlinkedNote =
    unlinked.length > 0
      ? `; no other read page links to ${pageCount(unlinked)}: ${pageList(unlinked)}`
      : '; every read page other than the start page has a link from another read page';
  return {
    status: 'found',
    pages: found,
    detail:
      `Found: internal links on ${found.length} of ${total} ${plural(total, 'page')}; ` +
      `${reached.length} of ${total} ${plural(total, 'page')} reached by a link from another read page${unlinkedNote}.`,
  };
}

function socialTags(pages: MarketingPage[]): SignalResult {
  const og = pathsOf(pages.filter((p) => p.raw.socialMetaKeys.some((k) => lower(k).startsWith('og:'))));
  const twitter = pathsOf(pages.filter((p) => p.raw.socialMetaKeys.some((k) => lower(k).startsWith('twitter:'))));
  const found = inPageOrder(pages, [...og, ...twitter]);
  if (found.length === 0) return { status: 'not-found', pages: [], detail: '' };
  const parts: string[] = [];
  if (og.length > 0) parts.push(`Open Graph (og:) tags on ${pageCount(og)}: ${pageList(og)}`);
  if (twitter.length > 0) parts.push(`Twitter card (twitter:) tags on ${pageCount(twitter)}: ${pageList(twitter)}`);
  return { status: 'found', pages: found, detail: `Found: ${parts.join('; ')}.` };
}

function analytics(pages: MarketingPage[]): SignalResult {
  const tools: string[] = [];
  const found: string[] = [];
  for (const page of pages) {
    const pageTools = new Set<string>();
    for (const address of [...page.raw.scripts, ...page.raw.iframes]) {
      const url = parse(address, page.raw.url);
      if (!url) continue;
      for (const tool of TAG_TOOLS) {
        if (hostMatches(url.hostname, tool.host) && (!tool.path || tool.path.test(url.pathname)))
          pageTools.add(tool.name);
      }
    }
    if (pageTools.size === 0) continue;
    found.push(page.content.urlPath);
    for (const tool of TAG_TOOLS) if (pageTools.has(tool.name) && !tools.includes(tool.name)) tools.push(tool.name);
  }
  if (found.length === 0) {
    return {
      status: 'not-found',
      pages: [],
      detail: `Not found: no script or frame from a known analytics or tag tool on the ${pages.length} ${plural(pages.length, 'page')} read.`,
    };
  }
  return {
    status: 'found',
    pages: found,
    detail: `Found: ${nameList(tools)} on ${pageCount(found)}: ${pageList(found)}.`,
  };
}

function ctas(pages: MarketingPage[]): SignalResult {
  const found = pathsOf(pages.filter((p) => p.content.ctas.length > 0));
  if (found.length === 0) return { status: 'not-found', pages: [], detail: '' };
  const count = pages.reduce((sum, p) => sum + p.content.ctas.length, 0);
  return {
    status: 'found',
    pages: found,
    detail: `Found: ${count} ${plural(count, 'call')} to action (buttons or button-styled links) on ${pageCount(found)}: ${pageList(found)}.`,
  };
}

function leadForms(pages: MarketingPage[]): SignalResult {
  let count = 0;
  const found: string[] = [];
  for (const page of pages) {
    const leads = page.content.forms.filter(isLeadForm).length;
    if (leads === 0) continue;
    count += leads;
    found.push(page.content.urlPath);
  }
  if (found.length === 0) {
    return {
      status: 'not-found',
      pages: [],
      detail: `Not found: no form asking for a name, email or phone (sign-in and search forms left out) on the ${pages.length} ${plural(pages.length, 'page')} read.`,
    };
  }
  return {
    status: 'found',
    pages: found,
    detail: `Found: ${count} ${plural(count, 'form')} asking for a name, email or phone on ${pageCount(found)}: ${pageList(found)}. Forms are read, never sent.`,
  };
}

function clickToCall(pages: MarketingPage[]): SignalResult {
  let count = 0;
  const found: string[] = [];
  for (const page of pages) {
    const links = telLinkCount(page.raw);
    if (links === 0) continue;
    count += links;
    found.push(page.content.urlPath);
  }
  if (found.length === 0) {
    return {
      status: 'not-found',
      pages: [],
      detail: `Not found: no tel: link on the ${pages.length} ${plural(pages.length, 'page')} read.`,
    };
  }
  return {
    status: 'found',
    pages: found,
    detail: `Found: ${count} tel: ${plural(count, 'link')} on ${pageCount(found)}: ${pageList(found)}.`,
  };
}

function trustSignals(pages: MarketingPage[]): SignalResult {
  const reviews: string[] = [];
  const testimonials: string[] = [];
  const certifications: string[] = [];
  for (const page of pages) {
    const text = pageText(page);
    const types = page.raw.jsonLd.flatMap((block) => block.types ?? []);
    const widget = [...page.raw.scripts, ...page.raw.iframes].some((address) => {
      const url = parse(address, page.raw.url);
      return url !== null && REVIEW_WIDGET_HOSTS.some((host) => hostMatches(url.hostname, host));
    });
    if (types.some((t) => REVIEW_TYPES.has(t)) || widget || REVIEW_TEXT.test(text)) reviews.push(page.content.urlPath);
    if (TESTIMONIAL_TEXT.test(text)) testimonials.push(page.content.urlPath);
    if (CERTIFICATION_TEXT.test(text)) certifications.push(page.content.urlPath);
  }
  const found = inPageOrder(pages, [...reviews, ...testimonials, ...certifications]);
  if (found.length === 0) {
    return {
      status: 'not-found',
      pages: [],
      detail: `Not found: no reviews or ratings, testimonials or certifications on the ${pages.length} ${plural(pages.length, 'page')} read.`,
    };
  }
  const parts: string[] = [];
  if (reviews.length > 0) parts.push(`reviews or ratings on ${pageCount(reviews)}: ${pageList(reviews)}`);
  if (testimonials.length > 0) parts.push(`testimonials on ${pageCount(testimonials)}: ${pageList(testimonials)}`);
  if (certifications.length > 0)
    parts.push(`certifications on ${pageCount(certifications)}: ${pageList(certifications)}`);
  return { status: 'found', pages: found, detail: `Found: ${parts.join('; ')}.` };
}

function localSignals(pages: MarketingPage[]): SignalResult {
  const nap: NapDetails[] = [];
  const napPages: string[] = [];
  const mapPages: string[] = [];
  const schemaPages: string[] = [];
  for (const page of pages) {
    const path = page.content.urlPath;
    const pageNap = napFromPage(page.raw, path);
    if (pageNap.length > 0) {
      nap.push(...pageNap);
      napPages.push(path);
    }
    const map = [...page.raw.iframes, ...page.raw.scripts].some((address) => {
      const url = parse(address, page.raw.url);
      return (
        url !== null &&
        MAP_EMBEDS.some((m) => hostMatches(url.hostname, m.host) && (!m.path || m.path.test(url.pathname)))
      );
    });
    if (map) mapPages.push(path);
    if (page.raw.jsonLd.some((block) => (block.types ?? []).some(isLocalBusinessType))) schemaPages.push(path);
  }
  const found = inPageOrder(pages, [...napPages, ...mapPages, ...schemaPages]);
  if (found.length === 0) {
    return {
      status: 'not-found',
      pages: [],
      detail: `Not found: no business name, address or phone (NAP), map embed or LocalBusiness schema on the ${pages.length} ${plural(pages.length, 'page')} read.`,
    };
  }
  const parts: string[] = [];
  if (napPages.length > 0)
    parts.push(`business name, address or phone (NAP) on ${pageCount(napPages)}: ${pageList(napPages)}`);
  if (mapPages.length > 0) parts.push(`map embed on ${pageCount(mapPages)}: ${pageList(mapPages)}`);
  if (schemaPages.length > 0) parts.push(`LocalBusiness schema on ${pageCount(schemaPages)}: ${pageList(schemaPages)}`);
  const result: SignalResult = { status: 'found', pages: found, detail: `Found: ${parts.join('; ')}.` };
  if (nap.length > 0) result.nap = nap;
  return result;
}

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

/** Field types that never say what a form asks for. */
const IGNORED_FIELD_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
/** A field asking for a person's name, email or phone (by its name or label). */
const LEAD_FIELD_WORDS =
  /\bname\b|full[\s_-]?name|first[\s_-]?name|last[\s_-]?name|your[\s_-]?name|e-?mail|phone|mobile|whatsapp|\btel\b/;
const SEARCH_FIELD_NAMES = new Set(['q', 's', 'query', 'search', 'search_query', 'keyword', 'keywords', 'term']);

function isSearchForm(form: Pick<ContentForm, 'action'>, fields: ContentForm['fields']): boolean {
  if (fields.some((f) => lower(f.type) === 'search')) return true;
  if (/(?:^|[/?&#=])search\b/i.test(form.action ?? '')) return true;
  const named = fields.filter((f) => SEARCH_FIELD_NAMES.has(lower(f.name ?? '')) || /\bsearch\b/i.test(f.label ?? ''));
  // A form whose only text field is a search box is a search form, even with a name or email word nearby.
  return named.length > 0 && fields.length === named.length;
}

function telLinkCount(raw: RawPage): number {
  const hrefs = new Set<string>();
  let count = 0;
  for (const link of raw.contactLinks ?? []) {
    if (link.kind !== 'tel') continue;
    count += 1;
    hrefs.add(`${link.chunk}|${link.href}`);
  }
  // Anchors with a tel: href that the reader did not also list as a contact link.
  for (const anchor of raw.anchors ?? []) {
    if (!/^\s*tel:/i.test(anchor.href ?? '')) continue;
    if (hrefs.has(`${anchor.chunk}|${anchor.href}`)) continue;
    count += 1;
  }
  return count;
}

function pageText(page: MarketingPage): string {
  return [page.content.text ?? '', ...page.content.headings.map((h) => h.text ?? '')].join('\n');
}

function uniquePages(pages: MarketingPage[]): MarketingPage[] {
  const seen = new Set<string>();
  const out: MarketingPage[] = [];
  for (const page of pages) {
    if (!page?.content || !page.raw || seen.has(page.content.urlPath)) continue;
    seen.add(page.content.urlPath);
    out.push(page);
  }
  return out;
}

function pathsOf(pages: MarketingPage[]): string[] {
  return pages.map((p) => p.content.urlPath);
}

/** The given paths once each, in the order the pages were read. */
function inPageOrder(pages: MarketingPage[], paths: string[]): string[] {
  const wanted = new Set(paths);
  return pathsOf(pages).filter((path) => wanted.has(path));
}

function parse(address: string, base: string): URL | null {
  try {
    return new URL(String(address ?? '').trim(), base);
  } catch {
    return null;
  }
}

function hostMatches(hostname: string, host: string): boolean {
  const h = hostname.toLowerCase();
  return h === host || h.endsWith(`.${host}`);
}

function notFound(label: string, total: number): string {
  return `Not found: no ${label.toLowerCase()} on the ${total} ${plural(total, 'page')} read.`;
}

function pageCount(paths: string[]): string {
  return `${paths.length} ${plural(paths.length, 'page')}`;
}

function pageList(paths: string[]): string {
  return capList(paths, DETAIL_PAGES_CAP);
}

function nameList(names: string[]): string {
  return capList(names, DETAIL_NAMES_CAP);
}

function capList(items: string[], max: number): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function nonEmpty(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trim().length > 0;
}

function lower(text: string | null | undefined): string {
  return (text ?? '').toLowerCase();
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
