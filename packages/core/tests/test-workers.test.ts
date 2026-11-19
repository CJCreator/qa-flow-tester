import { describe, it, expect } from 'vitest';
import { MAX_TEST_WORKERS, runOnWorkers, testWorkerCount } from '../src/orchestrator.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('testWorkerCount (ADR 0048)', () => {
  it('4 locally and 1 on the hosted copy by default', () => {
    expect(testWorkerCount(undefined, false)).toBe(4);
    expect(testWorkerCount(undefined, true)).toBe(1);
  });
  it('RUNNER_TEST_WORKERS sets it, capped; anything else falls back', () => {
    expect(testWorkerCount('2', true)).toBe(2);
    expect(testWorkerCount(' 6 ', false)).toBe(6);
    expect(testWorkerCount('99', false)).toBe(MAX_TEST_WORKERS);
    for (const bad of ['0', '-1', '2.5', 'four', '']) expect(testWorkerCount(bad, false)).toBe(4);
  });
});

describe('runOnWorkers', () => {
  it('runs every task once, at most `workers` at a time', async () => {
    let active = 0;
    let most = 0;
    const done: number[] = [];
    await runOnWorkers([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      most = Math.max(most, active);
      await tick();
      done.push(n);
      active--;
    });
    expect([...done].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(most).toBe(3);
  });

  it('after a task throws, no new task starts; every worker ends before the error is thrown', async () => {
    const started: number[] = [];
    let running = 0;
    const err = await runOnWorkers([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      running++;
      await tick();
      running--;
      if (n === 1) throw new Error('boom');
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe('boom');
    expect(running).toBe(0);
    expect(started.length).toBeLessThanOrEqual(3);
  });

  it('stop() ends the queue', async () => {
    let stop = false;
    const started: number[] = [];
    await runOnWorkers(
      [1, 2, 3, 4],
      1,
      async (n) => {
        started.push(n);
        if (n === 2) stop = true;
      },
      () => stop
    );
    expect(started).toEqual([1, 2]);
  });
});
