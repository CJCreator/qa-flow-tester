/**
 * REQ-035 (ADR 0015): one request at a time per host, robots.txt Crawl-delay honoured between them.
 * The clock and the timer are fakes, so nothing here waits for real time.
 */
import { describe, it, expect } from 'vitest';
import { HostPacer } from '../src/host-pacer.js';
import { makeOutboundFetch, type NetDeps, type PinnedRequest, type RawResponse } from '../src/safe-net.js';

/** A manual clock: `sleep` resolves only when `advance` moves time past its end. */
function fakeClock() {
  let t = 1_000;
  const sleepers: Array<{ at: number; resolve: () => void; reject: (e: unknown) => void }> = [];
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    now: () => t,
    sleep: (ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const s = { at: t + ms, resolve, reject };
        sleepers.push(s);
        signal?.addEventListener('abort', () => {
          const i = sleepers.indexOf(s);
          if (i === -1) return;
          sleepers.splice(i, 1);
          reject(signal.reason);
        });
      }),
    async advance(ms: number) {
      t += ms;
      for (const s of sleepers.filter((x) => x.at <= t)) {
        sleepers.splice(sleepers.indexOf(s), 1);
        s.resolve();
      }
      await flush();
    },
    flush,
    pendingSleeps: () => sleepers.length,
  };
}

/** A task that runs until `finish()` is called, recording when it started. */
function controlled(log: string[], name: string, clock: { now: () => number }) {
  let finish!: () => void;
  let fail!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => {
    finish = res;
    fail = rej;
  });
  const starts: number[] = [];
  const task = async () => {
    starts.push(clock.now());
    log.push(`start ${name}`);
    await done;
    log.push(`end ${name}`);
    return name;
  };
  return { task, finish: () => finish(), fail: (e: Error) => fail(e), starts };
}

