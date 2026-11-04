/**
 * Speed of Sample Pages from the Google PageSpeed Insights v5 API (REQ-012, REQ-043, ADR 0035).
 *
 * - `measurePageSpeed` asks PSI once (strategy mobile, category performance) and maps `lighthouseResult` to lab
 *   values and `loadingExperience` (page) or `originLoadingExperience` (origin) to field values.
 * - `measureSampleSpeeds` asks for one page at a time; after a quota answer the remaining pages are 'quota'
 *   without a request.
 * - The request goes through `makeOutboundFetch` (ADR 0031) to the fixed googleapis.com host, public addresses
 *   only. The audited page address is only a query parameter. The key (ADR 0034) goes in the `x-goog-api-key`
 *   header, never the address, and never into a returned value, error or log line. Without a key the request is
 *   keyless (free, lower limit).
 * - Nothing here throws for a failed measurement: it comes back 'not-measured' with a reason and no values, so it
 *   can never read as good (REQ-012 AC-2).
 */
import type { ExternalSpeed, PageSpeed, SpeedNotMeasuredReason, SpeedValue } from '@qa/types';
import type { ServiceKeyName } from '../../ai/key-resolver.js';
import { defaultNetDeps, makeOutboundFetch, type NetDeps } from '../../safe-net.js';

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
/** A PSI run takes Lighthouse 10 to 60 seconds; the whole request is cut off after this. */
export const PSI_TIMEOUT_MS = 90_000;
/** A full PSI answer with every Lighthouse audit is a few megabytes. */
export const PSI_MAX_BYTES = 16 * 1024 * 1024;

export interface PageSpeedDeps {
  /** The key resolver's `resolveServiceKey`. Null, missing or failing means a keyless request. */
  resolveServiceKey?: (service: ServiceKeyName) => Promise<{ apiKey: string } | null>;
  /** Network seam (tests). Defaults to the real pinned lookup and connect. */
  net?: NetDeps;
  timeoutMs?: number;
  now?: () => Date;
  /** Notes about failed requests. Never given the key. */
  log?: (line: string) => void;
}

export interface SampleSpeed {
  url: string;
  speed: PageSpeed;
}

const SOURCE = 'pagespeed-insights' as const;

function notMeasured(reason: SpeedNotMeasuredReason): PageSpeed {
  return {
    lab: { status: 'not-measured', source: SOURCE, method: 'lab', reason },
    field: { status: 'not-measured', source: SOURCE, method: 'field', reason },
  };
}

/** Lighthouse audit ids for the lab values; the score comes from the performance category. */
const LAB_AUDITS: Array<{ audit: string; metric: SpeedValue['metric']; unit: SpeedValue['unit'] }> = [
  { audit: 'largest-contentful-paint', metric: 'lcp', unit: 'ms' },
  { audit: 'cumulative-layout-shift', metric: 'cls', unit: 'none' },
  { audit: 'first-contentful-paint', metric: 'fcp', unit: 'ms' },
  { audit: 'server-response-time', metric: 'ttfb', unit: 'ms' },
  { audit: 'total-blocking-time', metric: 'tbt', unit: 'ms' },
  { audit: 'speed-index', metric: 'speed-index', unit: 'ms' },
];

/** Chrome UX Report metric names in `loadingExperience.metrics`. PSI gives the CLS percentile times 100. */
const FIELD_METRICS: Array<{ key: string; metric: SpeedValue['metric']; unit: SpeedValue['unit']; scale: number }> = [
  { key: 'LARGEST_CONTENTFUL_PAINT_MS', metric: 'lcp', unit: 'ms', scale: 1 },
  { key: 'INTERACTION_TO_NEXT_PAINT', metric: 'inp', unit: 'ms', scale: 1 },
  { key: 'CUMULATIVE_LAYOUT_SHIFT_SCORE', metric: 'cls', unit: 'none', scale: 100 },
  { key: 'FIRST_CONTENTFUL_PAINT_MS', metric: 'fcp', unit: 'ms', scale: 1 },
  { key: 'EXPERIMENTAL_TIME_TO_FIRST_BYTE', metric: 'ttfb', unit: 'ms', scale: 1 },
];

