/**
 * The improved-homepage preview sanitiser (REQ-024, ADR 0021, Q-16). The AI writes the page, so its HTML is
 * untrusted. Nothing of it is passed through as written: it is read into tokens, every element and attribute
 * is checked against an allowlist, and the page is written out again from the checked parts only.
 *
 * What the page can never hold: script, on* handlers, javascript:/data: links, meta refresh, base, iframe,
 * object, embed, forms, external stylesheets, fonts or CSS url(). Images keep only an inlined data: image
 * (see generate.ts); any other image becomes its alt text.
 */
import { createHash } from 'crypto';
import type { DocumentLanguage } from '@qa/types';
import { DOCUMENT_LANGUAGE_INFO } from '@qa/types';

// ---------------------------------------------------------------------------------------------------
// Limits

/** Longest AI answer read; anything after it is dropped. */
export const MAX_PREVIEW_SOURCE_CHARS = 300_000;
/** Longest stylesheet kept. */
export const MAX_PREVIEW_CSS_CHARS = 50_000;
const MAX_DEPTH = 200;
const MAX_TEXT_ATTR_CHARS = 500;

// ---------------------------------------------------------------------------------------------------
// The checked page

/** One checked piece of the page. Text and attribute values are decoded (plain text), never markup. */
export type PreviewNode =
  | { kind: 'text'; text: string }
  | { kind: 'open'; name: string; attrs: Array<[string, string]> }
  | { kind: 'close'; name: string };

export interface SanitizedPreview {
  nodes: PreviewNode[];
  /** The kept CSS rules, already checked. */
  css: string;
}

// ---------------------------------------------------------------------------------------------------
// Tokens

type RawToken =
  | { type: 'text'; raw: string }
  | { type: 'start'; name: string; attrs: Array<[string, string]>; selfClosing: boolean }
  | { type: 'end'; name: string }
  | { type: 'rawtext'; name: string; content: string };

/** Elements whose content is plain text up to their end tag. */
const RAW_TEXT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
]);

const TAG_NAME = /[A-Za-z][A-Za-z0-9:-]*/y;
const SPACE = /\s/;

function tokenize(html: string): RawToken[] {
  const out: RawToken[] = [];
  const n = html.length;
  let i = 0;
  let textStart = 0;
  const flushText = (end: number) => {
    if (end > textStart) out.push({ type: 'text', raw: html.slice(textStart, end) });
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    const next = html[lt + 1] ?? '';

    if (html.startsWith('<!--', lt)) {
      flushText(lt);
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? n : close + 3;
      textStart = i;
      continue;
    }
    if (next === '!' || next === '?') {
      flushText(lt);
      const close = html.indexOf('>', lt + 2);
      i = close === -1 ? n : close + 1;
      textStart = i;
      continue;
    }

    const isEnd = next === '/';
    const nameStart = lt + (isEnd ? 2 : 1);
    TAG_NAME.lastIndex = nameStart;
    const m = TAG_NAME.exec(html);
    if (!m) {
      i = lt + 1; // a lone '<' is text
      continue;
    }
    flushText(lt);
    const name = m[0].toLowerCase();
    let p = nameStart + m[0].length;

    if (isEnd) {
      const close = html.indexOf('>', p);
      i = close === -1 ? n : close + 1;
      textStart = i;
      out.push({ type: 'end', name });
      continue;
    }

    const attrs: Array<[string, string]> = [];
    let selfClosing = false;
    let closed = false;
    while (p < n) {
      const c = html[p];
      if (c === '>') {
        p++;
        closed = true;
        break;
      }
      if (SPACE.test(c)) {
        p++;
        continue;
      }
      if (c === '/') {
        if (html[p + 1] === '>') selfClosing = true;
        p++;
        continue;
      }
      const ns = p;
      while (p < n && !/[\s/>=]/.test(html[p])) p++;
      if (p === ns) p++; // a name starting with '='
      const attrName = html.slice(ns, p).toLowerCase();
      while (p < n && SPACE.test(html[p])) p++;
      let value = '';
      if (html[p] === '=') {
        p++;
        while (p < n && SPACE.test(html[p])) p++;
        const q = html[p];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, p + 1);
          if (end === -1) {
            p = n; // unterminated value: the tag and the rest are dropped
            break;
          }
          value = html.slice(p + 1, end);
          p = end + 1;
        } else {
          const vs = p;
          while (p < n && !/[\s>]/.test(html[p])) p++;
          value = html.slice(vs, p);
        }
      }
      attrs.push([attrName, decodeEntities(value)]);
    }
    if (!closed) {
      // A tag that never ends: it and everything after it are dropped.
      i = n;
      textStart = n;
      break;
    }
    i = p;
    textStart = i;

    if (RAW_TEXT.has(name)) {
      const endTag = new RegExp(`</${name}(?=[\\s/>])`, 'ig');
      endTag.lastIndex = i;
      const em = endTag.exec(html);
      out.push({ type: 'start', name, attrs, selfClosing: false });
      out.push({ type: 'rawtext', name, content: html.slice(i, em ? em.index : n) });
      out.push({ type: 'end', name });
      if (em) {
        const gt = html.indexOf('>', em.index);
        i = gt === -1 ? n : gt + 1;
      } else {
        i = n;
      }
      textStart = i;
      continue;
    }
    out.push({ type: 'start', name, attrs, selfClosing });
  }
  flushText(n);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Entities and escaping

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  tab: '\t',
  newline: '\n',
  lpar: '(',
  rpar: ')',
  sol: '/',
  bsol: '\\',
  period: '.',
  comma: ',',
  semi: ';',
  excl: '!',
  num: '#',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  rarr: '→',
  larr: '←',
  times: '×',
  deg: '°',
};

