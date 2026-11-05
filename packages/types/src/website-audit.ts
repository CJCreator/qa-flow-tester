/**
 * The Website Audit contract (ADR 0033): what an audit reads from each page, what it finds, what it
 * produces, and every audit route of the runner with its request and reply shapes (`AUDIT_API`).
 *
 * Pure, browser-safe module: no Node built-ins and no I/O, so the wizard bundles it through browser.ts.
 * Both ends import these shapes instead of carrying a copy (the checkup-api.ts pattern, ADR 0027), and
 * both check a start request with the same `validateAuditStartBody`.
 *
 * Wording follows ADR 0018: "found" or "not found", never "compliant", "secure" or "passes". A Website
 * Audit has no release verdict (ADR 0029), so nothing here carries one. AI output is advisory: grades
 * come from deterministic checks and AI writes notes (Q-04).
 */

import type { AspectGrade, MarketingReview, MarketingSignal } from './aspects.js';
import { CRAWL_LIMIT_BOUNDS, type CrawlLimits } from './discovery.js';
import type { PageCoverage } from './route-telemetry.js';
import type { FindingSeverity } from './test-case.js';

// ---------------------------------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------------------------------

/** The languages documents can be written in and pages are detected in (REQ-013, REQ-032, REQ-044). */
export const DOCUMENT_LANGUAGES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'ur'] as const;

export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

export interface DocumentLanguageInfo {
  /** The language's English name. */
  name: string;
  /** Writing direction: Urdu is right-to-left. */
  dir: 'ltr' | 'rtl';
  /** Fixed text not yet reviewed by a person: documents carry a "beta translation" label (Q-45). */
  beta: boolean;
}

export const DOCUMENT_LANGUAGE_INFO: Readonly<Record<DocumentLanguage, DocumentLanguageInfo>> = {
  en: { name: 'English', dir: 'ltr', beta: false },
  ta: { name: 'Tamil', dir: 'ltr', beta: false },
  hi: { name: 'Hindi', dir: 'ltr', beta: true },
  te: { name: 'Telugu', dir: 'ltr', beta: true },
  kn: { name: 'Kannada', dir: 'ltr', beta: true },
  ml: { name: 'Malayalam', dir: 'ltr', beta: true },
  mr: { name: 'Marathi', dir: 'ltr', beta: true },
  gu: { name: 'Gujarati', dir: 'ltr', beta: true },
  bn: { name: 'Bengali', dir: 'ltr', beta: true },
  or: { name: 'Odia', dir: 'ltr', beta: true },
  pa: { name: 'Punjabi', dir: 'ltr', beta: true },
  ur: { name: 'Urdu', dir: 'rtl', beta: true },
};

export function isDocumentLanguage(value: unknown): value is DocumentLanguage {
  return typeof value === 'string' && (DOCUMENT_LANGUAGES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------------
// Starting an audit
// ---------------------------------------------------------------------------------------------------

/** `POST /api/audits` body (REQ-001, REQ-002). Limits left out take their defaults. */
export interface AuditStartBody extends CrawlLimits {
  /** The public address the audit starts from: http:// or https://. */
  url: string;
  /** The language the AI writes its notes in (default 'en'). Documents can be exported in any language. */
  language?: DocumentLanguage;
}

/** The limits an audit ran with, defaults filled in. A re-run uses them unchanged (REQ-028 AC-3). */
export interface AuditLimits {
  maxPages: number;
  maxDepth: number;
  includePaths: string[];
  excludePaths: string[];
}

/** A start request after validation: the address normalised and every default filled in. */
export interface AuditRequest {
  url: string;
  limits: AuditLimits;
  language: DocumentLanguage;
}

export type AuditStartField = 'url' | 'maxPages' | 'maxDepth' | 'includePaths' | 'excludePaths' | 'language';

/** One message per field that is wrong, worded for the person filling in the form. */
export type AuditStartErrors = Partial<Record<AuditStartField, string>>;

export type AuditStartCheck = { ok: true; value: AuditRequest } | { ok: false; errors: AuditStartErrors };

/** Longest start address accepted. */
export const MAX_AUDIT_URL_CHARS = 2048;

/** Characters a path may hold as written (RFC 3986), less `*`: a path prefix needs no wildcard. */
const PATH_ASCII_ALLOWED = /^[A-Za-z0-9\-._~!$&'()+,;=:@%/]$/;

function urlProblem(input: unknown): string | { url: string } {
  if (typeof input !== 'string' || input.trim() === '') {
    return 'Enter the website address, such as https://example.com.';
  }
  const text = input.trim();
  if (text.length > MAX_AUDIT_URL_CHARS) return `The address is longer than ${MAX_AUDIT_URL_CHARS} characters.`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'That is not a web address. Enter the full address, such as https://example.com.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The address must start with http:// or https://.';
  }
  if (url.username || url.password) return 'Leave the user name and password out of the address.';
  url.hash = '';
  return { url: url.href };
}

function wholeNumberProblem(input: unknown, min: number, max: number, label: string): string | undefined {
  if (typeof input === 'number' && Number.isInteger(input) && input >= min && input <= max) return undefined;
  return `${label} must be a whole number from ${min} to ${max}.`;
}

/** Why one path prefix is malformed, or undefined when it is fine. */
function pathPrefixProblem(prefix: string): string | undefined {
  if (prefix === '') return 'is empty.';
  if (prefix.length > CRAWL_LIMIT_BOUNDS.maxPathPrefixChars) {
    return `is longer than ${CRAWL_LIMIT_BOUNDS.maxPathPrefixChars} characters.`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(prefix) || prefix.startsWith('//')) {
    return 'must be a path such as /blog, not a full address.';
  }
  if (!prefix.startsWith('/')) return 'must start with /, such as /blog.';
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(prefix)) return 'must not contain spaces or invisible characters.';
  if (prefix.includes('\\')) return 'must use / and not \\.';
  if (prefix.includes('?') || prefix.includes('#')) return 'must be a path without ? or #.';
  if (prefix.includes('*')) return 'is a prefix and needs no *: /blog already covers everything under /blog.';
  for (const char of prefix) {
    if (char.charCodeAt(0) < 0x80 && !PATH_ASCII_ALLOWED.test(char)) return 'has a character a path cannot contain.';
  }
  const badEscape = 'has a % that is not a valid escape such as %20.';
  if (/%(?![0-9A-Fa-f]{2})/.test(prefix)) return badEscape;
  for (const segment of prefix.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return badEscape;
    }
    if (decoded === '.' || decoded === '..') return 'must not contain . or .. as a part.';
  }
  return undefined;
}

