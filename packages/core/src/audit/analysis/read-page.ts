import type { Page } from 'playwright';
import type { PageContent } from '@qa/types';
import { buildPageContent } from './page-content.js';
import { JSON_LD_RAW_CAP, type RawPage } from './raw-page.js';

/**
 * readPage (REQ-007, REQ-008, REQ-009): reads the rendered page that is open into a RawPage in one
 * `page.evaluate`, then builds its Page Content. Read-only by construction: it reads DOM properties and
 * attributes only. It never clicks, fills, submits, navigates or makes a request, so the crawl calls it
 * while each recorded page is open and a page is visited once.
 *
 * Head facts reuse the selectors of the SEO checker's collectDetails (packages/checkers/src/seo.ts),
 * copied into the evaluate so the checker is unchanged.
 *
 * Throws what `page.evaluate` throws (page closed, navigated away mid-read); the caller decides.
 */

export interface ReadPageOptions {
  /** The page's response headers, when the crawl has them. set-cookie, cookie and authorization are dropped. */
  responseHeaders?: Record<string, string>;
  /** Longest text kept per page (default READ_PAGE_MAX_TEXT_CHARS). */
  maxTextChars?: number;
}

export interface ReadPageResult {
  raw: RawPage;
  content: PageContent;
}

/** Default longest text kept per page. */
export const READ_PAGE_MAX_TEXT_CHARS = 100_000;

/** Headers that carry credentials or session state: never kept in a RawPage. */
const SECRET_HEADERS = new Set(['set-cookie', 'set-cookie2', 'cookie', 'authorization', 'proxy-authorization']);

type DomFacts = Omit<RawPage, 'url' | 'responseHeaders'>;

export async function readPage(page: Page, options: ReadPageOptions = {}): Promise<ReadPageResult> {
  const maxTextChars =
    typeof options.maxTextChars === 'number' && Number.isFinite(options.maxTextChars)
      ? Math.max(0, Math.floor(options.maxTextChars))
      : READ_PAGE_MAX_TEXT_CHARS;

  const facts: DomFacts = await page.evaluate(readDom, { maxTextChars, jsonLdCap: JSON_LD_RAW_CAP });

  const url = page.url();
  const raw: RawPage = { url, ...facts };
  const headers = safeHeaders(options.responseHeaders);
  if (headers) raw.responseHeaders = headers;

  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    // about:blank and the like: buildPageContent treats every link as leaving the site.
  }
  return { raw, content: buildPageContent(raw, { origin, maxTextChars }) };
}

function safeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (SECRET_HEADERS.has(key) || typeof value !== 'string') continue;
    kept[key] = value;
  }
  return kept;
}

/**
 * Runs in the browser. Self-contained: no imports, no outer variables. Reads only; values typed into
 * form fields (input value, textarea content, selected option) are never read.
 */
