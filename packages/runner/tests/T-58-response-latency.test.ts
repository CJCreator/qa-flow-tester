/**
 * T-58: runner response latency. A comparison poll is small, lists read an index instead of every file, evidence
 * supports Range, JSON over 1 KB is gzipped when accepted, an idle status poll does not open the Plan file again,
 * and the waiting Plans are read from disk once.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BenchmarkJob, RunSummary } from '@qa/types';
import { BenchmarkStore } from '../src/benchmarks.js';
import { DefaultReportStore } from '../src/session/report-store.js';
import { DefaultPlanStore, type StoredPlanRecord } from '../src/session/plan-store.js';
import { RunnerServer } from '../src/server.js';

const PORT = 3758;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scratch = path.join(root, '.tmp-T-58-latency');

/** Counts the calls to fs.readFile whose path matches. */
function countReads(match: RegExp) {
  const spy = vi.spyOn(fs, 'readFile');
  return { count: () => spy.mock.calls.filter(([file]) => match.test(String(file))).length };
}

function comparison(id: string, minute: number, padding = 0): BenchmarkJob {
  return {
    id,
    status: 'done',
    stage: 'Done',
    flowType: 'checkout',
    ourUrl: 'https://ours.example/',
    refUrl: 'https://ref.example/',
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    ...(padding ? { result: { padding: 'x'.repeat(padding) } as unknown as BenchmarkJob['result'] } : {}),
  };
}

function runSummary(runId: string, minute: number): RunSummary {
  return {
    runId,
    targetUrl: 'https://site.example/',
    host: 'site.example',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    durationMs: 1000,
    ready: true,
    stamp: 'ready',
    reason: '',
    counts: {},
  } as unknown as RunSummary;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('GET /api/runner/benchmark/<id>/progress', () => {
  let runner: RunnerServer | undefined;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = path.join(scratch, 'data');
    runner = new RunnerServer({ port: PORT, outputDir: path.join(scratch, 'report'), dataDir });
    await runner.start();
  });

  afterEach(async () => {
    await runner?.stop();
    runner = undefined;
  });

  it('answers the state of a finished comparison in under 1 KB, without its result', async () => {
    await fs.mkdir(path.join(dataDir, 'benchmarks'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'benchmarks', 'bench-1.json'), JSON.stringify(comparison('bench-1', 1, 5000)));

    const res = await fetch(`http://localhost:${PORT}/api/runner/benchmark/bench-1/progress`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(Buffer.byteLength(text)).toBeLessThan(1024);
    expect(JSON.parse(text)).toMatchObject({ id: 'bench-1', status: 'done', stage: 'Done' });
    expect(text).not.toContain('padding');
  });

  it('answers 404 for a comparison that is not there', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/runner/benchmark/bench-missing/progress`);

    expect(res.status).toBe(404);
  });
});

describe('BenchmarkStore list', () => {
  it('reads the index, not every comparison, once it is built', async () => {
    const store = new BenchmarkStore(path.join(scratch, 'benchmarks'));
    for (let i = 1; i <= 5; i++) await store.save(comparison(`bench-${i}`, i));
    await store.list();
    const reads = countReads(/bench-\d+\.json$/);

    const listed = await store.list();

    expect(listed.map((j) => j.id)).toEqual(['bench-5', 'bench-4', 'bench-3', 'bench-2', 'bench-1']);
    expect(listed[0]).not.toHaveProperty('result');
    expect(reads.count()).toBe(0);
  });

  it('keeps the newest ten and drops a removed comparison from the index', async () => {
    const store = new BenchmarkStore(path.join(scratch, 'benchmarks'));
    for (let i = 1; i <= 12; i++) await store.save(comparison(`bench-${i}`, i));
    expect((await store.list()).map((j) => j.id)[0]).toBe('bench-12');
    expect(await store.list()).toHaveLength(10);

    await store.remove('bench-12');

    expect((await store.list()).map((j) => j.id)[0]).toBe('bench-11');
  });
});

describe('DefaultReportStore list', () => {
  it('reads the index, not 100 summaries, when a list is asked for again', async () => {
    const outputDir = path.join(scratch, 'report');
    for (let i = 0; i < 100; i++) {
      const runId = `run-${String(i).padStart(3, '0')}`;
      await fs.mkdir(path.join(outputDir, 'runs', runId), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'runs', runId, 'summary.json'), JSON.stringify(runSummary(runId, i)));
    }
    const store = new DefaultReportStore({ outputDir, dataDir: path.join(scratch, 'data'), authDir: path.join(scratch, 'auth') });
    expect(await store.list()).toHaveLength(100);
    const reads = countReads(/summary\.json$/);

    const runs = await store.list();

    expect(runs).toHaveLength(100);
    expect(runs[0].runId).toBe('run-099');
    expect(reads.count()).toBe(0);
  });

  it('reads the folders again when one was added outside the store', async () => {
    const outputDir = path.join(scratch, 'report');
    await fs.mkdir(path.join(outputDir, 'runs', 'run-001'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'runs', 'run-001', 'summary.json'), JSON.stringify(runSummary('run-001', 1)));
    const store = new DefaultReportStore({ outputDir, dataDir: path.join(scratch, 'data'), authDir: path.join(scratch, 'auth') });
    expect(await store.list()).toHaveLength(1);

    await fs.mkdir(path.join(outputDir, 'runs', 'run-002'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'runs', 'run-002', 'summary.json'), JSON.stringify(runSummary('run-002', 2)));

    expect((await store.list()).map((r) => r.runId)).toEqual(['run-002', 'run-001']);
  });
});

describe('DefaultPlanStore waiting Plans', () => {
  it('reads the waiting-plans folder once and answers from memory after that', async () => {
    const dataDir = path.join(scratch, 'plans-data');
    const record = {
      schemaVersion: 1,
      status: 'awaiting-review',
      plan: { targetUrl: 'https://example.com/', runId: 'run-1', pages: [], discoveredAt: '2026-01-01T00:00:00.000Z' },
      context: { targetUrl: 'https://example.com/', productId: 'p', runId: 'run-1', draft: { pages: [] } },
    };
    await fs.mkdir(path.join(dataDir, 'waiting-plans'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'waiting-plans', 'example.com.json'), JSON.stringify(record));
    const store = new DefaultPlanStore(dataDir, {} as never);
    expect(await store.waiting()).toHaveLength(1);
    const reads = countReads(/waiting-plans/);

    const second = await store.waiting();

    expect(second).toHaveLength(1);
    expect(second[0].host).toBe('example.com');
    expect(reads.count()).toBe(0);
  });
});

describe('GET /api/runner/status', () => {
  let runner: RunnerServer | undefined;

  beforeEach(async () => {
    runner = new RunnerServer({ port: PORT, outputDir: path.join(scratch, 'report'), dataDir: path.join(scratch, 'data') });
    await runner.start();
  });

  afterEach(async () => {
    await runner?.stop();
    runner = undefined;
  });

  it('does not open the Plan file again on idle polls within the cache window', async () => {
    await fetch(`http://localhost:${PORT}/api/runner/status`);
    const reads = countReads(/\.qa-plan\.json$/);

    await fetch(`http://localhost:${PORT}/api/runner/status`);
    await fetch(`http://localhost:${PORT}/api/runner/status`);

    expect(reads.count()).toBe(0);
  });

  it('looks at the Plan file again once the cache window has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await fetch(`http://localhost:${PORT}/api/runner/status`);
    const reads = countReads(/\.qa-plan\.json$/);
    vi.setSystemTime(Date.now() + 60_000);

    await fetch(`http://localhost:${PORT}/api/runner/status`);

    expect(reads.count()).toBe(1);
  });
});

