import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleOrGiveUp, sleep } from '../src/timing.js';

afterEach(() => vi.useRealTimers());

describe('sleep', () => {
  it('waits the full time', async () => {
    vi.useFakeTimers();
    let done = false;
    void sleep(100).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(99);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('resolves at once for zero or negative waits, with no timer', async () => {
    vi.useFakeTimers();
    await sleep(0);
    await sleep(-5);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('settleOrGiveUp', () => {
  it('returns when the task finishes and clears its timer', async () => {
    vi.useFakeTimers();
    await settleOrGiveUp(Promise.resolve('x'), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('swallows a rejection', async () => {
    await expect(settleOrGiveUp(Promise.reject(new Error('boom')), 1000)).resolves.toBeUndefined();
  });

  it('gives up on a task that hangs', async () => {
    vi.useFakeTimers();
    let done = false;
    void settleOrGiveUp(new Promise(() => {}), 500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