describe('HostPacer', () => {
  it('uses the larger of minGapMs and the Crawl-delay', () => {
    expect(new HostPacer({ minGapMs: 100, crawlDelayMs: 1000 }).gapMs).toBe(1000);
    expect(new HostPacer({ minGapMs: 250, crawlDelayMs: 0 }).gapMs).toBe(250);
    expect(new HostPacer({ minGapMs: 250 }).gapMs).toBe(250);
    expect(new HostPacer().gapMs).toBe(0);
  });

  it('lets one task per host run at a time', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ now: clock.now, sleep: clock.sleep });
    const log: string[] = [];
    const a = controlled(log, 'a', clock);
    const b = controlled(log, 'b', clock);

    const pa = pacer.run('shop.example', a.task);
    const pb = pacer.run('shop.example', b.task);
    await clock.flush();
    expect(log).toEqual(['start a']);

    a.finish();
    await expect(pa).resolves.toBe('a');
    await clock.flush();
    expect(log).toEqual(['start a', 'end a', 'start b']);
    b.finish();
    await expect(pb).resolves.toBe('b');
  });

  it('waits the gap after a task ends before starting the next', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ crawlDelayMs: 1000, now: clock.now, sleep: clock.sleep });
    const log: string[] = [];
    const a = controlled(log, 'a', clock);
    const b = controlled(log, 'b', clock);

    const pa = pacer.run('shop.example', a.task);
    const pb = pacer.run('shop.example', b.task);
    await clock.flush();
    await clock.advance(300);
    a.finish();
    await pa;
    await clock.flush();
    expect(log).toEqual(['start a', 'end a']);

    await clock.advance(999);
    expect(log).toEqual(['start a', 'end a']);
    await clock.advance(1);
    expect(log).toEqual(['start a', 'end a', 'start b']);
    expect(b.starts[0] - a.starts[0]).toBeGreaterThanOrEqual(1000);
    b.finish();
    await pb;
  });

  it('a timer firing early does not shorten the gap', async () => {
    const clock = fakeClock();
    // A sleep that always returns 10 ms short.
    const earlySleep = (ms: number, signal?: AbortSignal) => clock.sleep(Math.max(0, ms - 10), signal);
    const pacer = new HostPacer({ crawlDelayMs: 500, now: clock.now, sleep: earlySleep });
    const starts: number[] = [];
    const record = async () => void starts.push(clock.now());

    await pacer.run('h', record);
    const second = pacer.run('h', record);
    await clock.flush();
    await clock.advance(490);
    expect(starts).toHaveLength(1);
    await clock.advance(10);
    await second;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(500);
  });

  it('keeps different hosts independent', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ crawlDelayMs: 1000, now: clock.now, sleep: clock.sleep });
    const log: string[] = [];
    const a = controlled(log, 'a', clock);
    const b = controlled(log, 'b', clock);

    const pa = pacer.run('one.example', a.task);
    const pb = pacer.run('two.example', b.task);
    await clock.flush();
    expect(log).toEqual(['start a', 'start b']);
    a.finish();
    b.finish();
    await Promise.all([pa, pb]);
  });

  it('treats host names case-insensitively', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ now: clock.now, sleep: clock.sleep });
    const log: string[] = [];
    const a = controlled(log, 'a', clock);
    const b = controlled(log, 'b', clock);
    const pa = pacer.run('Shop.Example', a.task);
    const pb = pacer.run('shop.example', b.task);
    await clock.flush();
    expect(log).toEqual(['start a']);
    a.finish();
    await pa;
    await clock.flush();
    b.finish();
    await pb;
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('a failing task releases the turn', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ now: clock.now, sleep: clock.sleep });
    const log: string[] = [];
    const a = controlled(log, 'a', clock);
    const b = controlled(log, 'b', clock);

    const pa = pacer.run('h', a.task);
    const pb = pacer.run('h', b.task);
    await clock.flush();
    a.fail(new Error('connection reset'));
    await expect(pa).rejects.toThrow('connection reset');
    await clock.flush();
    expect(log).toEqual(['start a', 'start b']);
    b.finish();
    await expect(pb).resolves.toBe('b');
  });

  it('an abort stops a task waiting for the turn, and the queue goes on without it', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ now: clock.now, sleep: clock.sleep });
    const log: string[] = [];
    const a = controlled(log, 'a', clock);
    const b = controlled(log, 'b', clock);
    const c = controlled(log, 'c', clock);
    const ctrl = new AbortController();

    const pa = pacer.run('h', a.task);
    const pb = pacer.run('h', b.task, ctrl.signal);
    const pc = pacer.run('h', c.task);
    await clock.flush();
    ctrl.abort(new Error('stopped'));
    await expect(pb).rejects.toThrow('stopped');

    a.finish();
    await pa;
    await clock.flush();
    expect(log).toEqual(['start a', 'end a', 'start c']);
    c.finish();
    await pc;
  });

  it('an abort stops a task waiting out the gap, and that wait does not count as a request', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ crawlDelayMs: 1000, now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    const record = async () => void starts.push(clock.now());
    const ctrl = new AbortController();

    await pacer.run('h', record);
    const waiting = pacer.run('h', record, ctrl.signal);
    await clock.flush();
    expect(clock.pendingSleeps()).toBe(1);
    await clock.advance(400);
    ctrl.abort(new Error('deadline'));
    await expect(waiting).rejects.toThrow('deadline');
    expect(starts).toHaveLength(1);

    // The gap still runs from the first request's end, not from the aborted wait.
    const next = pacer.run('h', record);
    await clock.flush();
    await clock.advance(600);
    await next;
    expect(starts).toEqual([1_000, 2_000]);
  });

  it('an already aborted signal never starts the task', async () => {
    const pacer = new HostPacer();
    const ctrl = new AbortController();
    ctrl.abort(new Error('gone'));
    let ran = false;
    await expect(
      pacer.run(
        'h',
        async () => {
          ran = true;
        },
        ctrl.signal
      )
    ).rejects.toThrow('gone');
    expect(ran).toBe(false);
  });

  it('a task inside the same host turn runs without waiting for itself', async () => {
    const pacer = new HostPacer({ crawlDelayMs: 1000 });
    const result = await pacer.run('h', () => pacer.run('h', async () => 'inner'));
    expect(result).toBe('inner');
  });
});