function pathListProblem(input: unknown, label: 'Include' | 'Exclude'): string | { paths: string[] } {
  if (input === undefined || input === null) return { paths: [] };
  if (!Array.isArray(input)) return `${label} paths must be a list of path prefixes such as /blog.`;
  if (input.length > CRAWL_LIMIT_BOUNDS.maxPathPrefixes) {
    return `Use at most ${CRAWL_LIMIT_BOUNDS.maxPathPrefixes} ${label.toLowerCase()} paths.`;
  }
  const paths: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw: unknown = input[i];
    const prefix = typeof raw === 'string' ? raw.trim() : '';
    const problem = pathPrefixProblem(prefix);
    if (problem) return `${label} path ${i + 1} ${problem}`;
    if (!paths.includes(prefix)) paths.push(prefix);
  }
  return { paths };
}

/**
 * Checks a `POST /api/audits` body (REQ-001 AC-3, REQ-002) and fills in the defaults. Refuses a non-URL,
 * a scheme other than http(s), credentials in the address, max pages outside 1-1000, a max depth outside
 * 0-100 and malformed path prefixes, with one message per field. Unknown fields are dropped.
 *
 * Syntax only: whether the host is public and answers is the runner's check (REQ-001 AC-2, Q-22), which
 * keeps this module free of I/O and lets local test servers through here.
 */
