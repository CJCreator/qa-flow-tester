/**
 * ADR 0046: on a Test Copy run the Testing stage's page loads and the checkers' requests share one HostPacer,
 * `parallelRoles` (1 to 10) per host at once, and a 429 or 503 from the Test Copy's site drops it to one at a time
 * for the rest of the run (ADR 0043). No browser and no real network: page loads are fakes, the checkers' network
 * is a fake NetDeps.
 */
import { describe, it, expect } from 'vitest';
import { HostPacer } from '../src/host-pacer.js';
import { makeCheckerFetch } from '../src/checker-fetch.js';
import type { NetDeps, PinnedRequest, RawResponse } from '../src/safe-net.js';
import { isAbortError } from '../src/abort.js';
import { MAX_TEST_COPY_IN_FLIGHT, pacedPageLoad, testCopyInFlight, testCopyPacer } from '../src/orchestrator.js';

const COPY = 'copy.example';
const TARGET = `https://${COPY}/`;
const tick = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms));

/** The pacer of a Test Copy run on TARGET. */
function copyPacer(parallelRoles?: number): HostPacer {
  const pacer = testCopyPacer({ testCopy: true, parallelRoles, targetUrl: TARGET });
  if (!pacer) throw new Error('a Test Copy run has a pacer');
  return pacer;
}

/** Fake page loads that count how many run at once, run-wide and at each start. */
function loadCounter() {
  let inFlight = 0;
  let max = 0;
  const atStart: number[] = [];
  const load =
    (status = 200, ms = 5) =>
    async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      atStart.push(inFlight);
      await tick(ms);
      inFlight--;
      return { ok: true, status };
    };
  return { load, max: () => max, atStart };
}

/** A fake network that counts requests in flight per host; `/busy` answers 429. */
function countingNet() {
  const inFlight = new Map<string, number>();
  let maxSameHost = 0;
  const deps: NetDeps = {
    lookup: async () => ['93.184.216.34'],
    connect: async (req: PinnedRequest): Promise<RawResponse> => {
      const host = req.url.host;
      const now = (inFlight.get(host) ?? 0) + 1;
      inFlight.set(host, now);
      maxSameHost = Math.max(maxSameHost, now);
      await tick();
      inFlight.set(host, (inFlight.get(host) ?? 1) - 1);
      const busy = req.url.pathname === '/busy';
      return { status: busy ? 429 : 200, headers: busy ? { 'retry-after': '0' } : {}, body: '' };
    },
  };
  return {
    deps,
    maxSameHost: () => maxSameHost,
    reset: () => {
      maxSameHost = 0;
    },
  };
}

describe('testCopyPacer: only a Test Copy run is paced, at parallelRoles per host', () => {
  it('no pacer unless the run is a Test Copy', () => {
    expect(testCopyPacer({ targetUrl: TARGET })).toBeUndefined();
    expect(testCopyPacer({ testCopy: false, parallelRoles: 5, targetUrl: TARGET })).toBeUndefined();
    expect(testCopyPacer({ parallelRoles: 5, targetUrl: TARGET })).toBeUndefined();
  });

  it('the cap is parallelRoles, 1 by default, clamped to 1..10', () => {
    expect(copyPacer().maxInFlight).toBe(1);
    expect(copyPacer(4).maxInFlight).toBe(4);
    expect(copyPacer(99).maxInFlight).toBe(MAX_TEST_COPY_IN_FLIGHT);
    expect(MAX_TEST_COPY_IN_FLIGHT).toBe(10);
    expect(testCopyInFlight({ parallelRoles: 0 })).toBe(1);
    expect(testCopyInFlight({ parallelRoles: -3 })).toBe(1);
    expect(testCopyInFlight({ parallelRoles: Number.NaN })).toBe(1);
    expect(testCopyInFlight({ parallelRoles: 6.7 })).toBe(6);
  });
});

