import type { LinkRegion, SectionKind } from '@qa/types';

/**
 * RawPage: the facts read from one rendered page in the browser (readPage, BE-301), before any rule runs.
 * Plain JSON, no DOM objects. `buildPageContent` turns it into Page Content; technology, hierarchy and
 * marketing rules read the other facts directly.
 *
 * Page order: text is a list of chunks in page order. Every element (heading, image, anchor, form, CTA...)
 * carries `chunk`, the index of the last text chunk at or before it in page order (-1 when it comes before
 * every chunk). The reader emits a chunk with empty text when a Section starts before any text, so an
 * element at the top of a landmark lands in that landmark's Section.
 *
 * Privacy: values typed into form fields are never read; there is no field for them.
 */

/** Where a Section starts (Q-23): a landmark element or a top-level heading. 'page' is never read. */
export type RawSectionKind = Exclude<SectionKind, 'page'>;

export interface RawSectionBoundary {
  kind: RawSectionKind;
  /** The Section's heading text, when it has one (always for kind 'heading'). */
  heading?: string;
}

/** One block of visible text, character for character. Chunks are joined with a newline. */
export interface RawTextChunk {
  text: string;
  /** Set when a new Section starts at this chunk. Chunks without it join the Section before them. */
  boundary?: RawSectionBoundary;
}

/** Index of the last text chunk at or before the element in page order; -1 before every chunk. */
interface InPageOrder {
  chunk: number;
}

export interface RawHeading extends InPageOrder {
  /** 1-6 from h1-h6 (or aria-level). */
  level: number;
  text: string;
}

export interface RawImage extends InPageOrder {
  /** The address as written (currentSrc or src). */
  src: string;
  /** The alt attribute as written; '' when empty; null when the attribute is missing. */
  alt: string | null;
}

export interface RawAnchor extends InPageOrder {
  /** The href attribute as written ('#top', '/shop', 'tel:...' all included; the builder filters). */
  href: string;
  /** Its visible text, or its aria-label when it has no text. */
  text: string;
  region: LinkRegion;
}

/** A tel: or mailto: link. */
export interface RawContactLink extends InPageOrder {
  kind: 'tel' | 'mailto';
  href: string;
  text: string;
}

/** A form field as declared. No value: values are never read (ADR 0030). */
export interface RawFormField {
  /** input type (text, email, tel...), or 'select' / 'textarea'. */
  type: string;
  /** Its label, aria-label or placeholder. '' when it has none. */
  label: string;
  name: string | null;
  required: boolean;
}

export interface RawForm extends InPageOrder {
  /** The method attribute as written; null when not set. */
  method: string | null;
  /** The action attribute as written; null when not set. */
  action: string | null;
  fields: RawFormField[];
}

/**
 * Something that may be a call to action (Q-33): a button element (including input type=submit/button)
 * or an anchor. The builder keeps buttons and button-styled anchors (role=button, or a class containing
 * "button" or "btn").
 */
export interface RawCtaCandidate extends InPageOrder {
  element: 'button' | 'a';
  text: string;
  /** The href as written, for an anchor; null for a button. */
  href: string | null;
  role: string | null;
  /** The class attribute as written ('' when none). */
  className: string;
}

/** Longest raw JSON-LD copy kept per block. */
export const JSON_LD_RAW_CAP = 4000;

export interface RawJsonLd {
  /** Every @type found in the block (any depth, @graph included); [] when it did not parse. */
  types: string[];
  /** The block's text, cut at JSON_LD_RAW_CAP characters. */
  raw: string;
}

/** One entry of the site menu, with its sub-menu. */
export interface RawMenuItem {
  text: string;
  /** The href as written; null for a menu heading that is not a link. */
  href: string | null;
  children: RawMenuItem[];
}

export interface RawBreadcrumbItem {
  text: string;
  /** The href as written; null for the current page (usually last, not a link). */
  href: string | null;
}

export interface RawPage {
  /** The page's address as loaded (after redirects). */
  url: string;
  /** null when there is no title element; '' when it is empty. */
  title: string | null;
  /** The meta description content; null when there is no meta description. */
  description: string | null;
  /** The html lang attribute as written; null when not set. */
  lang: string | null;
  textChunks: RawTextChunk[];
  headings: RawHeading[];
  images: RawImage[];
  anchors: RawAnchor[];
  contactLinks: RawContactLink[];
  forms: RawForm[];
  ctaCandidates: RawCtaCandidate[];
  /** The meta generator content; null when not set. */
  metaGenerator: string | null;
  /** Script src addresses, as written. */
  scripts: string[];
  /** Stylesheet link addresses, as written. */
  stylesheets: string[];
  /** Iframe src addresses, as written. */
  iframes: string[];
  jsonLd: RawJsonLd[];
  /** og:* and twitter:* meta keys present (keys only, e.g. 'og:title', 'twitter:card'). */
  socialMetaKeys: string[];
  /** In-page framework markers found: '__NEXT_DATA__', 'ng-version', 'astro-island', 'data-wf-site'... */
  frameworkMarkers: string[];
  /** Text of <address> elements, for NAP (name, address, phone). */
  addresses: string[];
  /** The site menu as nested in the page (header/nav). [] when there is none. */
  menu: RawMenuItem[];
  /** The breadcrumb trail in order. [] when there is none. */
  breadcrumb: RawBreadcrumbItem[];
  /**
   * The page's response headers, lower-case names, when the crawl passed them. Never set-cookie,
   * cookie or authorization: only headers that identify the platform (server, x-powered-by...).
   */
  responseHeaders?: Record<string, string>;
}