export function validateAuditStartBody(input: unknown): AuditStartCheck {
  const body = (input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<
    string,
    unknown
  >;
  const errors: AuditStartErrors = {};
  const b = CRAWL_LIMIT_BOUNDS;

  const url = urlProblem(body.url);
  if (typeof url === 'string') errors.url = url;

  const maxPages = body.maxPages ?? b.defaultPages;
  const pagesProblem = wholeNumberProblem(maxPages, b.minPages, b.maxPages, 'Max pages');
  if (pagesProblem) errors.maxPages = pagesProblem;

  const maxDepth = body.maxDepth ?? b.defaultDepth;
  const depthProblem = wholeNumberProblem(maxDepth, b.minDepth, b.maxDepth, 'Max depth');
  if (depthProblem) errors.maxDepth = depthProblem;

  const include = pathListProblem(body.includePaths, 'Include');
  if (typeof include === 'string') errors.includePaths = include;
  const exclude = pathListProblem(body.excludePaths, 'Exclude');
  if (typeof exclude === 'string') errors.excludePaths = exclude;

  const language = body.language ?? 'en';
  if (!isDocumentLanguage(language)) {
    errors.language = `Pick one of the document languages: ${DOCUMENT_LANGUAGES.join(', ')}.`;
  }

  if (
    typeof url === 'string' ||
    typeof include === 'string' ||
    typeof exclude === 'string' ||
    !isDocumentLanguage(language) ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      url: url.url,
      limits: {
        maxPages: maxPages as number,
        maxDepth: maxDepth as number,
        includePaths: include.paths,
        excludePaths: exclude.paths,
      },
      language,
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Page Content (REQ-008, REQ-009): read from every crawled page by fixed rules, without AI
// ---------------------------------------------------------------------------------------------------

/**
 * Where a link sits (REQ-007): a header or nav menu, the footer, breadcrumbs, or anywhere else in the page
 * ('internal': a link in the page's own content).
 */
export type LinkRegion = 'menu' | 'footer' | 'breadcrumb' | 'internal';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface ContentHeading {
  level: HeadingLevel;
  text: string;
  sectionId?: string;
}

export interface ContentImage {
  /** The image's address (a long data: address is shortened). */
  src: string;
  /** The alt text as written; '' is an empty alt (a decorative image); null means the alt attribute is missing. */
  alt: string | null;
  sectionId?: string;
}

export interface ContentLink {
  /** What a person would call it: its text or label. */
  text: string;
  /** Where it goes: a path on the site, or the full address when it leaves the site. */
  to: string;
  region: LinkRegion;
  /** It goes to another host: listed as leaving the site, never crawled (REQ-003 AC-2). */
  leavesSite?: boolean;
  sectionId?: string;
}

/** A form field as the page declares it. Values are never read, filled in or sent. */
export interface ContentFormField {
  /** text, email, tel, number, select, textarea, checkbox… */
  type: string;
  /** Its label, aria-label or placeholder, as a person would call it. */
  label: string;
  /** The HTML name attribute, when set. */
  name?: string;
  required?: boolean;
}

/** A form on the page: read, never submitted (ADR 0030). */
export interface ContentForm {
  /** GET or POST, as declared (GET when not set). */
  method: string;
  /** Where it would send to, when set. */
  action?: string;
  fields: ContentFormField[];
  sectionId?: string;
}

/** A call to action: a button or a button-styled link, with its text and target (Q-33). */
export interface ContentCta {
  text: string;
  kind: 'button' | 'link';
  /** Where it goes, for a link. */
  to?: string;
  sectionId?: string;
}

/** What a Section was found from: a landmark element, a top-level heading, or the whole page when it has neither. */
export type SectionKind = 'header' | 'nav' | 'main' | 'aside' | 'footer' | 'region' | 'heading' | 'page';

/**
 * One part of a page (REQ-008, Q-23). Its text is `PageContent.text.slice(start, end)` (see `sectionText`):
 * a page's Sections are in page order, contiguous and together cover its whole text, so every part of the
 * text belongs to exactly one Section.
 */
export interface Section {
  /** "s1", "s2"… in page order; unique within its page. Findings and edits cite it. */
  id: string;
  kind: SectionKind;
  /** Its heading text, when it has one. */
  heading?: string;
  start: number;
  end: number;
}

/** A Section's own text. */
export function sectionText(content: Pick<PageContent, 'text'>, section: Pick<Section, 'start' | 'end'>): string {
  return content.text.slice(section.start, section.end);
}

/** A page's language, detected from its main text by Unicode script share (REQ-013, REQ-032). */
export interface PageLanguage {
  /** The language most of the letters are in; 'not-identified' when there is too little text or another language. */
  primary: DocumentLanguage | 'not-identified';
  /** Other listed languages present on the page (a Tamil page with English parts lists 'en'). */
  others: DocumentLanguage[];
  /** The page's own lang attribute as written: a hint, not the answer. Null when not set. */
  declared: string | null;
}

/**
 * Everything a Website Audit reads from one crawled page (CONTEXT.md "Page Content"). Text is kept
 * character for character (REQ-044 AC-1). Stored one file per page beside the results, not inside them.
 */
export interface PageContent {
  /** The page's path on the audited site (redacted: no secrets in the query). */
  urlPath: string;
  /** Null when the page has no title element; '' when it is empty. */
  title: string | null;
  /** The meta description; null when the page has none. */
  description: string | null;
  /** The page's visible text in page order. */
  text: string;
  /** True when `text` was cut at the per-page limit. */
  textTruncated?: boolean;
  headings: ContentHeading[];
  images: ContentImage[];
  links: ContentLink[];
  forms: ContentForm[];
  ctas: ContentCta[];
  language: PageLanguage;
  sections: Section[];
}

// ---------------------------------------------------------------------------------------------------
// Technology (REQ-010)
// ---------------------------------------------------------------------------------------------------

/** The CMSs and frameworks the audit recognises (Q-28). */
export const TECHNOLOGIES = [
  { name: 'WordPress', kind: 'cms' },
  { name: 'Wix', kind: 'cms' },
  { name: 'Shopify', kind: 'cms' },
  { name: 'Squarespace', kind: 'cms' },
  { name: 'Webflow', kind: 'cms' },
  { name: 'Joomla', kind: 'cms' },
  { name: 'Drupal', kind: 'cms' },
  { name: 'Zoho Sites', kind: 'cms' },
  { name: 'Google Sites', kind: 'cms' },
  { name: 'Blogger', kind: 'cms' },
  { name: 'Dukaan', kind: 'cms' },
  { name: 'GoDaddy Website Builder', kind: 'cms' },
  { name: 'React', kind: 'framework' },
  { name: 'Next.js', kind: 'framework' },
  { name: 'Vue/Nuxt', kind: 'framework' },
  { name: 'Angular', kind: 'framework' },
  { name: 'Gatsby', kind: 'framework' },
  { name: 'Hugo', kind: 'static-site-generator' },
  { name: 'Jekyll', kind: 'static-site-generator' },
  { name: 'Astro', kind: 'static-site-generator' },
  { name: 'Eleventy', kind: 'static-site-generator' },
] as const;

export type TechnologyName = (typeof TECHNOLOGIES)[number]['name'];
export type TechnologyKind = (typeof TECHNOLOGIES)[number]['kind'];

export interface DetectedTechnology {
  name: TechnologyName;
  kind: TechnologyKind;
  /** What showed it, in fixed wording: "meta generator", "script from /wp-content/", "x-powered-by header". */
  evidence: string[];
}

/** What the site is built with, or 'not-identified': never left blank (REQ-010 AC-2). */
export type TechnologyResult =
  { status: 'identified'; technologies: DetectedTechnology[] } | { status: 'not-identified' };

// ---------------------------------------------------------------------------------------------------
// Structure (REQ-007)
// ---------------------------------------------------------------------------------------------------

/** One page in the hierarchy. Every recorded page appears exactly once (REQ-007 AC-2). */
export interface HierarchyNode {
  urlPath: string;
  title: string | null;
  /** How its place was decided (Q-23): the start page, menu nesting, then breadcrumbs, then the URL path. */
  placedBy: 'start' | 'menu' | 'breadcrumb' | 'path';
  children: HierarchyNode[];
}

/** One internal link of the navigation map: the page it is on, its target page and its region. */
export interface NavigationLink {
  from: string;
  to: string;
  region: LinkRegion;
  text: string;
}

export interface PageHierarchy {
  /** The start page; every other recorded page sits beneath it. */
  root: HierarchyNode;
  /** Every internal link with its target page and region (REQ-007 AC-1). */
  links: NavigationLink[];
}

/** The internal-linking signal (REQ-015): how many links reach each page, and pages no recorded page links to. */
export interface InternalLinking {
  inboundCounts: Record<string, number>;
  unlinkedPages: string[];
}

// ---------------------------------------------------------------------------------------------------
// Findings, ranking and the Improvement Roadmap (REQ-014, REQ-017, REQ-026)
// ---------------------------------------------------------------------------------------------------

/** Impact and effort scale (Q-14). */
export const AUDIT_SCALE = ['high', 'medium', 'low'] as const;
export type AuditScale = (typeof AUDIT_SCALE)[number];

/** The six areas assessed per page and site-wide (REQ-016, Q-04). 'search-ranking' is "ranking". */
export const AUDIT_AREAS = ['search-ranking', 'marketing', 'usability', 'content', 'accessibility', 'speed'] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

/** The groups of the Findings document. They are not Sections. */
export type AuditFindingGroup = 'technical' | 'marketing' | 'content';

/** One issue a Website Audit found. Lists of them are in ranked order: impact, then lower effort. */
export interface AuditFinding {
  /** Unique within its version ("AF-001"…); edits and roadmap items refer to it. */
  id: string;
  /** The fixed rule or check behind it: 'duplicate-title', 'missing-alt', 'broken-link', or a checker's issue key. */
  rule: string;
  group: AuditFindingGroup;
  area: AuditArea;
  title: string;
  /** What was found, in plain words: what was seen, never a claim about the whole site (ADR 0018). */
  detail: string;
  /** How to repair it. */
  suggestion: string;
  impact: AuditScale;
  effort: AuditScale;
  /** The page it was found on: a path on the audited site (REQ-017 AC-2). */
  urlPath: string;
  /** The Section it was found in; null when it is about the whole page (its title, description or heading outline). */
  sectionId: string | null;
  /** Every page involved when it spans pages, `urlPath` first: a duplicate title lists both (REQ-014 AC-2). */
  pages?: string[];
  /** The element involved, when there is one: an image's address, a broken link's target. */
  target?: string;
  /** A fixed rule over Page Content, a browser checker on a Sample Page, or the AI. */
  source: 'rule' | 'checker' | 'ai';
  /** AI-written: shown, but it never changes grades (ADR 0009, 0029). */
  advisory?: boolean;
  /** The checker's severity, when a checker found it. */
  severity?: FindingSeverity;
  /** The checker Finding it came from (`Finding.id`), when it did. */
  findingId?: string;
  /** A screenshot showing it, relative to the version's folder (`AUDIT_API.file`). */
  screenshotPath?: string;
}

/** One item of the Improvement Roadmap: never called a Plan (CONTEXT.md). */
export interface RoadmapItem {
  id: string;
  title: string;
  priority: AuditScale;
  /** 1 is done first. */
  phase: number;
  effort: AuditScale;
  findingIds: string[];
  pages: string[];
}

// ---------------------------------------------------------------------------------------------------
// AI assessment and redesign or repair (REQ-016, REQ-045)
// ---------------------------------------------------------------------------------------------------

/** Why an area has no AI note. Never shown as a clean result (REQ-016 AC-3). */
export type AssessmentNotDoneReason = 'no-ai-key' | 'ai-failed' | 'budget-spent';

/**
 * One of the six areas for a Sample Page or the whole site. The grade comes from deterministic checks
 * (null: nothing in the area was checked); the AI only writes the note, citing finding ids as evidence.
 */
export type AreaAssessment =
  | { area: AuditArea; grade: AspectGrade | null; status: 'done'; note: string; evidence: string[] }
  | { area: AuditArea; grade: AspectGrade | null; status: 'not-done'; reason: AssessmentNotDoneReason };

export type PageAction = 'redesign' | 'repair';

/** Exactly one per Sample Page (REQ-045): redesign or repair, with the findings that led to it. */
export interface PageRecommendation {
  urlPath: string;
  action: PageAction;
  /** Why, in plain words. */
  reason: string;
  findingIds: string[];
  /** 'ai': proposed by the AI. 'rule': no AI key, so a fixed rule decided; shown as rule-based. */
  decidedBy: 'ai' | 'rule';
}

// ---------------------------------------------------------------------------------------------------
// Per-page checks: SEO and accessibility basics, phone layout, speed (REQ-012, REQ-037, REQ-038)
// ---------------------------------------------------------------------------------------------------

/** SEO basics, recorded for every page from its Page Content. Facts, never "compliant". */
export interface SeoBasics {
  hasTitle: boolean;
  hasDescription: boolean;
  h1Count: number;
  skippedHeadingLevel: boolean;
  imagesWithoutAlt: number;
  /** The lang attribute as written; null when not set. */
  htmlLang: string | null;
  findingIds: string[];
}

/** Accessibility basics of a Sample Page: the standard and level are named, never "accessible" (REQ-038). */
export interface AccessibilityBasics {
  standard: 'WCAG 2.2';
  level: 'AA';
  /** Automatic checks find some problems only; a person must check the rest. */
  method: 'automatic checks only';
  violations: number;
  findingIds: string[];
}

/** How a Sample Page lays out at phone width (REQ-037, Q-28). */
export interface PhoneLayout {
  widthPx: number;
  /** Relative to the version's folder; null when the screenshot failed. */
  screenshotPath: string | null;
  /** The page is wider than the screen; null when not checked. */
  overflow: boolean | null;
  /** Overflow and tap-target findings. */
  findingIds: string[];
}

/** Lab values come from a Lighthouse run by the API; field values from real Chrome visitors (Chrome UX Report). */
export type SpeedMethod = 'lab' | 'field';

export type SpeedMetric = 'performance-score' | 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb' | 'tbt' | 'speed-index';

export interface SpeedValue {
  metric: SpeedMetric;
  value: number;
  /** 'score' is 0 to 100; 'none' is a plain number (layout shift). */
  unit: 'ms' | 'score' | 'none';
}

export type SpeedNotMeasuredReason = 'failed' | 'timeout' | 'quota' | 'no-network' | 'no-field-data';

/**
 * Speed from the Google PageSpeed Insights API (REQ-012, ADR 0035), always with its source and method.
 * When it was not measured it carries no values, so it can never read as good (REQ-012 AC-2).
 */
export type ExternalSpeed =
  | {
      status: 'measured';
      source: 'pagespeed-insights';
      method: SpeedMethod;
      strategy: 'mobile';
      /** Field data for this page, or for the whole origin when the page has too few visitors. */
      scope?: 'page' | 'origin';
      values: SpeedValue[];
      measuredAt: string;
    }
  | { status: 'not-measured'; source: 'pagespeed-insights'; method: SpeedMethod; reason: SpeedNotMeasuredReason };

export interface PageSpeed {
  lab: ExternalSpeed;
  field: ExternalSpeed;
}

// ---------------------------------------------------------------------------------------------------
// The result of one audit version
// ---------------------------------------------------------------------------------------------------

/** A Section without its text, for lists. */
export type SectionSummary = Pick<Section, 'id' | 'kind' | 'heading'>;

/** One recorded page. Its Page Content is fetched separately (`AUDIT_API.content`). */
export interface AuditPage {
  urlPath: string;
  title: string | null;
  /** Link steps from the start address (0 for the start page). */
  depth: number;
  layoutGroup?: string;
  /**
   * 'sample': a Sample Page, checked and assessed itself. 'covered': refers to its Layout Group's Sample
   * Page (`sampleUrlPath`) for checks, notes and the redesign-or-repair recommendation (DEC-006).
   */
  coverage: 'sample' | 'covered';
  sampleUrlPath?: string;
  language: PageLanguage;
  sections: SectionSummary[];
  seo: SeoBasics;
  /** Sample Pages only. */
  accessibility?: AccessibilityBasics;
  /** Sample Pages only. */
  phone?: PhoneLayout;
  /** Sample Pages only. */
  speed?: PageSpeed;
  /** Sample Pages only: one per area in `AUDIT_AREAS`. */
  areas?: AreaAssessment[];
  /** Sample Pages only. */
  recommendation?: PageRecommendation;
}

/** The ten FR-15 signals are always present on an audit (`MarketingReview.signals`). */
export type AuditMarketing = MarketingReview & { signals: MarketingSignal[] };

/** What one finished audit version found. No release verdict (ADR 0029). Never edited: edits are an overlay. */
export interface AuditResult {
  auditId: string;
  version: number;
  url: string;
  limits: AuditLimits;
  language: DocumentLanguage;
  startedAt: string;
  finishedAt: string;
  technology: TechnologyResult;
  pages: AuditPage[];
  /** Pages found, how many were recorded, and the Skipped Pages with their reasons (sign-in, payment…). */
  coverage: PageCoverage;
  /** Links that leave the site, with the pages they are on (REQ-003 AC-2). */
  leavingSite: Array<{ to: string; from: string[] }>;
  hierarchy: PageHierarchy;
  internalLinking: InternalLinking;
  /** Ranked: impact, then lower effort. The first three make the Pitch Glimpse. */
  findings: AuditFinding[];
  roadmap: RoadmapItem[];
  marketing: AuditMarketing;
  /** The whole site: one per area in `AUDIT_AREAS`. */
  siteAreas: AreaAssessment[];
  /** Plain sentences for the tool user, such as "AI notes need an AI key." */
  notes: string[];
}

// ---------------------------------------------------------------------------------------------------
// Audit Documents and export (REQ-018, REQ-021, REQ-022)
// ---------------------------------------------------------------------------------------------------

/** The five Audit Documents (DEC-007). The Pitch Glimpse and the Owner Audit are not Audit Documents. */
export const AUDIT_DOCUMENT_KINDS = ['structure', 'content', 'findings', 'roadmap', 'proposal'] as const;
export type AuditDocumentKind = (typeof AUDIT_DOCUMENT_KINDS)[number];

export function isAuditDocumentKind(value: unknown): value is AuditDocumentKind {
  return typeof value === 'string' && (AUDIT_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** 'bundle': a zip of the Markdown documents, site.json and a README index (Q-24). */
export const EXPORT_FORMATS = ['md', 'html', 'pdf', 'docx', 'bundle'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value);
}

export const EXPORT_CONTENT_TYPES: Readonly<Record<ExportFormat, string>> = {
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  bundle: 'application/zip',
};

// ---------------------------------------------------------------------------------------------------
// Edits before export (REQ-020): an overlay, the originals are kept (Q-25)
// ---------------------------------------------------------------------------------------------------

export interface FindingEdit {
  findingId: string;
  title?: string;
  detail?: string;
  suggestion?: string;
  editedAt: string;
}

export interface SectionEdit {
  urlPath: string;
  sectionId: string;
  text: string;
  /** 'rewrite': accepted AI copy (REQ-030), in the documents only, never on the live site. */
  by: 'person' | 'rewrite';
  editedAt: string;
}

/** The tool user's choice of redesign or repair for a page, replacing the proposed one (Q-14). */
export interface RecommendationEdit {
  urlPath: string;
  action: PageAction;
  editedAt: string;
}

/** What the tool user fills in for the Proposal of this audit (Q-19). Left out of the Owner Audit. */
export interface ProposalInputs {
  /** The price in INR, as the tool user writes it (such as "₹45,000 + GST"). */
  price?: string;
  paymentTerms?: string;
  /** Lines listed as not included; when absent: hosting or domain, digital marketing or ads, mobile apps. */
  notIncluded?: string[];
}

/** One version's edits, applied at export. The result itself is never changed. */
export interface EditOverlay {
  findings: FindingEdit[];
  sections: SectionEdit[];
  /** Pages removed from the hierarchy: exports do not list them (REQ-020 AC-2). */
  removedPages: string[];
  recommendations: RecommendationEdit[];
  proposal: ProposalInputs;
  /** Null when nothing was edited yet. */
  updatedAt: string | null;
}

/** `PATCH /api/audits/:id/edits` body. `reset: true` removes an edit, so the original shows again. */
export interface AuditEditsPatch {
  findings?: Array<
    { findingId: string; title?: string; detail?: string; suggestion?: string } | { findingId: string; reset: true }
  >;
  sections?: Array<
    { urlPath: string; sectionId: string; text: string } | { urlPath: string; sectionId: string; reset: true }
  >;
  removePages?: string[];
  restorePages?: string[];
  recommendations?: Array<{ urlPath: string; action: PageAction } | { urlPath: string; reset: true }>;
  proposal?: ProposalInputs;
}

// ---------------------------------------------------------------------------------------------------
// Saved audits and versions (REQ-028)
// ---------------------------------------------------------------------------------------------------

/** Audit ids: URL-safe and free of dots and slashes, so one can never name a path outside its folder. */
export const AUDIT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type AuditStatus = 'running' | 'done' | 'failed' | 'stopped';

/** One run of an audit. Each re-run is a new version with the same address and limits (Q-25). */
export interface AuditVersion {
  auditId: string;
  /** 1, 2, 3… */
  version: number;
  url: string;
  limits: AuditLimits;
  language: DocumentLanguage;
  status: AuditStatus;
  startedAt: string;
  finishedAt?: string;
  /** Short fixed wording when it failed: never page text or a stack trace. */
  error?: string;
  pagesRecorded?: number;
  pagesSkipped?: number;
  findings?: number;
  /** The version has edits. */
  edited?: boolean;
}

/** A saved Website Audit with every version, oldest first (REQ-028 AC-2). */
export interface AuditSummary {
  auditId: string;
  /** The latest version's address. */
  url: string;
  host: string;
  createdAt: string;
  versions: AuditVersion[];
  /** The Shortlist mark, notes and outcome, shown with the audit (REQ-023 AC-1). */
  shortlist?: ShortlistEntry;
}

// ---------------------------------------------------------------------------------------------------
// Shortlist (REQ-023)
// ---------------------------------------------------------------------------------------------------

/** The fixed outcome list (Q-31), plus a free-text note on the entry. */
export const SHORTLIST_OUTCOMES = ['No reply', 'Interested', 'Meeting set', 'Won', 'Lost', 'Opted out'] as const;
export type ShortlistOutcome = (typeof SHORTLIST_OUTCOMES)[number];

export function isShortlistOutcome(value: unknown): value is ShortlistOutcome {
  return typeof value === 'string' && (SHORTLIST_OUTCOMES as readonly string[]).includes(value);
}

export type ShortlistMark = 'pitch' | 'skip';

/** Notes can hold an owner's personal details: deleting the audit deletes the entry. */
export interface ShortlistEntry {
  auditId: string;
  mark: ShortlistMark | null;
  notes: string;
  outcome: ShortlistOutcome | null;
  /** Free text about the outcome. */
  outcomeNote: string;
  updatedAt: string;
}

/** `PUT /api/audits/:id/shortlist` body: only the fields sent change; null clears a mark or outcome. */
export interface ShortlistUpdate {
  mark?: ShortlistMark | null;
  notes?: string;
  outcome?: ShortlistOutcome | null;
  outcomeNote?: string;
}

export interface ShortlistListItem extends ShortlistEntry {
  url: string;
  host: string;
}

// ---------------------------------------------------------------------------------------------------
// Shared Links (REQ-019, REQ-024)
// ---------------------------------------------------------------------------------------------------

/** Days a Shared Link stays open. */
export const SHARE_LINK_DAYS = 30;

/** The only path served without the access key. */
export const SHARED_LINK_PREFIX = '/s/';

/** Shared Link ids: at least 128 random bits, URL-safe (22 base64url characters or more). */
export const SHARE_LINK_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

/** Only a Pitch Glimpse or an improved-homepage preview can be shared. */
export type ShareLinkKind = 'pitch' | 'preview';

export interface ShareLink {
  id: string;
  auditId: string;
  version: number;
  kind: ShareLinkKind;
  language: DocumentLanguage;
  createdAt: string;
  expiresAt: string;
  /** Opening a revoked or expired link answers 410. */
  revokedAt: string | null;
}

// ---------------------------------------------------------------------------------------------------
// Helpers (REQ-033)
// ---------------------------------------------------------------------------------------------------

/** What a Helper may do in one audit. 'edit' and 'export' include 'view'. */
export const HELPER_PERMISSIONS = ['view', 'edit', 'export'] as const;
export type HelperPermission = (typeof HELPER_PERMISSIONS)[number];

/** One Helper's access to one audit, given by the tool user. */
export interface HelperGrant {
  auditId: string;
  /** The Helper's Google account address, lower-cased. */
  email: string;
  permissions: HelperPermission[];
  grantedAt: string;
}

/** The signed-in Helper and the audits they were given. */
export interface HelperSession {
  email: string;
  grants: HelperGrant[];
}

// ---------------------------------------------------------------------------------------------------
// Rewrite after approval (REQ-030)
// ---------------------------------------------------------------------------------------------------

/** A run of words the new copy shares with the original Section (at least the overlap threshold long). */
export interface OverlapFlag {
  words: string;
  wordCount: number;
}

/** One Section's rewrite: approve first, then the AI writes, then the tool user accepts edited copy. */
export interface RewriteState {
  urlPath: string;
  sectionId: string;
  /** Null: not approved, so no rewrite runs (REQ-030 AC-1). */
  approvedAt: string | null;
  proposal: { text: string; language: DocumentLanguage; overlaps: OverlapFlag[]; createdAt: string } | null;
  acceptedAt: string | null;
}

// ---------------------------------------------------------------------------------------------------
// Audit settings
// ---------------------------------------------------------------------------------------------------

/** Words in a row a rewrite may share with the original before it is flagged (Q-08). */
export const DEFAULT_REWRITE_OVERLAP_WORDS = 6;

/** The tool user's company details, saved once and reused in every Proposal. */
export interface CompanyDetails {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Terms and conditions text. */
  terms: string;
}

/** `GET /api/audit-settings`. The PageSpeed key is write-only: only whether one is saved comes back. */
export interface AuditSettings {
  /** Opt-out text per language; a language without its own uses the tool's default. */
  optOutText: Partial<Record<DocumentLanguage, string>>;
  company: CompanyDetails;
  /** The Proposal template, Markdown with placeholders. */
  proposalTemplate: string;
  rewriteOverlapWords: number;
  pagespeedKeySaved: boolean;
}

/** The tool's defaults, so the wizard can show them and put them back. */
export interface AuditSettingsDefaults {
  optOutText: Partial<Record<DocumentLanguage, string>>;
  proposalTemplate: string;
  rewriteOverlapWords: number;
}

/** `PUT /api/audit-settings` body: only the fields sent change; null puts the default back. */
export interface AuditSettingsUpdate {
  optOutText?: Partial<Record<DocumentLanguage, string | null>>;
  company?: Partial<CompanyDetails>;
  proposalTemplate?: string | null;
  rewriteOverlapWords?: number;
  /** Saved through the key resolver, never stored as plain text and never sent back. Null removes it. */
  pagespeedKey?: string | null;
}

// ---------------------------------------------------------------------------------------------------
// Progress and errors
// ---------------------------------------------------------------------------------------------------

export type AuditStage =
  'checking-address' | 'crawling' | 'checking-pages' | 'measuring-speed' | 'assessing' | 'ranking' | 'saving';

/** One event on `GET /api/audits/:id/stream`. */
export type AuditProgressEvent =
  | {
      type: 'progress';
      auditId: string;
      version: number;
      stage: AuditStage;
      pagesFound: number;
      pagesRecorded: number;
      pagesSkipped: number;
      /** The path being read now (redacted). */
      currentPath?: string;
    }
  | { type: 'done'; auditId: string; version: number }
  | { type: 'failed'; auditId: string; version: number; error: string; code: AuditErrorCode };

export const AUDIT_ERROR_CODES = [
  /** 400: the start body is wrong; `fields` has a message per field. */
  'ERR_INVALID_AUDIT',
  /** 400: another body or query value is wrong. */
  'ERR_INVALID_REQUEST',
  /**
   * 400: the host resolves to a private or local address (Q-22). Only on the hosted copy or a runner reachable
   * from other machines: a local runner accepts localhost and LAN addresses (ADR 0042).
   */
  'ERR_PRIVATE_ADDRESS',
  /** 422: the host does not resolve, does not answer, or answers 400 or above (REQ-001 AC-2). */
  'ERR_UNREACHABLE',
  /** 409: the run slot is busy with a Check-up, benchmark or audit. */
  'ERR_RUN_IN_PROGRESS',
  /** 429: the shared copy's limit for a visitor is reached. */
  'ERR_BETA_LIMIT',
  /** 404 */
  'ERR_AUDIT_NOT_FOUND',
  /** 409: the version is still running. */
  'ERR_AUDIT_RUNNING',
  /** 409: the step needs an AI key and none is saved (REQ-011 AC-2). */
  'ERR_NO_AI_KEY',
  /** 409: the Section was not approved for a rewrite (REQ-030 AC-1). */
  'ERR_NOT_APPROVED',
  /** 422: the copy still shares a run of words with the original (REQ-030 AC-2). */
  'ERR_OVERLAP',
  /** 502: the AI gave no usable copy (budget spent, provider failure or claim words) (DEC-007). */
  'ERR_AI_FAILED',
  /** 410: the Shared Link expired or was revoked. */
  'ERR_LINK_GONE',
  /** 403: a Helper without the permission, or on an owner-only route. */
  'ERR_FORBIDDEN',
  /** 401: the Google sign-in token was refused. */
  'ERR_SIGN_IN_FAILED',
  /** 404: Helper sign-in is not set up on this copy. */
  'ERR_HELPERS_OFF',
] as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

/** Every audit refusal: a message for people and a code for code. No internals. */
export interface AuditErrorReply {
  error: string;
  code: AuditErrorCode;
  /** ERR_INVALID_AUDIT only. */
  fields?: AuditStartErrors;
}

// ---------------------------------------------------------------------------------------------------
// The audit API
// ---------------------------------------------------------------------------------------------------

/**
 * Who may call a route. 'owner': the tool user (access key) only, never a Helper (settings, keys, delete,
 * Helper management, anything that spends the AI key or publishes). 'view' | 'edit' | 'export': the tool
 * user, or a Helper given that permission on the audit. 'sign-in': Helper sign-in, before any access.
 * 'public': a Shared Link, open without the access key.
 */
export type AuditAccess = 'owner' | 'view' | 'edit' | 'export' | 'sign-in' | 'public';

export interface AuditEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** `:id` is an audit id (`AUDIT_ID_PATTERN`), `:linkId` a Shared Link id (`SHARE_LINK_ID_PATTERN`). */
  path: string;
  /** 'json': a JSON reply. 'file': a download. 'html': a page to open. 'sse': an event stream. */
  replies: 'json' | 'file' | 'html' | 'sse';
  access: AuditAccess;
}

/** Every audit route. Request and reply types per route are in `AuditApi`. */
export const AUDIT_API = {
  /** 202 AuditStartReply; 400 ERR_INVALID_AUDIT / ERR_PRIVATE_ADDRESS; 422 ERR_UNREACHABLE; 409 ERR_RUN_IN_PROGRESS. */
  start: { method: 'POST', path: '/api/audits', replies: 'json', access: 'owner' },
  /** The audits the caller may see, each with its versions. */
  list: { method: 'GET', path: '/api/audits', replies: 'json', access: 'view' },
  get: { method: 'GET', path: '/api/audits/:id', replies: 'json', access: 'view' },
  /** Deletes every version, edit, file, Shortlist entry, Shared Link and Helper grant of the audit. */
  remove: { method: 'DELETE', path: '/api/audits/:id', replies: 'json', access: 'owner' },
  stream: { method: 'GET', path: '/api/audits/:id/stream', replies: 'sse', access: 'view' },
  /** 202: a new version with the same address and limits. */
  rerun: { method: 'POST', path: '/api/audits/:id/rerun', replies: 'json', access: 'owner' },
  content: { method: 'GET', path: '/api/audits/:id/content', replies: 'json', access: 'view' },
  /** A screenshot of the version, by its path relative to the version's folder. */
  file: { method: 'GET', path: '/api/audits/:id/file', replies: 'file', access: 'view' },
  getEdits: { method: 'GET', path: '/api/audits/:id/edits', replies: 'json', access: 'view' },
  patchEdits: { method: 'PATCH', path: '/api/audits/:id/edits', replies: 'json', access: 'edit' },
  getSettings: { method: 'GET', path: '/api/audit-settings', replies: 'json', access: 'owner' },
  putSettings: { method: 'PUT', path: '/api/audit-settings', replies: 'json', access: 'owner' },
  export: { method: 'GET', path: '/api/audits/:id/export', replies: 'file', access: 'export' },
  pitch: { method: 'GET', path: '/api/audits/:id/pitch', replies: 'file', access: 'export' },
  owner: { method: 'GET', path: '/api/audits/:id/owner', replies: 'file', access: 'export' },
  /** Writes the improved homepage with the AI (preview stage); 409 ERR_NO_AI_KEY without a key. */
  createPreview: { method: 'POST', path: '/api/audits/:id/preview', replies: 'json', access: 'owner' },
  getPreview: { method: 'GET', path: '/api/audits/:id/preview', replies: 'html', access: 'view' },
  listShares: { method: 'GET', path: '/api/audits/:id/share', replies: 'json', access: 'view' },
  createShare: { method: 'POST', path: '/api/audits/:id/share', replies: 'json', access: 'owner' },
  revokeShare: { method: 'DELETE', path: '/api/audits/:id/share/:linkId', replies: 'json', access: 'owner' },
  /** Public, noindex, strict Content-Security-Policy; 410 when expired or revoked. */
  sharedPage: { method: 'GET', path: '/s/:linkId', replies: 'html', access: 'public' },
  listRewrites: { method: 'GET', path: '/api/audits/:id/rewrite', replies: 'json', access: 'view' },
  approveRewrite: { method: 'POST', path: '/api/audits/:id/rewrite/approve', replies: 'json', access: 'edit' },
  /** Writes new copy for an approved Section (rewrite stage); 409 ERR_NOT_APPROVED / ERR_NO_AI_KEY. */
  runRewrite: { method: 'POST', path: '/api/audits/:id/rewrite', replies: 'json', access: 'owner' },
  /** Puts the copy in the edit overlay; 422 ERR_OVERLAP while it shares a run of words with the original. */
  acceptRewrite: { method: 'POST', path: '/api/audits/:id/rewrite/accept', replies: 'json', access: 'edit' },
  getShortlist: { method: 'GET', path: '/api/audits/:id/shortlist', replies: 'json', access: 'view' },
  putShortlist: { method: 'PUT', path: '/api/audits/:id/shortlist', replies: 'json', access: 'edit' },
  listShortlist: { method: 'GET', path: '/api/shortlist', replies: 'json', access: 'view' },
  listHelpers: { method: 'GET', path: '/api/audits/:id/helpers', replies: 'json', access: 'owner' },
  grantHelper: { method: 'PUT', path: '/api/audits/:id/helpers', replies: 'json', access: 'owner' },
  removeHelper: { method: 'DELETE', path: '/api/audits/:id/helpers', replies: 'json', access: 'owner' },
  helperStatus: { method: 'GET', path: '/api/helper/status', replies: 'json', access: 'sign-in' },
  /** Verifies the Google ID token and sets the Helper session cookie. */
  helperSignIn: { method: 'POST', path: '/api/helper/session', replies: 'json', access: 'sign-in' },
  helperSession: { method: 'GET', path: '/api/helper/session', replies: 'json', access: 'sign-in' },
  helperSignOut: { method: 'DELETE', path: '/api/helper/session', replies: 'json', access: 'sign-in' },
} as const satisfies Record<string, AuditEndpoint>;

export type AuditEndpointName = keyof typeof AUDIT_API;

type ParamName<P extends string> = P extends `${string}:${infer Rest}`
  ? Rest extends `${infer Name}/${infer Tail}`
    ? Name | ParamName<Tail>
    : Rest
  : never;

/** The path parameters of a route pattern: `'/api/audits/:id'` gives `{ id: string }`. */
export type PathParams<P extends string> = { [K in ParamName<P>]: string };

/** Rules a path parameter must meet; anything else is not a match (a 404), so no id can name another folder. */
const PARAM_PATTERNS: Readonly<Record<string, RegExp>> = { id: AUDIT_ID_PATTERN, linkId: SHARE_LINK_ID_PATTERN };

/** A route's path with its parameters filled in and encoded: `auditPath(AUDIT_API.get.path, { id })`. */
export function auditPath<P extends string>(pattern: P, params: PathParams<P>): string {
  return pattern.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = (params as Record<string, unknown>)[name];
    if (typeof value !== 'string' || value === '') throw new Error(`Missing path parameter: ${name}`);
    return encodeURIComponent(value);
  });
}

/**
 * The parameters of `pathname` when it matches `pattern`, else null. Each parameter is decoded and must
 * meet its rule (`AUDIT_ID_PATTERN`, `SHARE_LINK_ID_PATTERN`); one that does not is no match.
 */
export function matchAuditPath<P extends string>(pattern: P, pathname: string): PathParams<P> | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (!want[i].startsWith(':')) {
      if (want[i] !== got[i]) return null;
      continue;
    }
    let value: string;
    try {
      value = decodeURIComponent(got[i]);
    } catch {
      return null;
    }
    const name = want[i].slice(1);
    const rule = PARAM_PATTERNS[name];
    if (rule ? !rule.test(value) : value === '' || value === '.' || value === '..' || /[/\\]/.test(value)) {
      return null;
    }
    params[name] = value;
  }
  return params as PathParams<P>;
}

