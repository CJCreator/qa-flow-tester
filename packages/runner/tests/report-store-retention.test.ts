import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { ReleaseReport } from '@qa/types';
import {
  DefaultReportStore,
  RUN_RETENTION_DAYS_DEFAULT,
  MAX_RUNS_TOTAL,
  runRetentionDays,
} from '../src/session/report-store.js';

let root: string;
let paths: { outputDir: string; dataDir: string; authDir: string };
let originalEnvRetention: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'report-retention-test-'));
  paths = {
    outputDir: path.join(root, 'out'),
    dataDir: path.join(root, 'data'),
    authDir: path.join(root, 'auth'),
  };
  await fs.mkdir(paths.outputDir, { recursive: true });
  await fs.mkdir(paths.dataDir, { recursive: true });
  await fs.mkdir(paths.authDir, { recursive: true });
  originalEnvRetention = process.env.RUNNER_RUN_RETENTION_DAYS;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalEnvRetention !== undefined) {
    process.env.RUNNER_RUN_RETENTION_DAYS = originalEnvRetention;
  } else {
    delete process.env.RUNNER_RUN_RETENTION_DAYS;
  }
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

const summary = (runId: string, timestamp: string, host = 'site.test') => ({
  runId,
  targetUrl: `https://${host}/`,
  host,
  timestamp,
  durationMs: 1,
  ready: true,
  stamp: 'ready',
  reason: '',
  counts: {},
});

async function createRun(runId: string, timestamp: string, host = 'site.test') {
  const dir = path.join(paths.outputDir, 'runs', runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary(runId, timestamp, host), null, 2), 'utf8');
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify({ runId, timestamp }), 'utf8');
}

describe('runRetentionDays parser', () => {
  it('parses valid numbers 1..365', () => {
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '1' })).toBe(1);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '7' })).toBe(7);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '30' })).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '365' })).toBe(365);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '  14  ' })).toBe(14);
  });

  it('falls back to RUN_RETENTION_DAYS_DEFAULT (30) for invalid or out-of-range values', () => {
    expect(RUN_RETENTION_DAYS_DEFAULT).toBe(30);
    expect(runRetentionDays({})).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: undefined })).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '' })).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '   ' })).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '0' })).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '-5' })).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '366' })).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: 'abc' })).toBe(30);
    expect(runRetentionDays({ RUNNER_RUN_RETENTION_DAYS: '7.5' })).toBe(30);
  });
});