/** Google API error reasons and statuses that mean the free quota or rate limit is used up. */
const QUOTA_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded']);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function rounded(value: number, unit: SpeedValue['unit']): number {
  return unit === 'none' ? Math.round(value * 1000) / 1000 : Math.round(value);
}

function labValues(body: Json): SpeedValue[] {
  const lh = obj(body.lighthouseResult);
  if (!lh) return [];
  // A Lighthouse run that failed (page did not load) may still carry audits with placeholder numbers.
  const runtimeError = obj(lh.runtimeError);
  if (runtimeError && runtimeError.code !== 'NO_ERROR') return [];
  const values: SpeedValue[] = [];
  const score = num(obj(obj(lh.categories)?.performance)?.score);
  if (score !== null && score <= 1)
    values.push({ metric: 'performance-score', value: Math.round(score * 100), unit: 'score' });
  const audits = obj(lh.audits);
  for (const { audit, metric, unit } of LAB_AUDITS) {
    const v = num(obj(audits?.[audit])?.numericValue);
    if (v !== null) values.push({ metric, value: rounded(v, unit), unit });
  }
  return values;
}

function fieldValues(experience: unknown): SpeedValue[] {
  const metrics = obj(obj(experience)?.metrics);
  if (!metrics) return [];
  const values: SpeedValue[] = [];
  for (const { key, metric, unit, scale } of FIELD_METRICS) {
    const p = num(obj(metrics[key])?.percentile);
    if (p !== null) values.push({ metric, value: rounded(p / scale, unit), unit });
  }
  return values;
}

function measuredAtOf(body: Json, now: () => Date): string {
  const stamp = body.analysisUTCTimestamp ?? obj(body.lighthouseResult)?.fetchTime;
  const t = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
  return (Number.isFinite(t) ? new Date(t) : now()).toISOString();
}

/** Maps a PSI 200 answer. Lab without values is 'failed'; field without data for page or origin is 'no-field-data'. */
export function mapPsiResponse(body: unknown, now: () => Date = () => new Date()): PageSpeed {
  const root = obj(body);
  if (!root) return notMeasured('failed');
  const measuredAt = measuredAtOf(root, now);
  const lab = labValues(root);
  const labSpeed: ExternalSpeed = lab.length
    ? { status: 'measured', source: SOURCE, method: 'lab', strategy: 'mobile', values: lab, measuredAt }
    : { status: 'not-measured', source: SOURCE, method: 'lab', reason: 'failed' };

  // `origin_fallback` marks loadingExperience as holding the origin's data, not the page's.
  const pageExp = obj(root.loadingExperience);
  const pageIsOrigin = pageExp?.origin_fallback === true;
  const page = pageIsOrigin ? [] : fieldValues(pageExp);
  const origin = page.length ? [] : fieldValues(root.originLoadingExperience);
  const originValues = origin.length ? origin : pageIsOrigin ? fieldValues(pageExp) : [];
  let fieldSpeed: ExternalSpeed;
  if (page.length) {
    fieldSpeed = {
      status: 'measured',
      source: SOURCE,
      method: 'field',
      strategy: 'mobile',
      scope: 'page',
      values: page,
      measuredAt,
    };
  } else if (originValues.length) {
    fieldSpeed = {
      status: 'measured',
      source: SOURCE,
      method: 'field',
      strategy: 'mobile',
      scope: 'origin',
      values: originValues,
      measuredAt,
    };
  } else {
    fieldSpeed = { status: 'not-measured', source: SOURCE, method: 'field', reason: 'no-field-data' };
  }
  return { lab: labSpeed, field: fieldSpeed };
}

/** True when a non-200 PSI answer says the quota or rate limit is used up (429, or a Google quota error). */
export function isQuotaAnswer(status: number, text: string): boolean {
  if (status === 429) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  const error = obj(obj(parsed)?.error);
  if (!error) return false;
  if (error.status === 'RESOURCE_EXHAUSTED') return true;
  const errors = Array.isArray(error.errors) ? error.errors : [];
  if (errors.some((e) => QUOTA_REASONS.has(String(obj(e)?.reason)))) return true;
  const details = Array.isArray(error.details) ? error.details : [];
  if (details.some((d) => /QUOTA|RATE_LIMIT/.test(String(obj(d)?.reason)))) return true;
  return typeof error.message === 'string' && /quota/i.test(error.message);
}