/** A download: the body is the file, sent with its Content-Type and a Content-Disposition file name. */
export interface FileReply {
  readonly replies: 'file';
}

/** A self-contained HTML page (ADR 0021: no external resources). */
export interface HtmlReply {
  readonly replies: 'html';
}

/** A Server-Sent Events stream of `event`. */
export interface EventStreamReply<E> {
  readonly replies: 'sse';
  readonly event: E;
}

type NoQuery = Record<never, never>;
type VersionQuery = { version?: number };

export interface AuditStartReply {
  auditId: string;
  version: number;
}

export interface AuditListReply {
  audits: AuditSummary[];
}

/** One version (the latest when `version` is not given), its result and its edits, originals kept apart. */
export interface AuditGetReply {
  summary: AuditSummary;
  version: AuditVersion;
  /** Null while the version runs, or when it failed. */
  result: AuditResult | null;
  edits: EditOverlay;
}

export interface AuditContentReply {
  content: PageContent;
}

export interface AuditEditsReply {
  edits: EditOverlay;
}

export interface AuditSettingsReply {
  settings: AuditSettings;
  defaults: AuditSettingsDefaults;
}

/** `documents` travels as a comma-separated list; all five when absent. */
export interface AuditExportQuery extends VersionQuery {
  format: ExportFormat;
  documents?: AuditDocumentKind[];
  language?: DocumentLanguage;
}