/** Decodes character references. Decoding more than a browser would only makes the checks stricter. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[0-9]{1,8}|#[xX][0-9a-fA-F]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// ---------------------------------------------------------------------------------------------------
// Elements and attributes

const ALLOWED = new Set([
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
]);

export const VOID_ELEMENTS: ReadonlySet<string> = new Set(['br', 'hr', 'img']);

/** HTML's void elements: they never have content, so dropping one never drops what follows. */
const HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Dropped with everything inside them. Any other unknown element is unwrapped: its text stays. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'applet',
  'frame',
  'frameset',
  'noscript',
  'template',
  'svg',
  'math',
  'select',
  'textarea',
  'title',
  'xmp',
  'noembed',
  'noframes',
  'plaintext',
  'audio',
  'video',
  'canvas',
  'map',
  'datalist',
  'portal',
]);

const TAG_ATTRS: Readonly<Record<string, readonly string[]>> = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  ol: ['start', 'reversed'],
  time: ['datetime'],
  details: ['open'],
};
const GLOBAL_ATTRS = new Set(['id', 'class', 'title', 'lang', 'dir', 'role', 'style']);

/** Ids and classes the page frame uses; the AI's own are dropped when they start with it. */
export const RESERVED_PREFIX = 'qa-preview';

export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CLASS_TOKEN = /^[A-Za-z_-][A-Za-z0-9_-]{0,63}$/;

function isReserved(token: string): boolean {
  return token.toLowerCase().startsWith(RESERVED_PREFIX);
}

function plainText(value: string): string | null {
  const v = value.replace(CONTROL, '').trim().slice(0, MAX_TEXT_ATTR_CHARS);
  return v === '' ? null : v;
}

/** A link target: an absolute http(s), mailto: or tel: address, or '#id'. Anything else is null. */
export function cleanHref(value: string, siteUrl: string): string | null {
  // As the URL parser does: leading/trailing C0 controls and spaces go, tabs and newlines anywhere go.
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
  if (v === '') return null;
  if (v.startsWith('#')) {
    const id = v.slice(1);
    return ID_PATTERN.test(id) ? `#${id}` : null;
  }
  let url: URL;
  try {
    url = new URL(v, siteUrl);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    url.username = '';
    url.password = '';
    return url.href;
  }
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') return url.href;
  return null;
}