export function psiRequestUrl(pageUrl: string): string {
  const u = new URL(PSI_ENDPOINT);
  u.searchParams.set('url', pageUrl);
  u.searchParams.set('strategy', 'mobile');
  u.searchParams.set('category', 'performance');
  return u.toString();
}

async function resolveKey(deps: PageSpeedDeps): Promise<string | null> {
  if (!deps.resolveServiceKey) return null;
  try {
    const found = await deps.resolveServiceKey('pagespeed');
    const key = typeof found?.apiKey === 'string' ? found.apiKey.trim() : '';
    return key || null;
  } catch {
    deps.log?.('PageSpeed Insights: the saved key could not be read; asking without a key.');
    return null;
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function measureWithKey(pageUrl: string, apiKey: string | null, deps: PageSpeedDeps): Promise<PageSpeed> {
  const log = deps.log ?? (() => {});
  if (!isHttpUrl(pageUrl)) return notMeasured('failed');
  // Record why the request could not be made: makeOutboundFetch only answers null.
  const base = deps.net ?? defaultNetDeps;
  let networkFailure: 'timeout' | 'no-network' | null = null;
  const net: NetDeps = {
    async lookup(host) {
      try {
        return await base.lookup(host);
      } catch (err) {
        networkFailure = err instanceof Error && err.message === 'timeout' ? 'timeout' : 'no-network';
        throw err;
      }
    },
    async connect(req) {
      try {
        return await base.connect(req);
      } catch (err) {
        networkFailure = err instanceof Error && err.message === 'timeout' ? 'timeout' : 'no-network';
        throw err;
      }
    },
  };
  const fetchFn = makeOutboundFetch({
    allowPrivate: false,
    maxRedirects: 0,
    maxBytes: PSI_MAX_BYTES,
    timeoutMs: deps.timeoutMs ?? PSI_TIMEOUT_MS,
    headers: { accept: 'application/json', ...(apiKey ? { 'x-goog-api-key': apiKey } : {}) },
    deps: net,
  });
  const res = await fetchFn(psiRequestUrl(pageUrl));
  if (!res) {
    const reason = networkFailure ?? 'failed';
    log(`PageSpeed Insights: no answer (${reason}).`);
    return notMeasured(reason);
  }
  const text = await res.text().catch(() => '');
  if (res.status !== 200) {
    const quota = isQuotaAnswer(res.status, text);
    log(`PageSpeed Insights: HTTP ${res.status}${quota ? ' (quota)' : ''}.`);
    return notMeasured(quota ? 'quota' : 'failed');
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    log('PageSpeed Insights: the answer was not JSON.');
    return notMeasured('failed');
  }
  return mapPsiResponse(body, deps.now);
}

/** Lab and field speed of one public page, never throwing; a failure is 'not-measured' with a reason. */
export async function measurePageSpeed(pageUrl: string, deps: PageSpeedDeps = {}): Promise<PageSpeed> {
  return measureWithKey(pageUrl, await resolveKey(deps), deps);
}

const wasQuota = (s: PageSpeed) => s.lab.status === 'not-measured' && s.lab.reason === 'quota';

/**
 * One request at a time, in the given order. The key is resolved once. After a quota answer no further request
 * is made: the remaining pages are 'not-measured' with reason 'quota'.
 */
export async function measureSampleSpeeds(pages: readonly string[], deps: PageSpeedDeps = {}): Promise<SampleSpeed[]> {
  const apiKey = pages.length ? await resolveKey(deps) : null;
  const out: SampleSpeed[] = [];
  let quotaHit = false;
  for (const url of pages) {
    if (quotaHit) {
      out.push({ url, speed: notMeasured('quota') });
      continue;
    }
    const speed = await measureWithKey(url, apiKey, deps);
    quotaHit = wasQuota(speed);
    out.push({ url, speed });
  }
  return out;
}
