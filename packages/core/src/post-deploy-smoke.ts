import type { Finding, FindingSeverity, ReleaseReport, TestPointResult } from '@qa/types';
import { isPrivateHost } from './competitive/safe-crawler.js';
import { isTestHost, MUTATING_METHODS } from './live-site.js';
import { redactUrl } from './redact.js';

/**
 * Smoke Check-up: the quick preset that only reads a few known paths of a deployed App, health first.
 * GET only. No sign-in, no form, no AI, no paging or alerting. A health failure stops the rest.
 */

export const HEALTH_PATHS = ['/healthz', '/health', '/api/health', '/status'];
export const VERSION_PATHS = ['/version.json', '/version', '/build.json'];
const PAGE_PATHS = ['/', '/pricing', '/robots.txt', '/sitemap.xml'];

export interface SmokeOptions {
  targetUrl: string;
  /** Read this health path first instead of trying the usual ones. */
  healthPath?: string;
  /** Compared with the version the App reports; not compared when absent. */
  expectedVersion?: string;
  /** A host that is not a test copy needs this explicit say-so. */
  confirmLive?: boolean;
  /** Shared machine (RUNNER_BETA): private addresses are refused. */
  beta?: boolean;
  /** Default 10 s. */
  requestTimeoutMs?: number;
  /** Default 120 s for the whole run. */
  totalBudgetMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SmokeResult {
  findings: Finding[];
  /** "What this did not check" lines (ADR 0029). */
  notChecked: string[];
  /** Plain facts that are not problems (version found, not compared). */
  notes: string[];
  /** Paths that answered. */
  checked: string[];
  healthGateFailed: boolean;
  /** Set when nothing was sent because the address needs confirmation or is refused. */
  refused?: string;
  durationMs: number;
}

interface Got {
  status: number;
  body: string;
}

class Unreachable extends Error {}

function finding(
  n: number,
  severity: FindingSeverity,
  title: string,
  urlPath: string,
  expected: string,
  actual: string
): Finding {
  return {
    id: `SMOKE-${String(n).padStart(3, '0')}`,
    testCaseId: 'SMOKE',
    flowId: 'smoke-checkup',
    severity,
    checker: 'bug-detection',
    title,
    where: { urlPath, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected, actual },
    stepsToReproduce: [`Send GET ${urlPath} to the App.`],
    evidence: {},
    resolution: 'Check the deploy, then run the quick post-deploy check again.',
  };
}

export async function runPostDeploySmoke(options: SmokeOptions): Promise<SmokeResult> {
  const started = Date.now();
  const out: SmokeResult = {
    findings: [],
    notChecked: [],
    notes: [],
    checked: [],
    healthGateFailed: false,
    durationMs: 0,
  };
  const done = (): SmokeResult => {
    out.durationMs = Date.now() - started;
    return out;
  };

  let base: URL;
  try {
    base = new URL(options.targetUrl);
    if (!/^https?:$/.test(base.protocol)) throw new Error('scheme');
  } catch {
    out.refused = 'The address is not a web address (http or https).';
    return done();
  }
  if (options.beta && isPrivateHost(base.hostname)) {
    out.refused = 'Private addresses are not checked on a shared machine.';
    return done();
  }
  if (!isTestHost(base.hostname) && !options.confirmLive) {
    out.refused =
      'This looks like a live address. Confirm that a read-only check of it is fine (confirmLive / --confirm-live) and run again.';
    return done();
  }

  const doFetch = options.fetchImpl ?? fetch;
  const perRequest = options.requestTimeoutMs ?? 10_000;
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), options.totalBudgetMs ?? 120_000);
  let n = 0;
  const add = (...a: [FindingSeverity, string, string, string, string]) => out.findings.push(finding(++n, ...a));

  /** GET only, same-site redirects followed up to 3 hops. Throws Unreachable on timeout or network error. */
  const get = async (p: string): Promise<Got> => {
    const method = 'GET';
    if (MUTATING_METHODS.includes(method)) throw new Error('smoke is read-only');
    let url = new URL(p, base);
    for (let hop = 0; hop < 4; hop++) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method,
          redirect: 'manual',
          signal: AbortSignal.any([budget.signal, AbortSignal.timeout(perRequest)]),
        });
      } catch {
        throw new Unreachable(budget.signal.aborted ? 'the time budget ran out' : 'no answer in time');
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        const next = new URL(loc, url);
        if (next.origin !== base.origin) return { status: res.status, body: '' };
        url = next;
        continue;
      }
      let body = '';
      try {
        body = (await res.text()).slice(0, 200_000);
      } catch {
        /* body unreadable: status still counts */
      }
      return { status: res.status, body };
    }
    return { status: 310, body: '' };
  };

  const remaining = (from: string[]) => from.map((p) => `${p}: not checked, the health check failed first`);

  try {
    // 1. Health gate.
    const candidates = options.healthPath ? [options.healthPath] : HEALTH_PATHS;
    let healthFound = false;
    for (const p of candidates) {
      let r: Got;
      try {
        r = await get(p);
      } catch (e) {
        out.healthGateFailed = true;
        add('Blocker', 'Health endpoint failed', p, 'A 2xx answer', `No answer (${(e as Error).message})`);
        break;
      }
      if (r.status === 404) continue;
      healthFound = true;
      if (r.status >= 200 && r.status < 300) out.checked.push(p);
      else {
        out.healthGateFailed = true;
        add('Blocker', 'Health endpoint failed', p, 'A 2xx answer', `Answered ${r.status}`);
      }
      break;
    }
    if (!healthFound && !out.healthGateFailed) {
      out.notChecked.push(
        `Health endpoint not found (tried ${candidates.join(', ')}). The App's health was not checked.`
      );
    }
    if (out.healthGateFailed) {
      out.notChecked.push(...remaining([...PAGE_PATHS, 'version']));
      return done();
    }

    // 2. Pages and files.
    for (const p of PAGE_PATHS) {
      let r: Got;
      try {
        r = await get(p);
      } catch (e) {
        out.notChecked.push(`${p}: not checked (${(e as Error).message})`);
        if (budget.signal.aborted) {
          const at = PAGE_PATHS.indexOf(p);
          out.notChecked.push(
            ...remaining(PAGE_PATHS.slice(at + 1)).map((l) =>
              l.replace(', the health check failed first', ', the time budget ran out')
            )
          );
          out.notChecked.push('version: not checked, the time budget ran out');
          return done();
        }
        continue;
      }
      const ok = r.status >= 200 && r.status < 300;
      if (ok) out.checked.push(p);
      if (p === '/') {
        if (!ok) add('Blocker', 'Home page did not load', p, 'A 2xx answer', `Answered ${r.status}`);
      } else if (p === '/robots.txt') {
        if (!ok) add('Minor', 'robots.txt not found', p, 'A 2xx answer', `Answered ${r.status}`);
      } else if (p === '/sitemap.xml') {
        if (!ok) add('Minor', 'sitemap.xml not found', p, 'A 2xx answer', `Answered ${r.status}`);
        else if (!/<urlset|<sitemapindex/i.test(r.body)) {
          add(
            'Minor',
            'sitemap.xml could not be read as a sitemap',
            p,
            'A <urlset> or <sitemapindex> document',
            'Neither found'
          );
        }
      } else if (!ok) {
        add(
          r.status === 404 ? 'Minor' : 'Major',
          r.status === 404 ? `${p} not found` : `${p} did not load`,
          p,
          'A 2xx answer',
          `Answered ${r.status}`
        );
      }
    }

    // 3. Version.
    let version: string | undefined;
    for (const p of VERSION_PATHS) {
      let r: Got;
      try {
        r = await get(p);
      } catch {
        break;
      }
      if (r.status < 200 || r.status >= 300) continue;
      version = readVersion(r.body);
      if (version) {
        out.checked.push(p);
        break;
      }
    }
    if (!version) {
      out.notChecked.push(`Version not checked: none of ${VERSION_PATHS.join(', ')} gave a version.`);
    } else if (options.expectedVersion === undefined) {
      out.notes.push(`Version found: ${redactUrl(version)}. Not compared, no expected version was given.`);
    } else if (version !== options.expectedVersion) {
      add(
        'Major',
        'Version does not match the expected one',
        '/version.json',
        redactUrl(options.expectedVersion),
        redactUrl(version)
      );
    }
    return done();
  } finally {
    clearTimeout(timer);
  }
}