describe('ReportStore retention and cap (T-359)', () => {
  it('deletes runs older than RUNNER_RUN_RETENTION_DAYS, keeping newest run per host and protected IDs', async () => {
    process.env.RUNNER_RUN_RETENTION_DAYS = '7';

    const now = Date.now();
    const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

    // Host A (3 runs):
    // - run-a-new: 2 days old (kept: within 7 days)
    // - run-a-mid: 10 days old (deleted: older than 7 days, not newest)
    // - run-a-prot: 20 days old (kept: protected by getProtectedRunIds)
    await createRun('run-a-new', daysAgo(2), 'host-a.test');
    await createRun('run-a-mid', daysAgo(10), 'host-a.test');
    await createRun('run-a-prot', daysAgo(20), 'host-a.test');

    // Host B (2 runs, both > 7 days old):
    // - run-b-new: 15 days old (kept: newest run of host-b.test)
    // - run-b-old: 25 days old (deleted: older than 7 days, not newest)
    await createRun('run-b-new', daysAgo(15), 'host-b.test');
    await createRun('run-b-old', daysAgo(25), 'host-b.test');

    // Host C (1 run, 40 days old):
    // - run-c-only: 40 days old (kept: only / newest run of host-c.test)
    await createRun('run-c-only', daysAgo(40), 'host-c.test');

    const protectedIds = ['run-a-prot'];
    const store = new DefaultReportStore(paths, () => protectedIds);

    await store.prune('host-a.test');

    const remaining = (await store.list()).map((r) => r.runId);
    expect(remaining).toContain('run-a-new');
    expect(remaining).toContain('run-a-prot');
    expect(remaining).toContain('run-b-new');
    expect(remaining).toContain('run-c-only');
    expect(remaining).not.toContain('run-a-mid');
    expect(remaining).not.toContain('run-b-old');
  });

  it('enforces MAX_RUNS_TOTAL (100) by deleting oldest unprotected runs first', async () => {
    expect(MAX_RUNS_TOTAL).toBe(100);

    const now = Date.now();
    // Create 105 runs within 1..5 days (none expired by age)
    // host-a gets 103 runs, host-b gets 2 runs
    const protectedId = 'run-a-10'; // An older run of host A marked as protected

    for (let i = 1; i <= 103; i++) {
      // run-a-1 is newest (1 minute ago), run-a-103 is oldest (103 minutes ago)
      const ts = new Date(now - i * 60_000).toISOString();
      await createRun(`run-a-${i}`, ts, 'host-a.test');
    }
    // host-b runs:
    await createRun('run-b-1', new Date(now - 10 * 60_000).toISOString(), 'host-b.test');
    await createRun('run-b-2', new Date(now - 20 * 60_000).toISOString(), 'host-b.test');

    const store = new DefaultReportStore(paths, () => [protectedId]);
    const beforeList = await store.list();
    expect(beforeList).toHaveLength(105);

    await store.prune('host-a.test');

    const afterList = await store.list();
    expect(afterList.length).toBeLessThanOrEqual(MAX_RUNS_TOTAL);

    const afterIds = new Set(afterList.map((r) => r.runId));
    // Protected run should survive
    expect(afterIds.has(protectedId)).toBe(true);
    // Newest run of host B should survive
    expect(afterIds.has('run-b-1')).toBe(true);
    // Oldest unprotected runs from host A should have been removed first
    expect(afterIds.has('run-a-103')).toBe(false);
    expect(afterIds.has('run-a-102')).toBe(false);
    expect(afterIds.has('run-a-101')).toBe(false);
    expect(afterIds.has('run-a-100')).toBe(false);
    expect(afterIds.has('run-a-99')).toBe(false);
  });

  it('keep() writes atomically, leaves no temp files, and protects the kept run', async () => {
    const store = new DefaultReportStore(paths);
    const fakeReport = {
      runId: 'run-keep-atomic',
      timestamp: new Date().toISOString(),
      durationMs: 100,
      targetUrl: 'https://site.test',
      findings: [],
      results: [],
      grades: {},
      coverage: {},
      summary: { total: 0, passed: 0, failed: 0, warnings: 0 },
    } as unknown as ReleaseReport;

    await store.keep(fakeReport, 'https://site.test', 'site.test');

    const runDir = store.dirFor('run-keep-atomic');
    const files = await fs.readdir(runDir);
    expect(files).toContain('report.json');
    expect(files).toContain('summary.json');
    expect(files.filter((f) => f.includes('.tmp-'))).toHaveLength(0);

    const savedSummary = JSON.parse(await fs.readFile(path.join(runDir, 'summary.json'), 'utf8'));
    expect(savedSummary.runId).toBe('run-keep-atomic');
    expect(savedSummary.host).toBe('site.test');
  });

  it('leaves existing files intact when atomic rename fails', async () => {
    const store = new DefaultReportStore(paths);
    const fakeReport = {
      runId: 'run-rename-fail',
      timestamp: new Date().toISOString(),
      durationMs: 100,
      targetUrl: 'https://site.test',
      findings: [],
      results: [],
      grades: {},
      coverage: {},
      summary: { total: 0, passed: 0, failed: 0, warnings: 0 },
    } as unknown as ReleaseReport;

    // First save succeeds
    await store.keep(fakeReport, 'https://site.test', 'site.test');
    const summaryPath = path.join(store.dirFor('run-rename-fail'), 'summary.json');
    const originalContent = await fs.readFile(summaryPath, 'utf8');

    // Spy on fs.rename to simulate failure during second keep
    vi.spyOn(fs, 'rename').mockImplementation(async () => {
      throw new Error('SIMULATED_RENAME_FAILURE');
    });

    const updatedReport = {
      ...fakeReport,
      durationMs: 9999,
    } as unknown as ReleaseReport;

    await expect(store.keep(updatedReport, 'https://site.test', 'site.test')).rejects.toThrow(
      'SIMULATED_RENAME_FAILURE'
    );

    // Old summary file must still be intact
    const contentAfterFailure = await fs.readFile(summaryPath, 'utf8');
    expect(contentAfterFailure).toBe(originalContent);
  });
});
