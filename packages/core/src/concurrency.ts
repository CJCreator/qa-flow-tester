/**
 * The one home of bounded concurrency in core: a worker pool over a list (`mapInFlight`) and a
 * first-come-first-served semaphore (`createLimiter`). Fail-fast, stop-aware pools stay with their owner.
 */

/**
 * Runs `fn` over `items`, at most `limit` at once; results in input order. `limit` is used as given
 * (below 1 means no worker starts, so clamp it at the call site when that is not wanted). When `fn` throws, the
 * returned promise rejects with the first error; workers already running finish their current item, and the
 * failed worker pulls no more. Callers that must not stop catch inside `fn`.
 */
export async function mapInFlight<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/** Runs `fn` when one of the limiter's places is free; waiting calls go in the order asked. */
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** At most `limit` calls at once (limit is floored and raised to 1), in the order asked. */
export function createLimiter(limit: number): Limiter {
  const max = Math.max(1, Math.floor(limit));
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (fn) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
