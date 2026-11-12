import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { BenchmarkJob } from '@qa/types';
import { BenchmarkStore } from '../src/benchmarks.js';

let tmpDir: string;
let store: BenchmarkStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmarks-atomic-test-'));
  store = new BenchmarkStore(tmpDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

const sampleJob: BenchmarkJob = {
  id: 'job-1',
  status: 'done',
  stage: 'done',
  flowType: 'checkout',
  ourUrl: 'https://ours.test',
  refUrl: 'https://theirs.test',
  startedAt: new Date().toISOString(),
};

describe('BenchmarkStore atomic writes (T-359)', () => {
  it('saves and retrieves benchmark job, leaving no temp files behind', async () => {
    await store.save(sampleJob);

    const retrieved = await store.get(sampleJob.id);
    expect(retrieved).toEqual(sampleJob);

    const files = await fs.readdir(tmpDir);
    expect(files).toContain('job-1.json');
    expect(files.filter((f) => f.includes('.tmp-'))).toHaveLength(0);
  });

  it('leaves previous job file intact and readable when write fails', async () => {
    // Initial save
    await store.save(sampleJob);
    const initial = await store.get(sampleJob.id);
    expect(initial).toEqual(sampleJob);

    // Spy on fs.rename to simulate crash or rename failure
    vi.spyOn(fs, 'rename').mockImplementation(async () => {
      throw new Error('SIMULATED_RENAME_FAILURE');
    });

    const modifiedJob: BenchmarkJob = {
      ...sampleJob,
      status: 'failed',
      error: 'Something went wrong',
    };

    await expect(store.save(modifiedJob)).rejects.toThrow('SIMULATED_RENAME_FAILURE');

    // Previous job file must still be readable and unchanged
    const afterFailure = await store.get(sampleJob.id);
    expect(afterFailure).toEqual(sampleJob);

    // Temp file should have been cleaned up
    const files = await fs.readdir(tmpDir);
    expect(files.filter((f) => f.includes('.tmp-'))).toHaveLength(0);
  });
});
