import type { Breakpoint, PageSpeedMap, PageSpeedSample, SlowerThanLastTime } from '@qa/types';

/** A page is "slower than last time" only when it is at least this many ms slower... */
export const SLOWER_MIN_MS = 300;
/** ...and at least this many percent slower. Both must hold; both edges are inclusive. */
export const SLOWER_MIN_PERCENT = 20;

export function pageSpeedKey(role: string, breakpoint: string, urlPath: string): string {
  return `${role}|${breakpoint}|${urlPath}`;
}

/** Pure, integer maths: `cur - prev >= 300` and `cur >= prev * 1.2` (as `cur * 5 >= prev * 6`). */
export function isSlowerThanLastTime(prev?: PageSpeedSample, cur?: PageSpeedSample): boolean {
  if (!prev || !cur) return false;
  if (!(prev.ms > 0) || !(cur.ms > 0)) return false;
  if (prev.metric !== cur.metric || prev.throttled !== cur.throttled || prev.profile !== cur.profile) return false;
  return cur.ms - prev.ms >= SLOWER_MIN_MS && cur.ms * 5 >= prev.ms * 6;
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);

function describe(
  prev: PageSpeedSample,
  cur: PageSpeedSample,
  increaseMs: number,
  increasePercent: number,
  previousTimestamp?: string
): string {
  const when = previousTimestamp ? ` (${previousTimestamp.slice(0, 10)})` : '';
  const what = cur.metric === 'lcp' ? 'the largest visible element appeared after' : 'the page was ready after';
  const basis = cur.throttled
    ? `median of ${cur.loads} loads on a simulated mid-range phone on slow 4G`
    : `median of ${cur.loads} loads in a test browser that was not slowed down`;
  return (
    `Slower than the last check-up${when}: ${what} ${seconds(prev.ms)} s, now ${seconds(cur.ms)} s ` +
    `(+${increaseMs} ms, +${increasePercent}%). ` +
    `Measured in a test browser, not by real visitors: ${basis}. ` +
    `Only flagged when both 20% and 300 ms slower. It does not change the grades.`
  );
}

/** Compares this check-up's speeds with the last one's. Deterministic: sorted by increase, then key. */
export function findSlowerPages(
  previous: PageSpeedMap | undefined,
  current: PageSpeedMap,
  ctx: { previousRunId?: string; previousTimestamp?: string } = {}
): SlowerThanLastTime[] {
  if (!previous) return [];
  const out: Array<SlowerThanLastTime & { key: string }> = [];
  for (const key of Object.keys(current)) {
    const prev = previous[key];
    const cur = current[key];
    if (!isSlowerThanLastTime(prev, cur)) continue;
    const [role, breakpoint, ...rest] = key.split('|');
    const urlPath = rest.join('|');
    const increaseMs = cur.ms - prev.ms;
    const increasePercent = Math.round((increaseMs / prev.ms) * 1000) / 10;
    out.push({
      key,
      urlPath,
      role,
      breakpoint: breakpoint as Breakpoint,
      aspect: 'Fast and mobile',
      checker: 'performance',
      metric: cur.metric,
      previousMs: prev.ms,
      currentMs: cur.ms,
      increaseMs,
      increasePercent,
      previousRunId: ctx.previousRunId,
      previousTimestamp: ctx.previousTimestamp,
      loads: cur.loads,
      throttled: cur.throttled,
      summary: describe(prev, cur, increaseMs, increasePercent, ctx.previousTimestamp),
    });
  }
  out.sort((a, b) => b.increaseMs - a.increaseMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out.map(({ key: _key, ...rest }) => rest);
}