function readDom(args: { maxTextChars: number; jsonLdCap: number }): DomFacts {
  type Kind = 'header' | 'nav' | 'main' | 'aside' | 'footer' | 'region' | 'heading';
  type Boundary = { kind: Kind; heading?: string };
  type MenuItem = { text: string; href: string | null; children: MenuItem[] };

  const WS = /[ \t\n\r\f]+/g;
  const clean = (s: string | null | undefined) => (s || '').replace(WS, ' ').trim();
  const hasText = (s: string) => /[^ \t\n\r\f]/.test(s);
  const BREADCRUMB = '[aria-label*="breadcrumb" i], [class*="breadcrumb" i], [itemtype*="BreadcrumbList"]';
  const MENU = 'nav, header, [role="navigation"], [role="banner"]';
  const FOOTER = 'footer, [role="contentinfo"]';
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'head']);
  // Leaves: their children are not page text (a textarea's content is its value; options are choices).
  const LEAF = new Set(['textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'canvas']);
  const ROLE_KIND: Record<string, Kind> = {
    banner: 'header',
    navigation: 'nav',
    main: 'main',
    complementary: 'aside',
    contentinfo: 'footer',
    region: 'region',
  };

  /** The landmark kind of an element, or null. header/footer inside sectioning content are not landmarks. */
  const landmarkKind = (el: Element): Kind | null => {
    const role = (el.getAttribute('role') || '').trim().toLowerCase();
    if (role) return ROLE_KIND[role] ?? null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'nav' || tag === 'main' || tag === 'aside') return tag;
    if (tag === 'header' || tag === 'footer') {
      return el.parentElement?.closest('article, aside, main, nav, section') ? null : tag;
    }
    return null;
  };

  /** True when no ancestor is a landmark other than main. */
  const outsideLandmarks = (el: Element): boolean => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const kind = landmarkKind(p);
      if (kind && kind !== 'main') return false;
    }
    return true;
  };

  const headingLevel = (el: Element): number | null => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return Number(tag[1]);
    if ((el.getAttribute('role') || '').trim().toLowerCase() === 'heading') {
      const level = parseInt(el.getAttribute('aria-level') || '2', 10);
      return Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 2;
    }
    return null;
  };

  const linkRegion = (a: Element): 'breadcrumb' | 'menu' | 'footer' | 'internal' => {
    if (a.closest(BREADCRUMB)) return 'breadcrumb';
    if (a.closest(MENU)) return 'menu';
    if (a.closest(FOOTER)) return 'footer';
    return 'internal';
  };

  const anchorText = (a: Element): string =>
    clean(a.textContent) ||
    clean(a.getAttribute('aria-label')) ||
    clean(a.querySelector('img[alt]')?.getAttribute('alt'));

  // ---- Text chunks in page order, with Section boundaries ----
  const textChunks: DomFacts['textChunks'] = [];
  let buffer = '';
  let pending: Boundary | null = null;
  let collected = 0;

  const flush = () => {
    const text = clean(buffer);
    buffer = '';
    if (!text) return;
    textChunks.push(pending ? { text, boundary: pending } : { text });
    pending = null;
    collected += text.length + 1;
  };
  const startBoundary = (b: Boundary) => {
    flush();
    // A boundary that nothing landed in yet is replaced (main directly followed by its first heading).
    pending = b;
  };
  /** The chunk index of an element at the current position (materializes a pending boundary). */
  const here = (): number => {
    if (hasText(buffer)) return textChunks.length;
    if (pending) {
      textChunks.push({ text: '', boundary: pending });
      pending = null;
    }
    return textChunks.length - 1;
  };
  const appendText = (s: string) => {
    // Past the text cap only boundaries and element positions matter; buildPageContent cuts exactly.
    if (collected > args.maxTextChars) return;
    buffer += s;
  };

  const headings: DomFacts['headings'] = [];
  const images: DomFacts['images'] = [];
  const anchors: DomFacts['anchors'] = [];
  const contactLinks: DomFacts['contactLinks'] = [];
  const forms: DomFacts['forms'] = [];
  const ctaCandidates: DomFacts['ctaCandidates'] = [];

  const fieldLabel = (field: Element): string => {
    const aria = clean(field.getAttribute('aria-label'));
    if (aria) return aria;
    const labelledBy = (field.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const byIds = clean(labelledBy.map((id) => document.getElementById(id)?.textContent || '').join(' '));
    if (byIds) return byIds;
    const id = field.getAttribute('id');
    if (id) {
      try {
        const forLabel = clean(document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent);
        if (forLabel) return forLabel;
      } catch {
        // An id CSS cannot escape: fall through.
      }
    }
    const wrapping = clean(field.closest('label')?.textContent);
    if (wrapping) return wrapping;
    return clean(field.getAttribute('placeholder'));
  };

  const readForm = (form: Element, chunk: number) => {
    const fields: DomFacts['forms'][number]['fields'] = [];
    for (const field of Array.from(form.querySelectorAll('input, select, textarea'))) {
      const tag = field.tagName.toLowerCase();
      const type = tag === 'input' ? (field.getAttribute('type') || 'text').trim().toLowerCase() : tag;
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
      fields.push({
        type,
        label: fieldLabel(field),
        name: field.getAttribute('name'),
        required: field.hasAttribute('required') || field.getAttribute('aria-required') === 'true',
      });
    }
    forms.push({ method: form.getAttribute('method'), action: form.getAttribute('action'), fields, chunk });
  };

  const visit = (el: Element, parentHidden: boolean) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return;

    let hidden = parentHidden;
    let block = false;
    let ownTextVisible = !parentHidden;
    if (!parentHidden) {
      const style = getComputedStyle(el);
      if (style.display === 'none') {
        hidden = true;
        ownTextVisible = false;
      } else {
        block = !(style.display.startsWith('inline') || style.display === 'contents');
        ownTextVisible = style.visibility === 'visible';
      }
    }

    const landmark = hidden ? null : landmarkKind(el);
    const boundaryLandmark = landmark !== null && outsideLandmarks(el) ? landmark : null;
    const level = headingLevel(el);

    if (block) flush();
    if (boundaryLandmark) startBoundary({ kind: boundaryLandmark });
    else if (!hidden && level !== null && level <= 2 && outsideLandmarks(el)) {
      startBoundary({ kind: 'heading', heading: clean(el.textContent) });
    }
    if (tag === 'br' && !hidden) flush();

    if (tag === 'img') {
      const src = el.getAttribute('src') || (el as HTMLImageElement).currentSrc || '';
      images.push({ src, alt: el.getAttribute('alt'), chunk: here() });
    }
    if (tag === 'form') readForm(el, here());

    if (!LEAF.has(tag)) {
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (ownTextVisible) appendText((child as Text).data);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          visit(child as Element, hidden);
        }
      }
    }

    // Facts recorded after their own text, so they land in the chunk that holds it.
    if (level !== null) headings.push({ level, text: clean(el.textContent), chunk: here() });
    if (tag === 'a' && el.hasAttribute('href')) {
      const href = el.getAttribute('href') || '';
      const text = anchorText(el);
      const chunk = here();
      anchors.push({ href, text, region: linkRegion(el), chunk });
      const scheme = href.trim().toLowerCase();
      if (scheme.startsWith('tel:')) contactLinks.push({ kind: 'tel', href, text, chunk });
      else if (scheme.startsWith('mailto:')) contactLinks.push({ kind: 'mailto', href, text, chunk });
    }
    if (!hidden) {
      const role = el.getAttribute('role');
      const className = el.getAttribute('class') || '';
      if (tag === 'a' && (el.hasAttribute('href') || role)) {
        const href = el.getAttribute('href');
        ctaCandidates.push({ element: 'a', text: anchorText(el), href, role, className, chunk: here() });
      } else if (tag === 'button') {
        const text = clean(el.textContent) || clean(el.getAttribute('aria-label'));
        ctaCandidates.push({ element: 'button', text, href: null, role, className, chunk: here() });
      } else if (tag === 'input') {
        const type = (el.getAttribute('type') || '').trim().toLowerCase();
        // The value attribute of a submit or button input is its label, never typed data.
        if (type === 'submit' || type === 'button') {
          const text =
            clean(el.getAttribute('value')) || clean(el.getAttribute('aria-label')) || (type === 'submit' ? 'Submit' : '');
          ctaCandidates.push({ element: 'button', text, href: null, role, className, chunk: here() });
        }
      }
    }

    if (block) flush();
    // Text after a landmark nested in main belongs to main again.
    if (boundaryLandmark && boundaryLandmark !== 'main' && el.parentElement?.closest('main')) {
      startBoundary({ kind: 'main' });
    }
  };

  if (document.body) visit(document.body, false);
  flush();

  // ---- Head and page-wide facts (selectors as in the SEO checker's collectDetails) ----
  const titleEl = document.querySelector('title');
  const metaDescEl = document.querySelector('meta[name="description"]');
  const generatorEl = document.querySelector('meta[name="generator"]');

  const attrs = (selector: string, name: string) =>
    Array.from(document.querySelectorAll(selector))
      .map((el) => el.getAttribute(name) || '')
      .filter((v) => v.trim() !== '');

  const jsonLd: DomFacts['jsonLd'] = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
    (script) => {
      const text = script.textContent || '';
      const types: string[] = [];
      const addType = (t: unknown) => {
        if (typeof t === 'string' && t && !types.includes(t)) types.push(t);
      };
      const walk = (value: unknown, depth: number) => {
        if (depth > 20 || value === null || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          for (const item of value) walk(item, depth + 1);
          return;
        }
        const record = value as Record<string, unknown>;
        const t = record['@type'];
        if (Array.isArray(t)) t.forEach(addType);
        else addType(t);
        for (const v of Object.values(record)) walk(v, depth + 1);
      };
      try {
        walk(JSON.parse(text), 0);
      } catch {
        // Not valid JSON: types stays [].
      }
      return { types, raw: text.slice(0, args.jsonLdCap) };
    }
  );

  const socialMetaKeys: string[] = [];
  for (const meta of Array.from(document.querySelectorAll('meta[property], meta[name]'))) {
    for (const key of [meta.getAttribute('property'), meta.getAttribute('name')]) {
      const k = (key || '').trim().toLowerCase();
      if ((k.startsWith('og:') || k.startsWith('twitter:')) && !socialMetaKeys.includes(k)) socialMetaKeys.push(k);
    }
  }

  const MARKERS: Array<[string, string]> = [
    ['#__NEXT_DATA__', '__NEXT_DATA__'],
    ['#__next', '__next'],
    ['[ng-version]', 'ng-version'],
    ['astro-island', 'astro-island'],
    ['[data-wf-site]', 'data-wf-site'],
    ['#__nuxt', '__nuxt'],
    ['[data-v-app]', 'data-v-app'],
    ['[data-server-rendered]', 'data-server-rendered'],
    ['#___gatsby', '___gatsby'],
    ['[data-reactroot]', 'data-reactroot'],
  ];
  const frameworkMarkers = MARKERS.filter(([selector]) => document.querySelector(selector) !== null).map(([, m]) => m);

  const addresses = Array.from(document.querySelectorAll('address'))
    .map((el) => ((el as HTMLElement).innerText || el.textContent || '').trim())
    .filter(Boolean);

  // ---- Site menu: the nav in the header first, else the first nav that is not a breadcrumb or in the footer ----
  const navs = Array.from(document.querySelectorAll('nav, [role="navigation"]')).filter(
    (nav) => !nav.matches(BREADCRUMB) && !nav.closest(BREADCRUMB) && !nav.closest(FOOTER)
  );
  const menuNav = navs.find((nav) => nav.closest('header, [role="banner"]')) ?? navs[0];
  const ownLink = (li: Element) =>
    Array.from(li.querySelectorAll('a[href]')).find((a) => a.parentElement?.closest('li') === li) ?? null;
  const readItems = (list: Element): MenuItem[] =>
    Array.from(list.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((li) => {
        const link = ownLink(li);
        const subLists = Array.from(li.querySelectorAll('ul, ol')).filter(
          (sub) => sub.parentElement?.closest('li') === li
        );
        let text = link ? anchorText(link) : '';
        if (!link) {
          text = clean(
            Array.from(li.childNodes)
              .filter((n) => !(n.nodeType === Node.ELEMENT_NODE && /^(ul|ol)$/i.test((n as Element).tagName)))
              .map((n) => n.textContent || '')
              .join(' ')
          );
        }
        return { text, href: link ? link.getAttribute('href') : null, children: subLists.flatMap(readItems) };
      });
  let menu: MenuItem[] = [];
  if (menuNav) {
    const topList = menuNav.querySelector('ul, ol');
    menu = topList
      ? readItems(topList)
      : Array.from(menuNav.querySelectorAll('a[href]')).map((a) => ({
          text: anchorText(a),
          href: a.getAttribute('href'),
          children: [],
        }));
  }

  // ---- Breadcrumb trail, in order ----
  const breadcrumb: DomFacts['breadcrumb'] = [];
  const crumbs = document.querySelector(BREADCRUMB);
  if (crumbs) {
    let items = Array.from(crumbs.querySelectorAll('li')).filter((li) => !li.querySelector('li'));
    if (items.length === 0) items = Array.from(crumbs.querySelectorAll('[itemprop="itemListElement"]'));
    if (items.length > 0) {
      for (const item of items) {
        const link = item.matches('a[href]') ? item : item.querySelector('a[href]');
        breadcrumb.push({ text: clean(item.textContent), href: link ? link.getAttribute('href') : null });
      }
    } else {
      for (const el of Array.from(crumbs.querySelectorAll('a[href], [aria-current]'))) {
        breadcrumb.push({ text: clean(el.textContent), href: el.matches('a[href]') ? el.getAttribute('href') : null });
      }
    }
  }

  return {
    title: titleEl ? document.title : null,
    description: metaDescEl ? metaDescEl.getAttribute('content') || '' : null,
    lang: document.documentElement.getAttribute('lang'),
    textChunks,
    headings,
    images,
    anchors,
    contactLinks,
    forms,
    ctaCandidates,
    metaGenerator: generatorEl ? generatorEl.getAttribute('content') || '' : null,
    scripts: attrs('script[src]', 'src'),
    stylesheets: attrs('link[rel~="stylesheet" i][href]', 'href'),
    iframes: attrs('iframe[src]', 'src'),
    jsonLd,
    socialMetaKeys,
    frameworkMarkers,
    addresses,
    menu,
    breadcrumb,
  };
}
