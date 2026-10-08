import type { Finding } from './index.js';

export interface FingerprintParams {
  productId: string;
  route: string;
  checkerId: string;
  ruleCode: string;
  selector?: string;
}

/**
 * Fast 64-bit deterministic hash (hex-encoded, 16 characters).
 * Pure TypeScript, zero dependencies, isomorphic across Node.js and Browser.
 */
function hashString16(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >>> 1), 0x27d4eb2d);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

/**
 * Normalizes a URL or path string into an invariant pathname route:
 * - Strips protocol, hostname, and port (e.g. http://localhost:3000/checkout -> /checkout)
 * - Strips query parameters (?foo=bar) and URL hashes (#section)
 * - Collapses multiple slashes and removes trailing slash (except for root '/')
 */
export function normalizeRoute(rawRoute: string): string {
  if (!rawRoute || rawRoute.trim() === '') {
    return '/';
  }

  let route = rawRoute.trim();

  // If full URL, extract only pathname
  try {
    if (route.startsWith('http://') || route.startsWith('https://')) {
      const parsed = new URL(route);
      route = parsed.pathname;
    }
  } catch {
    // If not a valid standard URL, continue with path manipulation
  }

  // Strip query string and hash
  route = route.split('?')[0].split('#')[0];

  // Replace multiple slashes with single slash
  route = route.replace(/\/+/g, '/');

  // Strip trailing slash if not root
  if (route.length > 1 && route.endsWith('/')) {
    route = route.slice(0, -1);
  }

  if (!route.startsWith('/')) {
    route = '/' + route;
  }

  return route.toLowerCase();
}

/** Canonical URL path normalizer alias (re-exported for consistency across packages) */
export const normalizeUrlPath = normalizeRoute;

/**
 * Normalizes an element selector:
 * - Standardizes attribute quoting (single to double quotes)
 * - Trims unnecessary internal whitespace
 */
export function normalizeSelector(rawSelector?: string): string {
  if (!rawSelector || rawSelector.trim() === '') {
    return '';
  }

  return rawSelector
    .trim()
    .replace(/'/g, '"')
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Computes a deterministic Structural Fingerprint for a finding.
 * Invariant against host, port, developer machine, timestamps, or dynamic query params.
 */
export function computeStructuralFingerprint(params: FingerprintParams): string {
  const normProduct = params.productId.trim().toLowerCase();
  const normRoute = normalizeRoute(params.route);
  const normChecker = params.checkerId.trim().toLowerCase();
  const normRule = params.ruleCode.trim().toLowerCase();
  const normSelector = normalizeSelector(params.selector);

  const payload = [normProduct, normRoute, normChecker, normRule, normSelector].join('|');
  const hash = hashString16(payload);

  return `fp_${hash}`;
}

/**
 * The Structural Fingerprint of a finding (ADR 0004, ADR 0017). One definition, used by the
 * site history and by findings.json, so the two cannot drift. Not unique per finding: the same
 * problem at several breakpoints or roles shares it.
 */
export function findingFingerprint(f: Pick<Finding, 'checker' | 'title' | 'where'>, productId: string): string {
  return computeStructuralFingerprint({
    productId,
    route: f.where.urlPath,
    checkerId: f.checker,
    ruleCode: f.title,
    selector: f.where.cssSelector || f.where.dataTestId,
  });
}
