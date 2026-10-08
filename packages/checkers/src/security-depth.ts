import type { Page } from 'playwright';
import type { Breakpoint, Finding, FindingSeverity } from '@qa/types';

/**
 * Deeper passive security checks (T-22): missing integrity attributes, reachable source maps,
 * security.txt, weaker Content-Security-Policy settings. Plain GETs to the page's own site only,
 * no redirects followed, 3 s timeout. Evidence is origin + path only (ADR 0016); wording follows
 * ADR 0018 (no claim that the site is safe).
 */

export interface SecurityDepthContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
  urlPath: string;
  baseUrl?: string;
  /** Run-wide memory of facts already reported once (shared with the other checkers). */
  siteWide?: Set<string>;
  /** Content-Security-Policy header of the page's main response, when one was sent. */
  cspHeader?: string;
}

export interface FetchedResponse {
  status: number;
  headers: Record<string, string>;
  text: () => Promise<string>;
}
/** Returns null when the request could not be made (network error, timeout, no request API). */
export type FetchFn = (url: string) => Promise<FetchedResponse | null>;

export interface ResourceTag {
  tag: 'script' | 'link';
  url: string;
  hasIntegrity: boolean;
}

const MAX_SRI = 10;
const MAX_MAP_SCRIPTS = 5;
const FETCH_TIMEOUT_MS = 3000;

/** GET through the browser context's request API: no redirects, short timeout, body not kept. */
export function defaultFetch(page: Page): FetchFn {
  return async (url) => {
    try {
      const request = page.context()?.request;
      if (!request) return null;
      const res = await request.fetch(url, { method: 'GET', timeout: FETCH_TIMEOUT_MS, maxRedirects: 0 });
      return { status: res.status(), headers: res.headers(), text: () => res.text() };
    } catch {
      return null;
    }
  };
}

/** Refuses (returns null without calling fetchFn) any URL whose origin differs from `origin`. */
export async function sameOriginGet(fetchFn: FetchFn, url: string, origin: string): Promise<FetchedResponse | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.origin !== origin) return null;
  return fetchFn(target.toString());
}

/** Cross-origin scripts and stylesheets with no integrity attribute. */
export function findMissingSri(tags: ResourceTag[], pageOrigin: string): ResourceTag[] {
  return tags.filter((t) => {
    if (t.hasIntegrity) return false;
    try {
      const u = new URL(t.url);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== pageOrigin;
    } catch {
      return false;
    }
  });
}

/** Required fields of RFC 9116 and whether Expires is past. `now` is injected for tests. */
export function parseSecurityTxt(text: string, now: Date): { missing: string[]; expired: boolean } {
  const missing: string[] = [];
  const lines = text.split(/\r?\n/);
  const hasContact = lines.some((l) => /^\s*contact\s*:\s*\S/i.test(l));
  if (!hasContact) missing.push('Contact');
  const expiresLine = lines.find((l) => /^\s*expires\s*:/i.test(l));
  let expired = false;
  if (!expiresLine) {
    missing.push('Expires');
  } else {
    const ms = Date.parse(expiresLine.replace(/^\s*expires\s*:/i, '').trim());
    if (Number.isNaN(ms)) missing.push('Expires (a valid date)');
    else expired = ms < now.getTime();
  }
  return { missing, expired };
}

const NONCE_OR_HASH = /^'(?:nonce-|sha256-|sha384-|sha512-)/i;
const BROAD_SOURCES = new Set(['*', 'http:', 'https:', 'data:']);

function parseCsp(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0].toLowerCase();
    if (!out.has(name)) out.set(name, tokens.slice(1));
  }
  return out;
}

function originPath(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return '';
  }
}