/** An image address to inline later: absolute http(s) only. */
function cleanImageSrc(value: string, siteUrl: string): string | null {
  const href = cleanHref(value, siteUrl);
  return href && /^https?:/.test(href) ? href : null;
}

function cleanAttr(tag: string, name: string, value: string, siteUrl: string): string | null {
  switch (name) {
    case 'id':
      return ID_PATTERN.test(value) && !isReserved(value) ? value : null;
    case 'class': {
      const tokens = value
        .split(/\s+/)
        .filter((t) => CLASS_TOKEN.test(t) && !isReserved(t))
        .slice(0, 10);
      return tokens.length > 0 ? tokens.join(' ') : null;
    }
    case 'lang':
      return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/.test(value) ? value : null;
    case 'dir':
      return /^(ltr|rtl|auto)$/i.test(value) ? value.toLowerCase() : null;
    case 'role':
      return /^[a-z]{1,30}$/.test(value) ? value : null;
    case 'style': {
      const style = cleanDeclarations(value);
      return style === '' ? null : style;
    }
    case 'width':
    case 'height':
    case 'colspan':
    case 'rowspan':
    case 'start':
      return /^[0-9]{1,4}$/.test(value.trim()) ? value.trim() : null;
    case 'scope':
      return /^(row|col|rowgroup|colgroup)$/.test(value) ? value : null;
    case 'reversed':
    case 'open':
      return '';
    case 'datetime':
      return /^[0-9T:+\-. Z]{1,40}$/.test(value) ? value : null;
    case 'href':
      return cleanHref(value, siteUrl);
    case 'src':
      return tag === 'img' ? cleanImageSrc(value, siteUrl) : null;
    case 'title':
    case 'alt':
      return name === 'alt' ? value.replace(CONTROL, '').trim().slice(0, MAX_TEXT_ATTR_CHARS) : plainText(value);
    default:
      if (/^aria-[a-z]{2,30}$/.test(name)) return plainText(value);
      return null;
  }
}

