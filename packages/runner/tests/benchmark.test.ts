/**
 * Comparing two sites: the kept results, and a real comparison, which visits both sites (here the
 * built-in test app twice) instead of working from made-up numbers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { BenchmarkJob } from '@qa/types';
import { RunnerServer } from '../src/server.js';
import { BenchmarkStore, cleanFlowType, siteName } from '../src/benchmarks.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

const scratch = path.join(process.cwd(), '.tmp-benchmark');

function job(n: number): BenchmarkJob {
  return {
    id: `bench-${1000 + n}`,
    status: 'done',
    stage: 'Done',
    flowType: 'checkout',
    ourUrl: 'https://a.example/',
    refUrl: 'https://b.example/',
    startedAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
  };
}

describe('Kept comparisons', () => {
  const dir = path.join(scratch, 'store');
  afterAll(async () => {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  });

  it('lists the newest first and keeps only the last ten', async () => {
    const store = new BenchmarkStore(dir);
    for (let n = 0; n < 12; n++) await store.save(job(n));
    const kept = await store.list();
    expect(kept).toHaveLength(10);
    expect(kept[0].id).toBe('bench-1011');
    expect(kept[9].id).toBe('bench-1002');
    expect(await store.get('bench-1000')).toBeNull();
  });

  it('removes one on request, and says when it was not there', async () => {
    const store = new BenchmarkStore(dir);
    expect(await store.remove('bench-1011')).toBe(true);
    expect(await store.remove('bench-1011')).toBe(false);
    expect(await store.get('bench-1011')).toBeNull();
  });

  it('names a site by its host unless a name is given, and falls back to a general flow', () => {
    expect(siteName('https://www.example.com/pricing')).toBe('www.example.com');
    expect(siteName('http://localhost:3050/')).toBe('localhost:3050');
    expect(siteName('https://www.example.com/pricing', ' Acme ')).toBe('Acme');
    expect(cleanFlowType('checkout')).toBe('checkout');
    expect(cleanFlowType('<script>')).toBe('custom');
    expect(cleanFlowType(undefined)).toBe('custom');
  });
});

describe('Comparing two sites', () => {
  const FIXTURE_PORT = 3188;
  const RUNNER_PORT = 3189;
  const fixture = `http://localhost:${FIXTURE_PORT}/`;
  const base = `http://localhost:${RUNNER_PORT}`;
  let runner: RunnerServer;

  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
    });
    await runner.start();
  });

  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  });

  const post = (body: unknown) =>
    fetch(`${base}/api/runner/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const startCheckup = () =>
    fetch(`${base}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: fixture, skipReview: true }),
    });

  it('asks for both addresses', async () => {
    expect((await post({ ourUrl: fixture })).status).toBe(400);
    expect((await post({ ourUrl: fixture, refUrl: 'not an address at all' })).status).toBe(400);
    expect((await post({ ourUrl: 'ftp://example.com', refUrl: fixture })).status).toBe(400);
  });

  it('visits both sites and measures what it finds, rather than using preset numbers', async () => {
    const started = await post({ ourUrl: fixture, refUrl: fixture, flowType: 'checkout' });
    expect(started.status).toBe(202);
    const { id } = (await started.json()) as { id: string };

    // One at a time: a second comparison is turned away while this one runs.
    expect((await post({ ourUrl: fixture, refUrl: fixture })).status).toBe(409);
    // REQ-049 AC-3: the benchmark holds the one run slot, so a Check-up start is refused too.
    expect(runner.session.run.kind).toBe('benchmark');
    const checkup = await startCheckup();
    expect(checkup.status).toBe(409);
    expect(((await checkup.json()) as { code: string }).code).toBe('ERR_RUN_IN_PROGRESS');
    expect(runner.session.run.begin('audit-1', fixture, 'audit')).toBe(false);

    let current: BenchmarkJob | undefined;
    for (let i = 0; i < 160 && current?.status !== 'done' && current?.status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      current = (await (await fetch(`${base}/api/runner/benchmark/${id}`)).json()) as BenchmarkJob;
    }
    expect(current?.error).toBeUndefined();
    expect(current?.status).toBe('done');
    const result = current!.result!;
    expect(result.flowId).toBe('checkout');
    // The same site on both sides measures the same: no preset "4 steps against 2".
    expect(result.ourProduct.scorecard.totalSteps).toBeGreaterThan(0);
    expect(result.delta.stepDifference).toBe(0);
    expect(result.delta.fieldDifference).toBe(0);
    expect(result.ourProduct.screenshots).toEqual([]);
    expect(typeof current!.aiUsed).toBe('boolean');
    // The slot is given back once the benchmark has finished.
    expect(runner.session.run.kind).toBeNull();

    // Kept: it is on the list (without its full result), can be opened again, and can be removed.
    const list = (await (await fetch(`${base}/api/runner/benchmarks`)).json()) as BenchmarkJob[];
    expect(list.find((j) => j.id === id)).toMatchObject({ status: 'done', flowType: 'checkout' });
    expect(list.find((j) => j.id === id)).not.toHaveProperty('result');
    expect((await fetch(`${base}/api/runner/benchmark/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${base}/api/runner/benchmark/${id}`)).status).toBe(404);
  }, 120000);

  it('says so when the comparison is not there', async () => {
    expect((await fetch(`${base}/api/runner/benchmark/bench-0`)).status).toBe(404);
  });

  it('REQ-049 AC-2: a Website Audit holding the slot refuses a Check-up and a benchmark with 409', async () => {
    expect(runner.session.run.begin('audit-1', fixture, 'audit')).toBe(true);
    try {
      const checkup = await startCheckup();
      expect(checkup.status).toBe(409);
      expect(((await checkup.json()) as { code: string }).code).toBe('ERR_RUN_IN_PROGRESS');
      const bench = await post({ ourUrl: fixture, refUrl: fixture });
      expect(bench.status).toBe(409);
      expect(((await bench.json()) as { code: string }).code).toBe('ERR_RUN_IN_PROGRESS');
      expect(runner.session.run.kind).toBe('audit');
    } finally {
      runner.session.run.release();
    }
    expect(runner.session.run.kind).toBeNull();
  });

  it('REQ-049 AC-4: a benchmark and a Check-up started together: exactly one claims the slot', async () => {
    const [bench, checkup] = await Promise.all([post({ ourUrl: fixture, refUrl: fixture }), startCheckup()]);
    expect([bench.status, checkup.status].sort()).toEqual([202, 409]);
    const refused = bench.status === 409 ? bench : checkup;
    expect(((await refused.json()) as { code: string }).code).toBe('ERR_RUN_IN_PROGRESS');

    if (checkup.status === 202) {
      expect(runner.session.run.kind).toBe('checkup');
      // Stop until idle: a stopped run can be left awaiting review once.
      for (let i = 0; i < 3 && runner.session.run.isRunning; i++) {
        await fetch(`${base}/api/runner/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discard: true }),
        });
      }
    } else {
      const { id } = (await bench.json()) as { id: string };
      let current: BenchmarkJob | undefined;
      for (let i = 0; i < 160 && current?.status !== 'done' && current?.status !== 'failed'; i++) {
        await new Promise((r) => setTimeout(r, 500));
        current = (await (await fetch(`${base}/api/runner/benchmark/${id}`)).json()) as BenchmarkJob;
      }
      expect(runner.session.run.kind).toBeNull();
    }
  }, 120000);
});
