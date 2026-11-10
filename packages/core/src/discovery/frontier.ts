/**
 * Frontier and Route Normalization for Deterministic Spider (T-112).
 * Handles canonical route keying, shape extraction for trap protection,
 * and frontier admission bounds (depth, per-shape, duplicates).
 */

export interface RouteKeyOptions {
  routeQueryParams?: string[];
  includeHash?: boolean;
}

/**
 * Normalizes a URL relative to a base URL according to project route rules:
 * - Lower-cased host-less path, trailing slash removed (except '/'), duplicate slashes collapsed
 * - Query parameters: only allowed params from routeQueryParams, sorted for stability
 * - Hash: only preserved if includeHash is true (e.g. #/segment)
 * - Shape: path (and allowed query) with digit runs, UUIDs, and 6+ char hex tokens replaced by :n, :id
 */
export function normalizeRoute(
  url: string,
  base: string,
  opts?: RouteKeyOptions
): {
  key: string;
  shape: string;
  path: string;
  search: string;
  hash: string;
} {
  let resolved: URL;
  try {
    let cleanUrl = url;
    if (
      cleanUrl.startsWith('//') &&
      !cleanUrl.slice(2).split('/')[0].includes('.') &&
      !cleanUrl.slice(2).split('/')[0].includes(':')
    ) {
      cleanUrl = '/' + cleanUrl.replace(/^\/+/, '');
    }
    resolved = new URL(cleanUrl, base);
  } catch {
    // If invalid, fall back to base
    resolved = new URL(base);
  }

  // 1. Lower-cased host-less path, duplicate slashes collapsed, trailing slash removed (except '/')
  let p = resolved.pathname.toLowerCase().replace(/\/+/g, '/');
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  if (!p) {
    p = '/';
  }

  // 2. Query parameters filtering
  let filteredSearch = '';
  if (opts?.routeQueryParams && opts.routeQueryParams.length > 0) {
    const allowed = [...opts.routeQueryParams].sort();
    const params = new URLSearchParams();
    for (const key of allowed) {
      const val = resolved.searchParams.get(key);
      if (val !== null) {
        params.set(key, val);
      }
    }
    const queryStr = params.toString();
    if (queryStr) {
      filteredSearch = `?${queryStr}`;
    }
  }

  // 3. Hash handling
  let hashStr = '';
  if (opts?.includeHash && resolved.hash) {
    hashStr = resolved.hash.toLowerCase();
  }

  // Canonical route key
  const key = `${p}${filteredSearch}${hashStr}`;

  // 4. Shape derivation
  // Replace UUIDs, 6+ char hex tokens, and digit runs with :id and :n
  const shapeBase = `${p}${filteredSearch}`;
  const shape = shapeBase
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/(?<=[\/_=-]|^)[0-9a-f]{6,}(?=[\/_=?-]|$)/gi, ':id')
    .replace(/(?<=[\/_=-]|^)\d+(?=[\/_=?-]|$)/g, ':n');

  return {
    key,
    shape,
    path: p,
    search: resolved.search,
    hash: resolved.hash,
  };
}

export class CrawlFrontier {
  private maxPerShape: number;
  private maxDepth: number;
  private routeQueryParams: string[];
  private includeHash: boolean;

  private visited = new Set<string>();
  private queued = new Set<string>();
  private shapeCounts = new Map<string, number>();

  constructor(opts: { maxPerShape?: number; maxDepth?: number } & RouteKeyOptions = {}) {
    this.maxPerShape = opts.maxPerShape ?? 25;
    this.maxDepth = opts.maxDepth ?? 8;
    this.routeQueryParams = opts.routeQueryParams ?? [];
    this.includeHash = opts.includeHash ?? false;
  }

  admit(
    url: string,
    base: string,
    depth: number
  ): {
    admit: boolean;
    key: string;
    reason?: 'duplicate' | 'trap-limit' | 'depth-limit';
  } {
    const { key, shape } = normalizeRoute(url, base, {
      routeQueryParams: this.routeQueryParams,
      includeHash: this.includeHash,
    });

    if (this.visited.has(key) || this.queued.has(key)) {
      return { admit: false, key, reason: 'duplicate' };
    }

    if (depth > this.maxDepth) {
      return { admit: false, key, reason: 'depth-limit' };
    }

    const currentShapeCount = this.shapeCounts.get(shape) ?? 0;
    if (currentShapeCount >= this.maxPerShape) {
      return { admit: false, key, reason: 'trap-limit' };
    }

    this.queued.add(key);
    this.shapeCounts.set(shape, currentShapeCount + 1);
    return { admit: true, key };
  }

  markVisited(key: string): void {
    this.queued.delete(key);
    this.visited.add(key);
  }

  isVisited(key: string): boolean {
    return this.visited.has(key);
  }

  has(key: string): boolean {
    return this.visited.has(key) || this.queued.has(key);
  }

  getShape(url: string, base: string): string {
    return normalizeRoute(url, base, {
      routeQueryParams: this.routeQueryParams,
      includeHash: this.includeHash,
    }).shape;
  }
}