function pageOriginOf(page: Page): string | null {
  try {
    const u = new URL(page.url());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export class SecurityDepthChecker {
  /** Run all four checks. Each is guarded: one failing never hides the others. */
  async checkPage(page: Page, context: SecurityDepthContext, fetchFn?: FetchFn): Promise<Finding[]> {
    const findings: Finding[] = [];
    const pageOrigin = pageOriginOf(page);
    if (!pageOrigin) return findings;
    // Network checks stay on the Check-up's own site: a page that wandered off it is not probed.
    let onTarget = true;
    if (context.baseUrl) {
      try {
        onTarget = new URL(context.baseUrl).origin === pageOrigin;
      } catch {
        onTarget = false;
      }
    }
    const get = fetchFn ?? defaultFetch(page);
    const steps: Array<() => Promise<Finding[]> | Finding[]> = [
      () => this.checkSri(page, context),
      () => this.checkCsp(context.cspHeader, context),
    ];
    if (onTarget) {
      steps.push(
        () => this.checkSourceMaps(page, context, get),
        () => this.checkSecurityTxt(get, context, pageOrigin)
      );
    }
    for (const step of steps) {
      try {
        findings.push(...(await step()));
      } catch {
        // A check that cannot run adds nothing; the others still report.
      }
    }
    return findings;
  }

  // --- SRI -------------------------------------------------------------------------------

  async checkSri(page: Page, context: SecurityDepthContext): Promise<Finding[]> {
    const pageOrigin = pageOriginOf(page);
    if (!pageOrigin) return [];
    const tags = await collectResources(page);
    const missing = findMissingSri(tags, pageOrigin).slice(0, MAX_SRI);
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const t of missing) {
      const shown = originPath(t.url);
      if (!shown || seen.has(shown)) continue;
      seen.add(shown);
      const host = new URL(t.url).host;
      const kind = t.tag === 'script' ? 'Script' : 'Stylesheet';
      findings.push(
        this.finding('SRI', findings.length + 1, context, {
          title: `${kind} from ${host} loads without an integrity attribute`,
          severity: t.tag === 'script' ? 'Minor' : 'Suggestion',
          expected: `A ${kind.toLowerCase()} loaded from another site carries an integrity attribute (subresource integrity)`,
          actual: `${shown} has no integrity attribute, so the browser cannot tell if the file was changed (automatic check only)`,
          steps: [`Open ${context.urlPath}`, `Look at the ${t.tag === 'script' ? 'script' : 'link'} tag for ${shown}`],
          resolution:
            'Add an integrity attribute with the file hash and crossorigin="anonymous", or host the file on your own site.',
        })
      );
    }
    return findings;
  }

  // --- Source maps -----------------------------------------------------------------------

  async checkSourceMaps(page: Page, context: SecurityDepthContext, fetchFn?: FetchFn): Promise<Finding[]> {
    const pageOrigin = pageOriginOf(page);
    if (!pageOrigin) return [];
    const get = fetchFn ?? defaultFetch(page);
    const tags = await collectResources(page);
    const scripts: string[] = [];
    for (const t of tags) {
      if (t.tag !== 'script') continue;
      const key = originPath(t.url);
      if (!key || new URL(t.url).origin !== pageOrigin) continue;
      if (scripts.some((s) => originPath(s) === key)) continue;
      if (context.siteWide?.has(`sourcemap:${key}`)) continue;
      scripts.push(t.url);
      if (scripts.length >= MAX_MAP_SCRIPTS) break;
    }
    const findings: Finding[] = [];
    for (const scriptUrl of scripts) {
      context.siteWide?.add(`sourcemap:${originPath(scriptUrl)}`);
      try {
        const res = await sameOriginGet(get, scriptUrl, pageOrigin);
        if (!res || res.status < 200 || res.status >= 300) continue;
        const body = await res.text();
        const tail = body.slice(-1024);
        const m = /\/\/[#@]\s*sourceMappingURL=(\S+)/.exec(tail);
        const ref = m?.[1] ?? res.headers['sourcemap'] ?? res.headers['x-sourcemap'];
        if (!ref) continue;
        if (/^data:/i.test(ref)) {
          findings.push(
            this.sourceMapFinding(context, findings.length + 1, scriptUrl, `embedded in ${originPath(scriptUrl)}`)
          );
          continue;
        }
        const mapUrl = new URL(ref, scriptUrl).toString();
        const mapRes = await sameOriginGet(get, mapUrl, pageOrigin);
        if (!mapRes || mapRes.status !== 200) continue;
        const head = (await mapRes.text()).slice(0, 2048).trimStart();
        if (!head.startsWith('{') || !(head.includes('"mappings"') || head.includes('"sources"'))) continue;
        findings.push(this.sourceMapFinding(context, findings.length + 1, scriptUrl, new URL(mapUrl).pathname));
      } catch {
        // One script that cannot be read is skipped quietly.
      }
    }
    return findings;
  }

  private sourceMapFinding(context: SecurityDepthContext, n: number, scriptUrl: string, where: string): Finding {
    return this.finding('SOURCEMAP', n, context, {
      title: 'Source map is publicly reachable',
      severity: 'Minor',
      expected: 'Production scripts do not expose a source map to every visitor',
      actual: `A source map for ${new URL(scriptUrl).pathname} can be read (${where}); it can show the original source code (automatic check only)`,
      steps: [
        `Open ${context.urlPath}`,
        `Fetch ${new URL(scriptUrl).pathname} and read its last line`,
        'Fetch the file it points to',
      ],
      resolution: 'Do not publish .map files with production builds, or serve them only to signed-in developers.',
    });
  }

  // --- security.txt ----------------------------------------------------------------------

  async checkSecurityTxt(
    fetchFn: FetchFn,
    context: SecurityDepthContext,
    origin?: string,
    now: Date = new Date()
  ): Promise<Finding[]> {
    let site = origin;
    if (!site) {
      try {
        site = new URL(context.baseUrl ?? '').origin;
      } catch {
        return [];
      }
    }
    if (!/^https?:\/\//i.test(site)) return [];
    const key = `security.txt:${site}`;
    if (context.siteWide?.has(key)) return [];
    context.siteWide?.add(key);

    const url = `${site}/.well-known/security.txt`;
    const res = await sameOriginGet(fetchFn, url, site);
    const base = {
      steps: [`Open ${url}`],
      resolution:
        'Publish /.well-known/security.txt with a Contact line and an Expires date (RFC 9116), so people can report problems.',
    };
    if (!res) {
      return [
        {
          ...this.finding('TXT', 1, context, {
            title: 'security.txt could not be checked',
            severity: 'Suggestion',
            expected: 'The file at /.well-known/security.txt can be read',
            actual: 'The request failed or timed out, so this check could not say whether the file exists',
            ...base,
          }),
          needsConfirmation: true,
        },
      ];
    }
    const body = res.status >= 200 && res.status < 300 ? await res.text() : '';
    if (res.status < 200 || res.status >= 300 || /^\s*<(!doctype|html)/i.test(body)) {
      return [
        this.finding('TXT', 1, context, {
          title: 'No security.txt file',
          severity: 'Suggestion',
          expected: 'The site publishes /.well-known/security.txt',
          actual: `No text file was found at /.well-known/security.txt (status ${res.status})`,
          ...base,
        }),
      ];
    }
    const { missing, expired } = parseSecurityTxt(body, now);
    const findings: Finding[] = [];
    if (missing.length > 0) {
      findings.push(
        this.finding('TXT', findings.length + 1, context, {
          title: 'security.txt is missing a required field',
          severity: 'Minor',
          expected: 'security.txt has a Contact line and a valid Expires line (RFC 9116)',
          actual: `Missing: ${missing.join(', ')}`,
          ...base,
        })
      );
    }
    if (expired) {
      findings.push(
        this.finding('TXT', findings.length + 1, context, {
          title: 'security.txt has expired',
          severity: 'Minor',
          expected: 'The Expires date in security.txt is in the future',
          actual: 'The Expires date in security.txt is in the past',
          ...base,
        })
      );
    }
    return findings;
  }

  // --- Content-Security-Policy -----------------------------------------------------------

  /** Weak settings in a Content-Security-Policy that was sent. Nothing when none was sent. */
  checkCsp(csp: string | undefined, context: SecurityDepthContext): Finding[] {
    if (!csp || !csp.trim()) return [];
    const directives = parseCsp(csp);
    const findings: Finding[] = [];
    const scriptName = directives.has('script-src') ? 'script-src' : directives.has('default-src') ? 'default-src' : '';
    const scriptTokens = (scriptName ? directives.get(scriptName) : undefined) ?? [];
    const lower = scriptTokens.map((t) => t.toLowerCase());
    const hasNonceOrHash = scriptTokens.some((t) => NONCE_OR_HASH.test(t)) || lower.includes("'strict-dynamic'");

    const add = (title: string, severity: FindingSeverity, expected: string, actual: string) =>
      findings.push(
        this.finding('CSP', findings.length + 1, context, {
          title,
          severity,
          expected,
          actual,
          steps: [`Open ${context.urlPath}`, 'Read the Content-Security-Policy response header'],
          resolution:
            'Tighten the policy: remove unsafe keywords and broad sources, use nonces or hashes for scripts, and set the missing directives.',
        })
      );

    if (scriptName && lower.includes("'unsafe-inline'") && !hasNonceOrHash) {
      add(
        'Content-Security-Policy allows unsafe-inline scripts',
        'Minor',
        'The policy does not allow inline scripts without a nonce or hash',
        `${scriptName} contains 'unsafe-inline' (automatic check only)`
      );
    }
    if (scriptName && lower.includes("'unsafe-eval'")) {
      add(
        'Content-Security-Policy allows unsafe-eval',
        'Minor',
        'The policy does not allow scripts to be built from strings',
        `${scriptName} contains 'unsafe-eval' (automatic check only)`
      );
    }
    const broad: string[] = [];
    for (const name of ['script-src', 'default-src', 'object-src']) {
      for (const tok of directives.get(name) ?? []) {
        if (BROAD_SOURCES.has(tok.toLowerCase())) broad.push(`${name} ${tok.toLowerCase()}`);
      }
    }
    if (broad.length > 0) {
      add(
        'Content-Security-Policy allows broad sources',
        'Minor',
        'Script and object sources name specific sites',
        `Broad sources: ${broad.join(', ')} (automatic check only)`
      );
    }
    const absent: string[] = [];
    if (!directives.has('object-src') && !directives.has('default-src')) absent.push('object-src');
    if (!directives.has('base-uri')) absent.push('base-uri');
    if (!directives.has('frame-ancestors')) absent.push('frame-ancestors');
    if (absent.length > 0) {
      add(
        'Content-Security-Policy leaves some directives unset',
        'Suggestion',
        'The policy sets object-src (or default-src), base-uri and frame-ancestors',
        `Not set: ${absent.join(', ')} (automatic check only)`
      );
    }
    return findings;
  }

  private finding(
    kind: string,
    n: number,
    context: SecurityDepthContext,
    detail: {
      title: string;
      severity: FindingSeverity;
      expected: string;
      actual: string;
      steps: string[];
      resolution: string;
    }
  ): Finding {
    return {
      id: `F-SEC-DEPTH-${kind}-${context.testCaseId || 'GEN'}-${n}`,
      testCaseId: context.testCaseId,
      flowId: context.flowId,
      severity: detail.severity,
      checker: 'security',
      title: detail.title,
      where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
      expectedVsActual: { expected: detail.expected, actual: detail.actual },
      stepsToReproduce: detail.steps,
      evidence: {},
      resolution: detail.resolution,
    };
  }
}

async function collectResources(page: Page): Promise<ResourceTag[]> {
  const raw: unknown = await page.evaluate(() => {
    const out: Array<{ tag: string; url: string; hasIntegrity: boolean }> = [];
    document.querySelectorAll('script[src]').forEach((el) => {
      const s = el as HTMLScriptElement;
      out.push({ tag: 'script', url: s.src, hasIntegrity: !!s.getAttribute('integrity') });
    });
    document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((el) => {
      const l = el as HTMLLinkElement;
      out.push({ tag: 'link', url: l.href, hasIntegrity: !!l.getAttribute('integrity') });
    });
    return out;
  });
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ResourceTag =>
      !!r &&
      typeof r === 'object' &&
      ((r as ResourceTag).tag === 'script' || (r as ResourceTag).tag === 'link') &&
      typeof (r as ResourceTag).url === 'string'
  );
}
