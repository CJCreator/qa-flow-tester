import { describe, expect, it } from 'vitest';
import { createLimiter, mapInFlight } from '../src/concurrency.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

function tracker() {
  let active = 0;
  let max = 0;
  return {
    get max() {
      return max;
    },
    async run<T>(value: T): Promise<T> {
      active++;
      max = Math.max(max, active);
      await tick();
      active--;
      return value;
    },
  };
}

describe('mapInFlight', () => {
  it('returns results in input order whatever the finish order', async () => {
    const out = await mapInFlight([30, 1, 10, 2], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(out).toEqual([30, 1, 10, 2]);
  });

  it('passes the index', async () => {
    expect(await mapInFlight(['a', 'b'], 2, async (v, i) => `${v}${i}`)).toEqual(['a0', 'b1']);
  });

  it('never has more than limit in flight, and uses the whole limit', async () => {
    const t = tracker();
    await mapInFlight(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      (i) => t.run(i)
    );
    expect(t.max).toBe(3);
  });

  it('returns [] for empty input without calling fn', async () => {
    let calls = 0;
    expect(await mapInFlight([], 4, async () => ++calls)).toEqual([]);
    expect(calls).toBe(0);
  });

  it('rejects with the first error', async () => {
    await expect(
      mapInFlight([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
  });

  it('lets other workers finish their current item after an error', async () => {
    const finished: number[] = [];
    await expect(
      mapInFlight([1, 2], 2, async (n) => {
        if (n === 1) throw new Error('boom');
        await tick();
        finished.push(n);
        return n;
      })
    ).rejects.toThrow('boom');
    await tick();
    await tick();
    expect(finished).toEqual([2]);
  });

  it('starts no worker when limit is below 1 (callers clamp)', async () => {
    let calls = 0;
    const out = await mapInFlight([1, 2], 0, async () => ++calls);
    expect(calls).toBe(0);
    expect(out).toHaveLength(2);
  });

  it('runs one at a time with limit 1', async () => {
    const t = tracker();
    await mapInFlight([1, 2, 3, 4], 1, (n) => t.run(n));
    expect(t.max).toBe(1);
  });
});

describe('createLimiter', () => {
  it('never has more than limit in flight', async () => {
    const t = tracker();
    const limit = createLimiter(2);
    await Promise.all(Array.from({ length: 10 }, (_, i) => limit(() => t.run(i))));
    expect(t.max).toBe(2);
  });

  it('returns each call its own result', async () => {
    const limit = createLimiter(2);
    expect(await Promise.all([1, 2, 3].map((n) => limit(async () => n * 2)))).toEqual([2, 4, 6]);
  });

  it('starts waiting calls in the order asked', async () => {
    const limit = createLimiter(1);
    const started: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => limit(async () => void started.push(n))));
    expect(started).toEqual([1, 2, 3, 4]);
  });

  it('clamps 0, negatives and fractions below 1 to 1', async () => {
    for (const bad of [0, -3, 0.5]) {
      const t = tracker();
      const limit = createLimiter(bad);
      await Promise.all([1, 2, 3].map((n) => limit(() => t.run(n))));
      expect(t.max).toBe(1);
    }
  });

  it('floors a fractional limit', async () => {
    const t = tracker();
    const limit = createLimiter(2.9);
    await Promise.all(Array.from({ length: 8 }, (_, i) => limit(() => t.run(i))));
    expect(t.max).toBe(2);
  });

  it('frees the place when fn throws, and propagates the error', async () => {
    const limit = createLimiter(1);
    await expect(
      limit(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await limit(async () => 'ok')).toBe('ok');
  });
});