describe('pacedPageLoad: Test Copy page loads take turns per host', () => {
  it('never more than N page loads of one host at once', async () => {
    const pacer = copyPacer(3);
    const loads = loadCounter();
    await Promise.all(
      Array.from({ length: 9 }, (_, i) => pacedPageLoad(pacer, `https://${COPY}/p${i}`, loads.load(), (r) => r))
    );
    expect(loads.max()).toBe(3);
  });

  it('hosts are paced apart: another host does not wait for this one', async () => {
    const pacer = copyPacer(1);
    const loads = loadCounter();
    await Promise.all([
      pacedPageLoad(pacer, `https://${COPY}/a`, loads.load(), (r) => r),
      pacedPageLoad(pacer, 'https://cdn.example/a', loads.load(), (r) => r),
    ]);
    expect(loads.max()).toBe(2);
  });

  it('a 429 drops the host to one at a time for the rest of the run, the loads already waiting included', async () => {
    const pacer = copyPacer(3);
    const loads = loadCounter();
    // The first load answers 429 first; two more are running and four are waiting for a turn.
    const runs = [
      pacedPageLoad(pacer, `https://${COPY}/busy`, loads.load(429, 2), (r) => r),
      ...Array.from({ length: 6 }, (_, i) =>
        pacedPageLoad(pacer, `https://${COPY}/p${i}`, loads.load(200, 10), (r) => r)
      ),
    ];
    await Promise.all(runs);
    expect(pacer.inFlightLimit(COPY)).toBe(1);
    // The first three started together; every load that started after the 429 ran alone.
    expect(loads.atStart.slice(0, 3)).toEqual([1, 2, 3]);
    expect(loads.atStart.slice(3)).toEqual([1, 1, 1, 1]);
    // Another host keeps the run's cap.
    expect(pacer.inFlightLimit('other.example')).toBe(3);

    // And so it stays: later loads of that host still run one at a time.
    const later = loadCounter();
    await Promise.all(
      Array.from({ length: 4 }, (_, i) => pacedPageLoad(pacer, `https://${COPY}/q${i}`, later.load(), (r) => r))
    );
    expect(later.max()).toBe(1);
  });

  it('a 503 does the same; other statuses and failed loads change nothing', async () => {
    const pacer = copyPacer(2);
    const loads = loadCounter();
    await pacedPageLoad(pacer, `https://${COPY}/ok`, loads.load(500), (r) => r);
    await pacedPageLoad(
      pacer,
      `https://${COPY}/none`,
      async () => null,
      () => undefined
    );
    await expect(
      pacedPageLoad(
        pacer,
        `https://${COPY}/throws`,
        () => Promise.reject(new Error('net')),
        () => undefined
      )
    ).rejects.toThrow('net');
    expect(pacer.inFlightLimit(COPY)).toBe(2);
    await pacedPageLoad(pacer, `https://${COPY}/down`, loads.load(503), (r) => r);
    expect(pacer.inFlightLimit(COPY)).toBe(1);
  });

  it("only the Test Copy's own site (www twin included) is slowed down; a third-party 429 changes nothing", async () => {
    const pacer = copyPacer(3);
    const loads = loadCounter();
    await pacedPageLoad(pacer, 'https://cdn.example/x', loads.load(429), (r) => r);
    expect(pacer.inFlightLimit('cdn.example')).toBe(3);
    await pacedPageLoad(pacer, `https://www.${COPY}/x`, loads.load(429), (r) => r);
    expect(pacer.inFlightLimit(`www.${COPY}`)).toBe(1);
  });

  it('a stop while waiting for a turn throws an AbortError and never starts the load', async () => {
    const pacer = copyPacer();
    let release!: () => void;
    const holding = pacedPageLoad(
      pacer,
      `https://${COPY}/slow`,
      () => new Promise<{ status: number }>((r) => (release = () => r({ status: 200 }))),
      (r) => r
    );
    const controller = new AbortController();
    let started = false;
    const waiting = pacedPageLoad(
      pacer,
      `https://${COPY}/next`,
      async () => {
        started = true;
        return { status: 200 };
      },
      (r) => r,
      controller.signal
    );
    await tick(1);
    controller.abort();
    const err = await waiting.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(started).toBe(false);
    release();
    await holding;
  });
});

describe('checker fetches on a Test Copy run share the pacer', () => {
  it('never more than N requests to one host at once, and a 429 drops the host to one', async () => {
    const pacer = copyPacer(3);
    const net = countingNet();
    const fetchFn = makeCheckerFetch({ pacer, slowDownOnBusy: true, deps: net.deps });
    const urls = Array.from({ length: 9 }, (_, i) => `https://${COPY}/f${i}`);

    await Promise.all(urls.map((u) => fetchFn(u)));
    expect(net.maxSameHost()).toBe(3);

    const busy = await fetchFn(`https://${COPY}/busy`);
    expect(busy?.status).toBe(429);
    expect(pacer.inFlightLimit(COPY)).toBe(1);

    net.reset();
    await Promise.all(urls.map((u) => fetchFn(u)));
    expect(net.maxSameHost()).toBe(1);
  });

  it('a third-party host that answers 429 keeps the cap', async () => {
    const pacer = copyPacer(3);
    const net = countingNet();
    const fetchFn = makeCheckerFetch({ pacer, slowDownOnBusy: true, deps: net.deps });
    expect((await fetchFn('https://links.example/busy'))?.status).toBe(429);
    expect(pacer.inFlightLimit('links.example')).toBe(3);
  });

  it('a page load and a checker fetch count against the same host cap', async () => {
    const pacer = copyPacer(1);
    const net = countingNet();
    const fetchFn = makeCheckerFetch({ pacer, slowDownOnBusy: true, deps: net.deps });
    const order: string[] = [];
    await Promise.all([
      pacedPageLoad(
        pacer,
        `https://${COPY}/page`,
        async () => {
          order.push('load start');
          await tick(10);
          order.push('load end');
          return { status: 200 };
        },
        (r) => r
      ),
      fetchFn(`https://${COPY}/security.txt`).then(() => order.push('fetch done')),
    ]);
    expect(order).toEqual(['load start', 'load end', 'fetch done']);
  });

  it('without slowDownOnBusy (other runs) a 429 leaves the pacing as it was', async () => {
    const pacer = new HostPacer({ maxInFlight: 3 });
    const net = countingNet();
    const fetchFn = makeCheckerFetch({ pacer, deps: net.deps });
    expect((await fetchFn(`https://${COPY}/busy`))?.status).toBe(429);
    expect(pacer.inFlightLimit(COPY)).toBe(3);
  });
});
