import type {
  ContentCta,
  ContentForm,
  ContentHeading,
  ContentImage,
  ContentLink,
  HeadingLevel,
  PageContent,
  Section,
} from '@qa/types';
import { redactUrl } from '../../redact.js';
import { detectPageLanguage } from './language.js';
import type { RawCtaCandidate, RawPage } from './raw-page.js';

/**
 * Page Content from a RawPage (REQ-008, REQ-009): fixed rules, no AI, no request. Pure and deterministic.
 * Sections follow Q-23, CTAs follow Q-33.
 */

export interface PageContentOptions {
  /** The audited site's origin ('https://example.com'): links to its host are site paths. */
  origin: string;
  /** Longest text kept per page; longer text is cut and `textTruncated` set. */
  maxTextChars: number;
}

/** A data: image address longer than this is shortened. */
export const DATA_SRC_MAX = 80;

/** Chunk separator in `PageContent.text`. */
const CHUNK_SEPARATOR = '\n';

/** A class that marks a link styled as a button (Q-33). */
const BUTTON_CLASS = /button|btn/i;

export function buildPageContent(raw: RawPage, options: PageContentOptions): PageContent {
  const site = parseUrl(options.origin);
  const base = parseUrl(raw.url) ?? site;
  const maxTextChars = Number.isFinite(options.maxTextChars) ? Math.max(0, Math.floor(options.maxTextChars)) : 0;

  // Text and where each chunk starts in it.
  let fullText = '';
  const chunkStarts: number[] = [];
  for (const chunk of raw.textChunks) {
    const text = chunk.text ?? '';
    if (text.length > 0 && fullText.length > 0) fullText += CHUNK_SEPARATOR;
    chunkStarts.push(fullText.length);
    fullText += text;
  }
  const text = cut(fullText, maxTextChars);
  const textTruncated = text.length < fullText.length;

  // Sections: one per boundary; text before the first boundary joins the first Section.
  const sections: Section[] = [];
  const chunkSection: number[] = [];
  raw.textChunks.forEach((chunk, i) => {
    if (chunk.boundary) {
      sections.push({
        id: `s${sections.length + 1}`,
        kind: chunk.boundary.kind,
        ...(chunk.boundary.heading !== undefined ? { heading: chunk.boundary.heading } : {}),
        start: sections.length === 0 ? 0 : Math.min(chunkStarts[i], text.length),
        end: text.length,
      });
    }
    chunkSection.push(Math.max(0, sections.length - 1));
  });
  if (sections.length === 0) sections.push({ id: 's1', kind: 'page', start: 0, end: text.length });
  for (let i = 0; i < sections.length - 1; i++) sections[i].end = sections[i + 1].start;

  const sectionIdAt = (chunk: number): string => {
    const index = Number.isFinite(chunk) ? Math.floor(chunk) : -1;
    if (index < 0 || chunkSection.length === 0) return sections[0].id;
    return sections[chunkSection[Math.min(index, chunkSection.length - 1)]].id;
  };

  const headings: ContentHeading[] = raw.headings.map((h) => ({
    level: headingLevel(h.level),
    text: h.text,
    sectionId: sectionIdAt(h.chunk),
  }));

  const images: ContentImage[] = raw.images.map((img) => ({
    src: imageSrc(img.src),
    alt: img.alt,
    sectionId: sectionIdAt(img.chunk),
  }));

  const links: ContentLink[] = [];
  for (const a of raw.anchors) {
    const target = linkTarget(a.href, base, site);
    if (!target) continue;
    links.push({
      text: a.text.trim(),
      to: target.to,
      region: a.region,
      ...(target.leavesSite ? { leavesSite: true } : {}),
      sectionId: sectionIdAt(a.chunk),
    });
  }

  const forms: ContentForm[] = raw.forms.map((f) => {
    const action = f.action?.trim() ? formAction(f.action, base, site) : undefined;
    return {
      method: f.method?.trim() ? f.method.trim().toUpperCase() : 'GET',
      ...(action ? { action } : {}),
      fields: f.fields.map((field) => ({
        type: field.type,
        label: field.label,
        ...(field.name ? { name: field.name } : {}),
        required: field.required,
      })),
      sectionId: sectionIdAt(f.chunk),
    };
  });

  const ctas: ContentCta[] = [];
  for (const c of raw.ctaCandidates) {
    const cta = toCta(c, base, site);
    if (cta) ctas.push({ ...cta, sectionId: sectionIdAt(c.chunk) });
  }

  return {
    urlPath: base ? sitePath(base) : '/',
    title: raw.title,
    description: raw.description,
    text,
    ...(textTruncated ? { textTruncated: true } : {}),
    headings,
    images,
    links,
    forms,
    ctas,
    language: detectPageLanguage(text, raw.lang),
    sections,
  };
}

/** Cuts at `max` UTF-16 units, never inside a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

function headingLevel(level: number): HeadingLevel {
  const n = Number.isFinite(level) ? Math.round(level) : 1;
  return Math.min(6, Math.max(1, n)) as HeadingLevel;
}

function imageSrc(src: string): string {
  if (/^data:/i.test(src) && src.length > DATA_SRC_MAX) return `${src.slice(0, DATA_SRC_MAX)}…`;
  return redactUrl(src);
}

function parseUrl(value: string, base?: URL | null): URL | null {
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

/** A path on the site (path and query, secrets redacted, no fragment). */
function sitePath(url: URL): string {
  return redactUrl(`${url.pathname}${url.search}`);
}

function isSameSite(url: URL, site: URL | null): boolean {
  return site !== null && url.host.toLowerCase() === site.host.toLowerCase();
}

/**
 * A ContentLink target: a site path for the same host, the full address (redacted) for another host.
 * Null for tel:, mailto:, javascript:, other non-web schemes, empty and fragment-only links.
 */
function linkTarget(href: string, base: URL | null, site: URL | null): { to: string; leavesSite: boolean } | null {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const url = parseUrl(trimmed, base);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  if (isSameSite(url, site)) return { to: sitePath(url), leavesSite: false };
  return { to: redactUrl(url.href), leavesSite: true };
}

function formAction(action: string, base: URL | null, site: URL | null): string {
  const url = parseUrl(action.trim(), base);
  if (!url) return redactUrl(action.trim());
  return isSameSite(url, site) ? sitePath(url) : redactUrl(url.href);
}

/** Q-33: a button element, or a link with role=button or a class containing "button" or "btn". */
function toCta(c: RawCtaCandidate, base: URL | null, site: URL | null): Omit<ContentCta, 'sectionId'> | null {
  const text = c.text.trim();
  if (!text) return null;
  if (c.element === 'button') return { text, kind: 'button' };
  const buttonStyled = c.role?.trim().toLowerCase() === 'button' || BUTTON_CLASS.test(c.className);
  if (!buttonStyled) return null;
  const to = ctaTarget(c.href, base, site);
  return { text, kind: 'link', ...(to ? { to } : {}) };
}

/** Where a CTA link goes: a site path, a full address, the tel:/mailto: address, or a fragment. */
function ctaTarget(href: string | null, base: URL | null, site: URL | null): string | undefined {
  const trimmed = href?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('#')) return trimmed;
  const url = parseUrl(trimmed, base);
  if (!url) return undefined;
  if (url.protocol === 'tel:' || url.protocol === 'mailto:') return redactUrl(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return isSameSite(url, site) ? sitePath(url) : redactUrl(url.href);
}