describe('HostPacer with maxInFlight (ADR 0043)', () => {
  it('runs up to maxInFlight tasks of one host at once, their starts a gap apart', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ minGapMs: 500, maxInFlight: 3, now: clock.now, sleep: clock.sleep });
    const log: string[] = [];
    const tasks = ['a', 'b', 'c', 'd'].map((n) => controlled(log, n, clock));
    const runs = tasks.map((t) => pacer.run('shop.example', t.task));

    await clock.flush();
    expect(log).toEqual(['start a']);
    await clock.advance(500);
    expect(log).toEqual(['start a', 'start b']);
    await clock.advance(500);
    expect(log).toEqual(['start a', 'start b', 'start c']);
    // A fourth waits for a free slot, however long it waits.
    await clock.advance(5_000);
    expect(log).toEqual(['start a', 'start b', 'start c']);

    tasks[0].finish();
    await runs[0];
    await clock.flush();
    expect(log).toEqual(['start a', 'start b', 'start c', 'end a', 'start d']);
    for (const t of tasks.slice(1)) t.finish();
    await Promise.all(runs);
  });

  it('a robots Crawl-delay keeps the host at one at a time', () => {
    expect(new HostPacer({ maxInFlight: 3, crawlDelayMs: 2000 }).maxInFlight).toBe(1);
    expect(new HostPacer({ maxInFlight: 3, crawlDelayMs: 0 }).maxInFlight).toBe(3);
    expect(new HostPacer().maxInFlight).toBe(1);
  });

  it('slowDown: one at a time from then on, Retry-After waited out, capped at 60 s', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ minGapMs: 500, maxInFlight: 3, now: clock.now, sleep: clock.sleep });
    const log: string[] = [];
    const a = controlled(log, 'a', clock);
    const pa = pacer.run('shop.example', a.task);
    await clock.flush();

    pacer.slowDown('Shop.Example', 120_000);
    expect(pacer.inFlightLimit('shop.example')).toBe(1);
    const b = controlled(log, 'b', clock);
    const pb = pacer.run('shop.example', b.task);
    await clock.advance(1_000);
    expect(log).toEqual(['start a']);

    a.finish();
    await pa;
    // Retry-After 120 s is capped at 60 s from the slowDown.
    await clock.advance(58_000);
    expect(log).toEqual(['start a', 'end a']);
    await clock.advance(1_000);
    expect(log).toEqual(['start a', 'end a', 'start b']);
    b.finish();
    await pb;
  });

  it('a second slowDown doubles the gap, up to 10 s', async () => {
    const clock = fakeClock();
    const pacer = new HostPacer({ minGapMs: 4_000, maxInFlight: 3, now: clock.now, sleep: clock.sleep });
    pacer.slowDown('shop.example');
    pacer.slowDown('shop.example');
    const log: string[] = [];
    const a = controlled(log, 'a', clock);
    const b = controlled(log, 'b', clock);
    const pa = pacer.run('shop.example', a.task);
    const pb = pacer.run('shop.example', b.task);
    await clock.flush();
    a.finish();
    await pa;
    await clock.advance(7_999);
    expect(log).toEqual(['start a', 'end a']);
    await clock.advance(1);
    expect(log).toEqual(['start a', 'end a', 'start b']);
    b.finish();
    await pb;

    pacer.slowDown('shop.example');
    const c = controlled(log, 'c', clock);
    const pc = pacer.run('shop.example', c.task);
    await clock.advance(9_999);
    expect(log).not.toContain('start c');
    await clock.advance(1);
    expect(log).toContain('start c');
    c.finish();
    await pc;
  });
});

describe('makeOutboundFetch with a pacer', () => {
  /** A fake network that counts requests in flight per host. */
  function countingNet() {
    const inFlight = new Map<string, number>();
    let maxSameHost = 0;
    let maxTotal = 0;
    const deps: NetDeps = {
      lookup: async () => ['93.184.216.34'],
      connect: async (req: PinnedRequest): Promise<RawResponse> => {
        const host = req.url.host;
        inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
        maxSameHost = Math.max(maxSameHost, inFlight.get(host)!);
        maxTotal = Math.max(
          maxTotal,
          [...inFlight.values()].reduce((a, b) => a + b, 0)
        );
        await new Promise((r) => setTimeout(r, 5));
        inFlight.set(host, inFlight.get(host)! - 1);
        return { status: 200, headers: {}, body: req.url.pathname };
      },
    };
    return { deps, max: () => ({ maxSameHost, maxTotal }) };
  }

  it('sends one request at a time to a host, other hosts in parallel', async () => {
    const net = countingNet();
    const fetchFn = makeOutboundFetch({ deps: net.deps, pacer: new HostPacer() });
    const urls = ['/a', '/b', '/c'].flatMap((p) => [`https://one.example${p}`, `https://two.example${p}`]);
    const res = await Promise.all(urls.map((u) => fetchFn(u)));
    expect(await Promise.all(res.map((r) => r!.text()))).toEqual(['/a', '/a', '/b', '/b', '/c', '/c']);
    expect(net.max().maxSameHost).toBe(1);
    expect(net.max().maxTotal).toBe(2);
  });

  it('without a pacer, requests to one host still go out together', async () => {
    const net = countingNet();
    const fetchFn = makeOutboundFetch({ deps: net.deps });
    await Promise.all(['/a', '/b', '/c'].map((p) => fetchFn(`https://one.example${p}`)));
    expect(net.max().maxSameHost).toBe(3);
  });

  it('a fetch shares the turn of a paced task on the same host instead of waiting for it', async () => {
    const net = countingNet();
    const pacer = new HostPacer({ crawlDelayMs: 1000 });
    const fetchFn = makeOutboundFetch({ deps: net.deps, pacer });
    const res = await pacer.run('one.example', () => fetchFn('https://one.example/robots.txt'));
    expect(res?.status).toBe(200);
  });
});
