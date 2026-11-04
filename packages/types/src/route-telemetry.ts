/**
 * Route Telemetry and Page Coverage Types.
 * Pure, browser-safe module: runner, wizard, and core can import this.
 */

/**
 * Why the crawl found a page but did not record it (a Skipped Page, CONTEXT.md). One list for the type and
 * for code that needs the values at run time.
 * - `depth-limit`: more link steps from the start address than the max depth allows.
 * - `excluded`: the path starts with an exclude path, or with none of the include paths. Never the start page.
 * - `payment`: a payment area (card-number field, payment-provider frame or checkout path). Nothing on it is
 *   clicked or sent, and its links are not followed.
 */
export const ROUTE_SKIP_REASONS = [
  'page-limit',
  'depth-limit',
  'excluded',
  'payment',
  'did-not-load',
  'robots',
  'sign-in',
  'http-error',
  'timeout',
  'off-site-redirect',
  'time-limit',
  'trap-limit',
  'session-lost',
  'duplicate',
] as const;

export type RouteSkipReason = (typeof ROUTE_SKIP_REASONS)[number];

export interface RouteTelemetry {
  /** Redacted path + query, never secrets */
  requestedPath: string;
  /** Main-frame HTTP status */
  status?: number;
  /** After redirects (redacted) */
  finalPath?: string;
  /** Redacted paths/URLs, in order */
  redirectChain?: string[];
  outcome: 'recorded' | 'skipped';
  skipReason?: RouteSkipReason;
  /** Short fixed wording, never page text */
  detail?: string;
  attempts: number;
  durationMs: number;
  /** 'visitor' or a role name */
  who?: string;
}

export interface SkippedPageInfo {
  urlPath: string;
  why: RouteSkipReason;
  status?: number;
  finalPath?: string;
  detail?: string;
}

export interface PageCoverage {
  found: number;
  reached: number;
  skipped: SkippedPageInfo[];
  routes?: RouteTelemetry[];
}