/** One A4 page; never sent by the tool (REQ-019 AC-4). */
export interface PitchQuery extends VersionQuery {
  language?: DocumentLanguage;
  format?: 'html' | 'pdf';
}

export interface OwnerAuditQuery extends VersionQuery {
  language?: DocumentLanguage;
  format?: Exclude<ExportFormat, 'bundle'>;
}

export interface PreviewCreateBody extends VersionQuery {
  language?: DocumentLanguage;
}

export interface PreviewReply {
  preview: { version: number; language: DocumentLanguage; createdAt: string };
}

export interface ShareCreateBody extends VersionQuery {
  kind: ShareLinkKind;
  language?: DocumentLanguage;
}

export interface ShareLinkReply {
  link: ShareLink;
}

export interface ShareListReply {
  links: ShareLink[];
}

export interface RewriteSectionBody extends VersionQuery {
  urlPath: string;
  sectionId: string;
}

export interface RewriteRunBody extends RewriteSectionBody {
  language?: DocumentLanguage;
}

export interface RewriteAcceptBody extends RewriteSectionBody {
  text: string;
}

export interface RewriteListReply {
  rewrites: RewriteState[];
}

export interface RewriteReply {
  rewrite: RewriteState;
}

export interface RewriteAcceptReply {
  rewrite: RewriteState;
  edits: EditOverlay;
}