describe('GET /api/evidence/* and gzip', () => {
  let runner: RunnerServer | undefined;
  let outputDir: string;

  beforeEach(async () => {
    outputDir = path.join(scratch, 'report');
    runner = new RunnerServer({ port: PORT, outputDir, dataDir: path.join(scratch, 'data') });
    await runner.start();
  });

  afterEach(async () => {
    await runner?.stop();
    runner = undefined;
  });

  it('answers a Range request for a video with 206 and only that part', async () => {
    const dir = path.join(outputDir, 'runs', 'run-1', 'evidence');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'clip.webm'), Buffer.alloc(1000, 7));

    const res = await fetch(`http://localhost:${PORT}/api/evidence/runs/run-1/evidence/clip.webm`, {
      headers: { Range: 'bytes=0-99' },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect(res.headers.get('content-type')).toBe('video/webm');
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('answers 416 for a range past the end of the file', async () => {
    const dir = path.join(outputDir, 'runs', 'run-1', 'evidence');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'clip.webm'), Buffer.alloc(1000, 7));

    const res = await fetch(`http://localhost:${PORT}/api/evidence/runs/run-1/evidence/clip.webm`, {
      headers: { Range: 'bytes=5000-6000' },
    });

    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
  });

  it('sends the whole file with a cache header when there is no Range', async () => {
    const dir = path.join(outputDir, 'runs', 'run-1', 'evidence');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'shot.png'), Buffer.alloc(1000, 7));

    const res = await fetch(`http://localhost:${PORT}/api/evidence/runs/run-1/evidence/shot.png`, {
      headers: { 'Accept-Encoding': 'identity' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('cache-control')).toContain('max-age=');
    expect((await res.arrayBuffer()).byteLength).toBe(1000);
  });

  it('gzips a JSON answer over 1 KB when the browser accepts gzip', async () => {
    for (let i = 1; i <= 20; i++) {
      const runId = `run-${String(i).padStart(2, '0')}`;
      await fs.mkdir(path.join(outputDir, 'runs', runId), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'runs', runId, 'summary.json'), JSON.stringify(runSummary(runId, i)));
    }

    const res = await fetch(`http://localhost:${PORT}/api/runs`, { headers: { 'Accept-Encoding': 'gzip' } });

    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(((await res.json()) as { runs: unknown[] }).runs).toHaveLength(20);
  });

  it('sends a JSON answer over 1 KB unzipped when gzip is not accepted', async () => {
    for (let i = 1; i <= 20; i++) {
      const runId = `run-${String(i).padStart(2, '0')}`;
      await fs.mkdir(path.join(outputDir, 'runs', runId), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'runs', runId, 'summary.json'), JSON.stringify(runSummary(runId, i)));
    }

    const res = await fetch(`http://localhost:${PORT}/api/runs`, { headers: { 'Accept-Encoding': 'identity' } });

    expect(res.headers.get('content-encoding')).toBeNull();
    expect(((await res.json()) as { runs: unknown[] }).runs).toHaveLength(20);
  });
});
