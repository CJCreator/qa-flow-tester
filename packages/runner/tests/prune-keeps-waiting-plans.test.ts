import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createCheckupSession } from '../src/session/checkup-session.js';
import { WAITING_PLAN_TTL_MS, type StoredPlanRecord } from '../src/session/plan-store.js';

let root: string;
let outputDir: string;
let dataDir: string;
let authDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'prune-waiting-'));
  outputDir = path.join(root, 'out');
  dataDir = path.join(root, 'data');
  authDir = path.join(root, 'auth');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(authDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const record = (host: string, runId: string) =>
  ({
    status: 'awaiting-review',
    plan: { runId, targetUrl: `https://${host}/`, pages: [], flows: [], questions: [] },
    context: { targetUrl: `https://${host}/`, productId: 'p', runId },
  }) as unknown as StoredPlanRecord;

async function exists(targetPath: string): Promise<boolean> {
  return fs.stat(targetPath).then(
    () => true,
    () => false
  );
}

describe('pruning keeps waiting plans across restarts (T-353)', () => {
  it('keeps a waiting plan run folder after a restart', async () => {
    const waitingPlansDir = path.join(dataDir, 'waiting-plans');
    await fs.mkdir(waitingPlansDir, { recursive: true });
    const host = 'site.test';
    const waitingFile = path.join(waitingPlansDir, `${host}.json`);
    await fs.writeFile(waitingFile, JSON.stringify(record(host, 'run-waiting')), 'utf8');

    const waitingRunDir = path.join(outputDir, 'runs', 'run-waiting');
    await fs.mkdir(waitingRunDir, { recursive: true });
    await fs.writeFile(path.join(waitingRunDir, 'shot.png'), 'fake-image-bytes', 'utf8');

    const session = createCheckupSession({ outputDir, dataDir, authDir });
    await session.report.prune('other.test');

    expect(await exists(waitingRunDir)).toBe(true);
    expect(await exists(path.join(waitingRunDir, 'shot.png'))).toBe(true);
  });

  it('deletes an unrelated unfinished run folder with no plan file', async () => {
    const staleRunDir = path.join(outputDir, 'runs', 'run-stale');
    await fs.mkdir(staleRunDir, { recursive: true });
    await fs.writeFile(path.join(staleRunDir, 'shot.png'), 'fake-image-bytes', 'utf8');

    const session = createCheckupSession({ outputDir, dataDir, authDir });
    await session.report.prune('other.test');

    expect(await exists(staleRunDir)).toBe(false);
  });

  it('deletes an expired waiting-plan run folder and removes the expired plan file', async () => {
    const waitingPlansDir = path.join(dataDir, 'waiting-plans');
    await fs.mkdir(waitingPlansDir, { recursive: true });
    const host = 'expired.test';
    const expiredFile = path.join(waitingPlansDir, `${host}.json`);
    await fs.writeFile(expiredFile, JSON.stringify(record(host, 'run-expired')), 'utf8');

    // Set mtime older than TTL
    const expiredTime = new Date(Date.now() - WAITING_PLAN_TTL_MS - 60_000);
    await fs.utimes(expiredFile, expiredTime, expiredTime);

    const expiredRunDir = path.join(outputDir, 'runs', 'run-expired');
    await fs.mkdir(expiredRunDir, { recursive: true });
    await fs.writeFile(path.join(expiredRunDir, 'shot.png'), 'fake-image-bytes', 'utf8');

    const session = createCheckupSession({ outputDir, dataDir, authDir });
    await session.report.prune('other.test');

    expect(await exists(expiredRunDir)).toBe(false);
    expect(await exists(expiredFile)).toBe(false);
  });
});