export interface ShortlistReply {
  entry: ShortlistEntry;
}

export interface ShortlistListQuery {
  mark?: ShortlistMark;
  outcome?: ShortlistOutcome;
}

export interface ShortlistListReply {
  entries: ShortlistListItem[];
}

export interface HelperListReply {
  helpers: HelperGrant[];
}

export interface HelperGrantBody {
  email: string;
  permissions: HelperPermission[];
}

export interface HelperGrantReply {
  helper: HelperGrant;
}

export interface HelperStatusReply {
  /** False when Helper sign-in is not set up on this copy. */
  enabled: boolean;
  /** Public Firebase web settings for Helper sign-in; present only when sign-in is on. Not secrets. */
  firebase?: { apiKey: string; authDomain: string; projectId: string };
}

export interface HelperSignInBody {
  /** The Google ID token from Firebase Authentication. Verified, never stored or logged. */
  idToken: string;
}

interface AuditApiShapes {
  start: { query: NoQuery; body: AuditStartBody; reply: AuditStartReply };
  list: { query: NoQuery; body: undefined; reply: AuditListReply };
  get: { query: VersionQuery; body: undefined; reply: AuditGetReply };
  remove: { query: NoQuery; body: undefined; reply: { deleted: true } };
  stream: { query: VersionQuery; body: undefined; reply: EventStreamReply<AuditProgressEvent> };
  rerun: { query: NoQuery; body: undefined; reply: AuditStartReply };
  content: { query: VersionQuery & { path: string }; body: undefined; reply: AuditContentReply };
  file: { query: VersionQuery & { path: string }; body: undefined; reply: FileReply };
  getEdits: { query: VersionQuery; body: undefined; reply: AuditEditsReply };
  patchEdits: { query: VersionQuery; body: AuditEditsPatch; reply: AuditEditsReply };
  getSettings: { query: NoQuery; body: undefined; reply: AuditSettingsReply };
  putSettings: { query: NoQuery; body: AuditSettingsUpdate; reply: AuditSettingsReply };
  export: { query: AuditExportQuery; body: undefined; reply: FileReply };
  pitch: { query: PitchQuery; body: undefined; reply: FileReply };
  owner: { query: OwnerAuditQuery; body: undefined; reply: FileReply };
  createPreview: { query: NoQuery; body: PreviewCreateBody; reply: PreviewReply };
  getPreview: { query: VersionQuery; body: undefined; reply: HtmlReply };
  listShares: { query: NoQuery; body: undefined; reply: ShareListReply };
  createShare: { query: NoQuery; body: ShareCreateBody; reply: ShareLinkReply };
  revokeShare: { query: NoQuery; body: undefined; reply: ShareLinkReply };
  sharedPage: { query: NoQuery; body: undefined; reply: HtmlReply };
  listRewrites: { query: VersionQuery; body: undefined; reply: RewriteListReply };
  approveRewrite: { query: NoQuery; body: RewriteSectionBody; reply: RewriteReply };
  runRewrite: { query: NoQuery; body: RewriteRunBody; reply: RewriteReply };
  acceptRewrite: { query: NoQuery; body: RewriteAcceptBody; reply: RewriteAcceptReply };
  getShortlist: { query: NoQuery; body: undefined; reply: ShortlistReply };
  putShortlist: { query: NoQuery; body: ShortlistUpdate; reply: ShortlistReply };
  listShortlist: { query: ShortlistListQuery; body: undefined; reply: ShortlistListReply };
  listHelpers: { query: NoQuery; body: undefined; reply: HelperListReply };
  grantHelper: { query: NoQuery; body: HelperGrantBody; reply: HelperGrantReply };
  removeHelper: { query: { email: string }; body: undefined; reply: { removed: true } };
  helperStatus: { query: NoQuery; body: undefined; reply: HelperStatusReply };
  helperSignIn: { query: NoQuery; body: HelperSignInBody; reply: HelperSession };
  helperSession: { query: NoQuery; body: undefined; reply: HelperSession };
  helperSignOut: { query: NoQuery; body: undefined; reply: { signedOut: true } };
}

/**
 * Request and reply types of every `AUDIT_API` route: path params from its pattern, query, JSON body and
 * reply. A route added to `AUDIT_API` without an entry here fails the build. Refusals are `AuditErrorReply`.
 */
export type AuditApi = {
  [K in AuditEndpointName]: { params: PathParams<(typeof AUDIT_API)[K]['path']> } & AuditApiShapes[K];
};
