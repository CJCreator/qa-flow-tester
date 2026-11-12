import type { FetchFn } from '@qa/checkers';
import { isLocalOriginHost, makeOutboundFetch } from '../safe-net.js';
import { debugLog } from '../debug-log.js';

/** RFC 9309 asks crawlers to read at least 500 KiB of a robots.txt. */
const ROBOTS_MAX_BYTES = 512_000;
/** The longest Crawl-delay honoured (ADR 0015); a larger value is cut to this and logged. */
export const MAX_CRAWL_DELAY_MS = 30_000;

/** The name our crawls give in User-Agent and match against robots.txt groups. One value for every crawl. */
export const ROBOTS_USER_AGENT_TOKEN = 'QA-Benchmarking-Bot';

/** The wait between page loads on a site we crawl: our own choice, never shorter than the site's robots.txt Crawl-delay. */
export function crawlPageDelayMs(chosenMs: number, robots?: Pick<RobotsPolicy, 'crawlDelayMs'>): number {
  return Math.max(chosenMs, robots?.crawlDelayMs ?? 0);
}

/** Milliseconds for a Crawl-delay value in seconds, or undefined when it is not a number of seconds ≥ 0. */
function crawlDelayMsOf(value: string): number | undefined {
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(value)) return undefined;
  const ms = Math.round(Number(value) * 1000);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Minimal robots.txt policy (RFC 9309): picks the group for our user-agent token
 * (falling back to `*`) and applies longest-match Allow/Disallow with `*` and `$` wildcards.
 * Also reads the chosen group's `Crawl-delay` (not in RFC 9309, widely used), see `crawlDelayMs`.
 */
export class RobotsPolicy {
  private constructor(
    private rules: Array<{ allow: boolean; pattern: string }>,
    /** The chosen group's Crawl-delay in milliseconds (capped at MAX_CRAWL_DELAY_MS); undefined when none is set. */
    readonly crawlDelayMs?: number
  ) {}

  static allowAll(): RobotsPolicy {
    return new RobotsPolicy([]);
  }

  static parse(robotsTxt: string, userAgentToken: string): RobotsPolicy {
    const token = userAgentToken.toLowerCase();
    const groups: Array<{
      agents: string[];
      rules: Array<{ allow: boolean; pattern: string }>;
      crawlDelay?: string;
    }> = [];
    let current: (typeof groups)[number] | null = null;
    let lastWasAgent = false;

    for (const rawLine of robotsTxt.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, '').trim();
      const sep = line.indexOf(':');
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim().toLowerCase();
      const value = line.slice(sep + 1).trim();

      if (key === 'user-agent') {
        // Consecutive user-agent lines share one group.
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [] };
          groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
      } else if ((key === 'allow' || key === 'disallow') && current) {
        lastWasAgent = false;
        // An empty Disallow means "allow everything" and contributes no rule.
        if (value) current.rules.push({ allow: key === 'allow', pattern: value });
      } else {
        lastWasAgent = false;
        // The first valid Crawl-delay of a group counts; a malformed one is ignored.
        if (
          key === 'crawl-delay' &&
          current &&
          current.crawlDelay === undefined &&
          crawlDelayMsOf(value) !== undefined
        ) {
          current.crawlDelay = value;
        }
      }
    }

    const specific = groups.filter((g) => g.agents.includes(token));
    const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
    const delay = chosen.find((g) => g.crawlDelay !== undefined)?.crawlDelay;
    let crawlDelayMs = delay === undefined ? undefined : crawlDelayMsOf(delay);
    if (crawlDelayMs !== undefined && crawlDelayMs > MAX_CRAWL_DELAY_MS) {
      debugLog('crawl', 'robots.txt Crawl-delay capped', { askedMs: crawlDelayMs, usedMs: MAX_CRAWL_DELAY_MS });
      crawlDelayMs = MAX_CRAWL_DELAY_MS;
    }
    return new RobotsPolicy(
      chosen.flatMap((g) => g.rules),
      crawlDelayMs
    );
  }

  /**
   * Fetches `<origin>/robots.txt` through the pinned outbound path (ADR 0031): public addresses only by
   * default, except that an origin which is itself a local/private host (the user's own build) may read its own
   * robots.txt; a run on a shared machine still refuses it. A missing, refused or unreachable file means
   * everything is allowed. A caller-supplied `fetchFn` is used as given.
   */
  static async fetch(origin: string, userAgentToken: string, fetchFn?: FetchFn): Promise<RobotsPolicy> {
    try {
      fetchFn ??= makeOutboundFetch({
        allowPrivate: isLocalOriginHost(new URL(origin).hostname),
        maxBytes: ROBOTS_MAX_BYTES,
        timeoutMs: 10000,
      });
      const res = await fetchFn(new URL('/robots.txt', origin).toString());
      if (!res || res.status < 200 || res.status >= 300) return RobotsPolicy.allowAll();
      return RobotsPolicy.parse(await res.text(), userAgentToken);
    } catch {
      return RobotsPolicy.allowAll();
    }
  }

  isAllowed(pathAndQuery: string): boolean {
    let best: { allow: boolean; length: number } | null = null;
    for (const rule of this.rules) {
      if (!patternRegex(rule.pattern).test(pathAndQuery)) continue;
      const length = rule.pattern.length;
      // Longest pattern wins; on a tie, Allow wins.
      if (!best || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
    return best ? best.allow : true;
  }
}

/** The compiled form of each robots pattern, built once (isAllowed runs for every link and request). */
const compiled = new Map<string, RegExp>();

function patternRegex(pattern: string): RegExp {
  let regex = compiled.get(pattern);
  if (!regex) {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const source = body
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    regex = new RegExp(`^${source}${anchored ? '$' : ''}`);
    compiled.set(pattern, regex);
  }
  return regex;
}