function cleanAttrs(tag: string, attrs: Array<[string, string]>, siteUrl: string): Array<[string, string]> {
  const allowed = TAG_ATTRS[tag] ?? [];
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const [name, raw] of attrs) {
    if (seen.has(name)) continue; // the first wins, as in a browser
    seen.add(name);
    if (!GLOBAL_ATTRS.has(name) && !allowed.includes(name) && !name.startsWith('aria-')) continue;
    const value = cleanAttr(tag, name, raw, siteUrl);
    if (value !== null) out.push([name, value]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// CSS

const BAD_CSS_VALUE =
  /url\(|image-set\(|expression\(|javascript:|vbscript:|data:|src\(|attr\(|-moz-binding|behavior|@import|\\/;

/** Properties dropped whatever their value: they load, run or show text the page does not hold. */
const BAD_CSS_PROPS = new Set(['behavior', '-moz-binding', 'content', 'src', 'cursor', 'filter']);

function cleanDeclaration(decl: string): string | null {
  const colon = decl.indexOf(':');
  if (colon < 0) return null;
  const prop = decl.slice(0, colon).trim().toLowerCase();
  const value = decl.slice(colon + 1).replace(/\s+/g, ' ').trim();
  if (!/^-?[a-z][a-z-]{0,40}$/.test(prop) || BAD_CSS_PROPS.has(prop)) return null;
  if (value === '' || value.length > 500) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\<>{}@\u0000-\u001f\u007f]|\/\*/.test(value)) return null;
  const squashed = value.toLowerCase().replace(/\s+/g, '');
  if (BAD_CSS_VALUE.test(squashed)) return null;
  // Nothing may be pinned over the page frame's note.
  if (prop === 'position' && /fixed|sticky|absolute/.test(squashed)) return null;
  if (prop === 'z-index') return null;
  return `${prop}: ${value}`;
}

/** A declaration list (a style attribute or a rule body), keeping only safe declarations. */
export function cleanDeclarations(text: string): string {
  return text
    .split(';')
    .map(cleanDeclaration)
    .filter((d): d is string => d !== null)
    .join('; ');
}

const SELECTOR = /^[A-Za-z0-9\s.#:_\-[\]="'>+~*,()]{1,300}$/;

/**
 * True when every quote is closed and every `[` and `(` is closed in order. An unbalanced selector could
 * open a block that runs on into the CSS that follows it, so it is refused.
 */
function balancedSelector(selector: string): boolean {
  const stack: string[] = [];
  let quote: string | null = null;
  for (const ch of selector) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') stack.push(ch);
    else if (ch === ']') {
      if (stack.pop() !== '[') return false;
    } else if (ch === ')') {
      if (stack.pop() !== '(') return false;
    }
  }
  return quote === null && stack.length === 0;
}
const MEDIA_PRELUDE = /^@media[\sA-Za-z0-9():,.-]{1,200}$/i;

function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The class of the wrapper the AI's content is rendered in; every AI selector is scoped under it. */
export const ROOT_CLASS = 'qa-preview-root';

/** Splits a selector list at its top-level commas. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
}

/** Selectors that reach the page frame or its root: html, body, :root, [role], a leading '*' or combinator. */
function isFrameSelector(sel: string): boolean {
  if (/^[>+~*]/.test(sel)) return true;
  if (/:root/i.test(sel) || /\[\s*role/i.test(sel)) return true;
  return /(^|[\s>+~,(])(html|body)(?![A-Za-z0-9_-])/i.test(sel);
}

function cleanRules(css: string, nested: boolean, scope = false): string[] {
  const rules: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const semi = css.indexOf(';', i);
    if (semi !== -1 && semi < open) {
      i = semi + 1; // a statement such as @import or @charset: dropped
      continue;
    }
    const prelude = css.slice(i, open).trim();
    const close = matchingBrace(css, open);
    const body = css.slice(open + 1, close === -1 ? css.length : close);
    i = close === -1 ? css.length : close + 1;

    if (prelude.startsWith('@')) {
      // Only @media survives, one level deep; @import, @font-face, @namespace and the rest are dropped.
      if (!nested && MEDIA_PRELUDE.test(prelude)) {
        const inner = cleanRules(body, true, scope);
        if (inner.length > 0) rules.push(`${prelude} {\n${inner.join('\n')}\n}`);
      }
      continue;
    }
    if (!SELECTOR.test(prelude) || !balancedSelector(prelude) || prelude.toLowerCase().includes(RESERVED_PREFIX)) continue;
    const selectors = splitSelectors(prelude).filter((sel) => !isFrameSelector(sel));
    if (selectors.length === 0) continue;
    const decls = cleanDeclarations(body);
    const list = scope ? selectors.map((sel) => `.${ROOT_CLASS} ${sel}`) : selectors;
    if (decls !== '') rules.push(`${list.join(', ')} { ${decls} }`);
  }
  return rules;
}

/** A stylesheet rebuilt from its safe rules: no url(), no @import or @font-face, no escapes. */
export function cleanStylesheet(css: string, scope = false): string {
  const text = css
    .slice(0, MAX_PREVIEW_CSS_CHARS)
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/[\\<]/g, '');
  return cleanRules(text, false, scope).join('\n');
}

// ---------------------------------------------------------------------------------------------------
// Sanitising

/**
 * Reads the AI's HTML and keeps only the allowed elements and attributes. Links become absolute
 * (`siteUrl` resolves relative ones); images keep an absolute http(s) address for the inlining step.
 */
export function sanitizePreviewHtml(html: string, siteUrl: string): SanitizedPreview {
  const tokens = tokenize(String(html ?? '').slice(0, MAX_PREVIEW_SOURCE_CHARS));
  const nodes: PreviewNode[] = [];
  const css: string[] = [];
  const open: string[] = [];
  let dropName: string | null = null;
  let dropDepth = 0;

  for (const token of tokens) {
    if (dropName !== null) {
      if (token.type === 'start' && token.name === dropName && !token.selfClosing) dropDepth++;
      else if (token.type === 'end' && token.name === dropName && --dropDepth === 0) dropName = null;
      continue;
    }
    switch (token.type) {
      case 'text': {
        const text = decodeEntities(token.raw).replace(CONTROL, '');
        if (text !== '') nodes.push({ kind: 'text', text });
        break;
      }
      case 'rawtext':
        if (token.name === 'style') css.push(token.content);
        break;
      case 'start': {
        if (token.name === 'style') break; // its CSS arrives as the rawtext token after it
        if (DROP_WITH_CONTENT.has(token.name)) {
          if (!token.selfClosing && !HTML_VOID.has(token.name)) {
            dropName = token.name;
            dropDepth = 1;
          }
          break;
        }
        if (!ALLOWED.has(token.name) || open.length >= MAX_DEPTH) break; // unwrapped
        nodes.push({ kind: 'open', name: token.name, attrs: cleanAttrs(token.name, token.attrs, siteUrl) });
        if (!VOID_ELEMENTS.has(token.name)) open.push(token.name);
        break;
      }
      case 'end': {
        const at = open.lastIndexOf(token.name);
        if (at === -1) break;
        while (open.length > at) nodes.push({ kind: 'close', name: open.pop() as string });
        break;
      }
    }
  }
  while (open.length > 0) nodes.push({ kind: 'close', name: open.pop() as string });
  return { nodes, css: cleanStylesheet(css.join('\n')) };
}

// ---------------------------------------------------------------------------------------------------
// The page

const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

/**
 * The CSP hash sources (`'sha256-<base64>'`) of the exact text of each `<style>` element in `html`, in order,
 * without repeats. Style text is raw text, so it is hashed as it stands. No style element: an empty list.
 * BE-604 reuses this (through previewCspForHtml) for Shared Link pages.
 */
export function styleHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of String(html ?? '').matchAll(STYLE_ELEMENT)) {
    hashes.add(`'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

function styleSource(html: string): string {
  const hashes = styleHashes(html);
  return hashes.length > 0 ? hashes.join(' ') : "'none'";
}

/**
 * The Content-Security-Policy header of a served page (ADR 0036): strict, with styles allowed only through
 * the hashes of the page's own `<style>` elements (computed per response), never 'unsafe-inline'.
 */
export function previewCspForHtml(html: string): string {
  return `default-src 'none'; img-src data:; style-src ${styleSource(html)}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

/** The page's own meta policy, for when it is opened from the export folder (no headers there). */
function metaCsp(styleElements: string): string {
  return `default-src 'none'; img-src data:; style-src ${styleSource(styleElements)}; base-uri 'none'; form-action 'none'`;
}

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/*
 * The note sits outside the AI-styled wrapper and is pinned at a selector more specific than anything the AI
 * can write (its rules are all scoped under the wrapper). The wrapper clips and contains its content.
 */
const FRAME_CSS = `html body > div.qa-preview-root { display: flow-root; position: relative; overflow: hidden; contain: paint; isolation: isolate; z-index: 0; }
html body > p#qa-preview-note[role="note"] { display: block !important; visibility: visible !important; opacity: 1 !important; position: static !important; height: auto !important; max-height: none !important; width: auto !important; overflow: visible !important; transform: none !important; clip-path: none !important; clip: auto !important; filter: none !important; text-indent: 0 !important; z-index: 2147483647 !important; margin: 0 !important; padding: 12px 16px !important; background: #fff8d6 !important; color: #222 !important; border-bottom: 2px solid #d4a600 !important; font: 15px/1.4 system-ui, sans-serif !important; }
.qa-preview-menu { padding: 8px 16px; }
.qa-preview-menu a { margin-right: 12px; }`;

/** The visible text of the nodes (text, alt, title and aria labels), for the claim-word check. */
export function previewNodesText(nodes: readonly PreviewNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'text') parts.push(node.text);
    else if (node.kind === 'open') {
      for (const [name, value] of node.attrs) {
        if (name === 'alt' || name === 'title' || name.startsWith('aria-')) parts.push(value);
      }
    }
  }
  return parts.join(' ');
}

/**
 * Last checks on the nodes, whatever built them: an image without an inlined data: image becomes its alt
 * text, a repeated id is dropped, an in-page '#id' link to an id the page does not hold loses its href,
 * and every http(s) link opens in a new tab with rel="noopener noreferrer".
 */
export function finalizePreviewNodes(nodes: readonly PreviewNode[]): PreviewNode[] {
  const out: PreviewNode[] = [];
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'open') {
      out.push(node);
      continue;
    }
    if (node.name === 'img') {
      const src = node.attrs.find(([name]) => name === 'src')?.[1] ?? '';
      if (!DATA_IMAGE.test(src)) {
        const alt = node.attrs.find(([name]) => name === 'alt')?.[1] ?? '';
        if (alt !== '') out.push({ kind: 'text', text: alt });
        continue;
      }
    }
    let attrs = node.attrs.filter(([name, value]) => {
      if (name !== 'id') return true;
      if (!ID_PATTERN.test(value) || ids.has(value)) return false;
      ids.add(value);
      return true;
    });
    if (node.name === 'a') {
      attrs = attrs.filter(([name]) => name !== 'target' && name !== 'rel');
    }
    out.push({ kind: 'open', name: node.name, attrs });
  }

  // In-page links are checked once every id is known; web links open in a new tab.
  return out.map((node) => {
    if (node.kind !== 'open' || node.name !== 'a') return node;
    const href = node.attrs.find(([name]) => name === 'href')?.[1];
    if (href === undefined) return node;
    if (href.startsWith('#')) {
      return ids.has(href.slice(1)) ? node : { ...node, attrs: node.attrs.filter(([name]) => name !== 'href') };
    }
    if (/^https?:/i.test(href)) {
      return { ...node, attrs: [...node.attrs, ['target', '_blank'], ['rel', 'noopener noreferrer']] };
    }
    return node;
  });
}

function serializeNodes(nodes: readonly PreviewNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') out += escapeText(node.text);
    else if (node.kind === 'close') out += `</${node.name}>`;
    else {
      const attrs = node.attrs.map(([name, value]) => (value === '' && name !== 'alt' ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`));
      out += `<${node.name}${attrs.join('')}>`;
    }
  }
  return out;
}

export interface PreviewDocumentInput {
  /** The page body, checked (sanitizePreviewHtml, then any added nodes). */
  nodes: readonly PreviewNode[];
  css: string;
  language: DocumentLanguage;
  /** The audited site's host, named in the note. */
  host: string;
}

/** The fixed note at the top of every preview. English, plain, no claim words, no verdict. */
export function previewNote(host: string): string {
  return (
    `Preview of suggested changes to the homepage of ${host}. ` +
    'This is not the live site: it was written with AI from the Website Audit, and nothing on the site was changed.'
  );
}

/** One self-contained HTML page: no script, no external resources, the note first. */
export function renderPreviewDocument(input: PreviewDocumentInput): string {
  const info = DOCUMENT_LANGUAGE_INFO[input.language] ?? DOCUMENT_LANGUAGE_INFO.en;
  const lang = DOCUMENT_LANGUAGE_INFO[input.language] ? input.language : 'en';
  const body = serializeNodes(finalizePreviewNodes(input.nodes));
  // The CSS was rebuilt from checked rules; this drops any '<' once more so the style element cannot end early.
  // The frame rules live in their own element, after the AI's, so no AI rule can swallow or hide them.
  const aiStyle = `<style>\n${cleanStylesheet(input.css, true).replace(/</g, '')}\n</style>`;
  const frameStyle = `<style>\n${FRAME_CSS}\n</style>`;
  return [
    '<!DOCTYPE html>',
    `<html lang="${lang}" dir="${info.dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(metaCsp(`${aiStyle}${frameStyle}`))}">`,
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeText(`Preview of suggested changes: ${input.host}`)}</title>`,
    aiStyle,
    frameStyle,
    '</head>',
    '<body>',
    `<p id="qa-preview-note" role="note">${escapeText(previewNote(input.host))}</p>`,
    `<div class="${ROOT_CLASS}">`,
    body,
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