/** A version from JSON ({version|commit|sha|build}) or a short plain-text body. */
export function readVersion(body: string): string | undefined {
  const text = body.trim();
  if (!text) return undefined;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    for (const k of ['version', 'commit', 'sha', 'build']) {
      const v = j?.[k];
      if (typeof v === 'string' || typeof v === 'number') return String(v);
    }
    return undefined;
  } catch {
    return /^[\w.+\-]{1,64}$/.test(text) ? text : undefined;
  }
}

/**
 * The report for a Smoke Check-up. Wiring: `smokeReport(result, targetUrl, runId?)` -> ReleaseReport with
 * `notChecked` set; hand it to `ReportGenerator.generate`. Verdict comes from `releaseVerdict(report.findings)`.
 */
export function smokeReport(result: SmokeResult, targetUrl: string, runId = `run-${Date.now()}`): ReleaseReport {
  const failed = result.findings.some((f) => f.severity === 'Blocker' || f.severity === 'Major');
  const point: TestPointResult = {
    testCaseId: 'SMOKE',
    flowId: 'smoke-checkup',
    role: 'visitor',
    status: failed ? 'Failed' : 'Passed',
    durationMs: result.durationMs,
    findings: result.findings,
    stepEvidence: [],
  };
  return {
    runId,
    productId: new URL(targetUrl).hostname,
    targetUrl: redactUrl(targetUrl),
    timestamp: new Date().toISOString(),
    durationMs: result.durationMs,
    coverage: {
      totalTestPoints: 1,
      passed: failed ? 0 : 1,
      failed: failed ? 1 : 0,
      blocked: 0,
      skipped: 0,
      couldNotVerify: 0,
      completionRate: 100,
    },
    results: [point],
    findings: result.findings,
    notes: [...result.notes, 'Quick post-deploy check: read-only GET requests to a few known paths. Nothing was sent.'],
    notChecked: result.notChecked.length > 0 ? result.notChecked : undefined,
  };
}
