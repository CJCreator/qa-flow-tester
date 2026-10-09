import { RobotsPolicy } from '../competitive/robots.js';
import { isSameSite } from '../same-site.js';
import { safeGet, type NetDeps } from '../safe-net.js';

export const DOCS_MAX_PAGES = 20;
export const DOCS_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const ROBOTS_TOKEN = 'qa-flow-tester';

export type DocsGetResult =
  | { ok: true; status: number; finalUrl: string; contentType: string; body: string }
  | { ok: false; why: string };

/** One GET. Must follow redirects itself and enforce `maxBytes`; fetchDocsPages re-checks the final address. */
export type DocsGet = (url: string, opts: { maxBytes: number }) => Promise<DocsGetResult>;

export interface DocsFetchOptions {
  get?: DocsGet;
  maxPages?: number;
  maxBytes?: number;
  /** Same-site rule; defaults to `isSameSite`. */
  sameSite?: (host: string, siteHost: string) => boolean;
  /** Robots policy for the docs host; fetched through `get` when omitted. */
  robots?: RobotsPolicy;
}

export interface DocsFetchResult {
  docs: Array<{ name: string; text: string }>;
  skipped: Array<{ url: string; why: string }>;
}

function headerText(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/** Beta-safe getter: every hop resolves to a public address (safe-net). Used when this machine is shared. */
export function makeGuardedDocsGet(deps?: NetDeps): DocsGet {
  return async (url, opts) => {
    const res = await safeGet(url, { maxBytes: opts.maxBytes, headers: { Accept: 'text/html, text/markdown, text/plain' } }, deps);
    if (!res.ok) return { ok: false, why: `blocked (${res.reason})` };
    return {
      ok: true,
      status: res.status,
      finalUrl: res.finalUrl,
      contentType: headerText(res.headers['content-type']),
      body: res.body,
    };
  };
}

/** Getter for the owner's own machine: plain fetch, redirects followed by hand, http(s) only, size capped. */
export const localDocsGet: DocsGet = async (url, opts) => {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false, why: 'not a web address' };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return { ok: false, why: 'only http and https addresses are read' };
    let res: Response;
    try {
      res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Accept: 'text/html, text/markdown, text/plain' } });
    } catch {
      return { ok: false, why: 'could not be reached' };
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, why: 'bad redirect' };
      }
      continue;
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > opts.maxBytes) return { ok: false, why: 'too large' };
    let body = '';
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            await reader.cancel();
            return { ok: false, why: 'too large' };
          }
          body += decoder.decode(value, { stream: true });
        }
      }
    } catch {
      return { ok: false, why: 'could not be read' };
    }
    return { ok: true, status: res.status, finalUrl: current.toString(), contentType: res.headers.get('content-type') ?? '', body };
  }
  return { ok: false, why: 'too many redirects' };
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Reduces a docs page to text. Headings become `#` lines (so they act as sections), list items become `- ` lines. */
export function htmlToDoc(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => {
    const text = inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? `\n${'#'.repeat(Number(level))} ${text}\n` : '\n';
  });
  s = s
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|pre|blockquote)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((l, i, all) => l.length > 0 || (i > 0 && all[i - 1].length > 0))
    .join('\n')
    .trim();
}

function linksOf(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      u.hash = '';
      out.push(u.toString());
    } catch {
      /* ignore bad link */
    }
  }
  return out;
}

function isDocType(contentType: string): 'html' | 'text' | null {
  const t = contentType.toLowerCase();
  if (t.includes('text/html')) return 'html';
  if (t.includes('text/markdown') || t.includes('text/x-markdown')) return 'text';
  return null;
}

/**
 * Reads a docs page and the pages it links to on the same site (at most `maxPages`). Only text/html and
 * text/markdown, 1 MB each, robots honoured, every redirect target re-checked against the start host.
 * Never throws: problems are listed in `skipped`.
 */
export async function fetchDocsPages(startUrl: string, options: DocsFetchOptions = {}): Promise<DocsFetchResult> {
  const get = options.get ?? localDocsGet;
  const maxPages = options.maxPages ?? DOCS_MAX_PAGES;
  const maxBytes = options.maxBytes ?? DOCS_MAX_BYTES;
  const sameSite = options.sameSite ?? isSameSite;
  const docs: DocsFetchResult['docs'] = [];
  const skipped: DocsFetchResult['skipped'] = [];

  let start: URL;
  try {
    start = new URL(startUrl);
  } catch {
    return { docs, skipped: [{ url: startUrl, why: 'not a web address' }] };
  }
  if (start.protocol !== 'http:' && start.protocol !== 'https:') {
    return { docs, skipped: [{ url: startUrl, why: 'only http and https addresses are read' }] };
  }
  start.hash = '';

  let robots = options.robots;
  if (!robots) {
    const r = await get(new URL('/robots.txt', start).toString(), { maxBytes }).catch(() => null);
    robots = r && r.ok && r.status >= 200 && r.status < 300 ? RobotsPolicy.parse(r.body, ROBOTS_TOKEN) : RobotsPolicy.allowAll();
  }

  const seen = new Set<string>([start.toString()]);
  const queue: string[] = [start.toString()];
  while (queue.length > 0 && docs.length < maxPages) {
    const url = queue.shift() as string;
    const u = new URL(url);
    if (!robots.isAllowed(u.pathname + u.search)) {
      skipped.push({ url, why: 'robots.txt does not allow it' });
      continue;
    }
    let res: DocsGetResult;
    try {
      res = await get(url, { maxBytes });
    } catch {
      skipped.push({ url, why: 'could not be reached' });
      continue;
    }
    if (!res.ok) {
      skipped.push({ url, why: res.why });
      continue;
    }
    let final: URL;
    try {
      final = new URL(res.finalUrl);
    } catch {
      skipped.push({ url, why: 'bad redirect' });
      continue;
    }
    if ((final.protocol !== 'http:' && final.protocol !== 'https:') || !sameSite(final.host, start.host)) {
      skipped.push({ url, why: 'redirected to another site' });
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      skipped.push({ url, why: `answered ${res.status}` });
      continue;
    }
    if (Buffer.byteLength(res.body, 'utf8') > maxBytes) {
      skipped.push({ url, why: 'too large' });
      continue;
    }
    const kind = isDocType(res.contentType);
    if (!kind) {
      skipped.push({ url, why: 'not an HTML or Markdown page' });
      continue;
    }
    const text = kind === 'html' ? htmlToDoc(res.body) : res.body.trim();
    if (text) docs.push({ name: final.toString(), text });
    if (kind === 'html') {
      for (const link of linksOf(res.body, final.toString())) {
        let l: URL;
        try {
          l = new URL(link);
        } catch {
          continue;
        }
        if ((l.protocol !== 'http:' && l.protocol !== 'https:') || !sameSite(l.host, start.host)) continue;
        if (seen.has(l.toString())) continue;
        seen.add(l.toString());
        queue.push(l.toString());
      }
    }
  }
  if (queue.length > 0 && docs.length >= maxPages) {
    skipped.push({ url: queue[0], why: `only the first ${maxPages} pages are read` });
  }
  return { docs, skipped };
}
