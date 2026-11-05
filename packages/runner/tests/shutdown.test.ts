import { describe, it, expect, afterEach, vi } from 'vitest';
import { createShutdown } from '../src/shutdown.js';

// R3: signals and unhandled rejections stop the run and the server, then exit with the given code.
describe('graceful shutdown (R3)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops the server first, then exits with the code', async () => {
    const order: string[] = [];
    const shutdown = createShutdown({
      shutdown: async () => {
        order.push('stop');
      },
      exit: (code) => order.push(`exit:${code}`),
      log: () => {},
    });

    await shutdown('SIGTERM', 0);

    expect(order).toEqual(['stop', 'exit:0']);
  });

  it('exits with code 1 for an unhandled rejection and still stops first', async () => {
    const order: string[] = [];
    const shutdown = createShutdown({
      shutdown: async () => {
        order.push('stop');
      },
      exit: (code) => order.push(`exit:${code}`),
      log: () => {},
    });

    await shutdown('Unhandled promise rejection', 1);

    expect(order).toEqual(['stop', 'exit:1']);
  });

  it('a failing stop is logged and the process still exits', async () => {
    const logs: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      shutdown: async () => {
        throw new Error('server close failed');
      },
      exit,
      log: (m) => logs.push(m),
    });

    await shutdown('SIGINT', 0);

    expect(logs.some((m) => m.includes('server close failed'))).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('runs once: a second signal while stopping exits at once without a second stop', async () => {
    let release!: () => void;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const exit = vi.fn();
    const shutdown = createShutdown({ shutdown: stop, exit, log: () => {} });

    const first = shutdown('SIGINT', 0);
    await shutdown('SIGINT', 0);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    release();
    await first;
  });

  it('forces the exit when the graceful stop takes longer than the grace period', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = createShutdown({
      shutdown: () => new Promise<void>(() => {}),
      exit,
      log: () => {},
      graceMs: 1000,
    });

    void shutdown('SIGTERM', 0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(exit).toHaveBeenCalledWith(0);
  });
});
