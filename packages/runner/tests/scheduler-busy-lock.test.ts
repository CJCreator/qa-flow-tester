/**
 * R4 and R5 (ADR 0039): a run refused because the slot is busy is retried, not dropped or recorded as failed;
 * saves of the schedule list are serialised and atomic, so concurrent adds, pauses and ticks do not lose each other.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { BUSY_RETRY_MS, FileScheduleStore, SchedulerManager, type CheckupSchedule } from '../src/scheduler.js';

const scratch = path.join(process.cwd(), '.tmp-scheduler-busy-lock');

const input = {
  name: 'Nightly',
  targetUrl: 'http://localhost:3050',
  cadence: 'daily' as const,
  hour: 2,
  preset: 'quick' as const,
  enabled: true,
};

describe('R5: a busy slot is retried, not dropped', () => {
  let scheduler: SchedulerManager;

  beforeEach(async () => {
    await fs.mkdir(scratch, { recursive: true });
    scheduler = new SchedulerManager(scratch);
  });

  afterEach(async () => {
    scheduler.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  const dueSchedule = async (): Promise<CheckupSchedule> => {
    const added = await scheduler.addSchedule(input);
    const all = await scheduler.loadSchedules();
    all[0].nextRunAt = new Date(Date.now() - 1000).toISOString();
    await scheduler.saveSchedules(all);
    return added;
  };

  it('a busy outcome counts as retrying, not failed or started, and sets retryAt about BUSY_RETRY_MS ahead', async () => {
    const added = await dueSchedule();
    const before = Date.now();
    const summary = await scheduler.tick(async () => 'busy');

    expect(summary).toMatchObject({ started: 0, failed: 0, retrying: 1, busy: false });
    const [saved] = await scheduler.loadSchedules();
    expect(saved.id).toBe(added.id);
    expect(saved.retryAt).toBeDefined();
    const retryAt = Date.parse(saved.retryAt!);
    expect(retryAt).toBeGreaterThanOrEqual(before + BUSY_RETRY_MS - 1000);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + BUSY_RETRY_MS + 1000);
  });

  it('a busy run is not recorded as failed, and keeps the last real run time and status', async () => {
    await dueSchedule();
    await scheduler.tick(async () => true);
    const all = await scheduler.loadSchedules();
    all[0].nextRunAt = new Date(Date.now() - 1000).toISOString();
    await scheduler.saveSchedules(all);
    const lastRun = (await scheduler.loadSchedules())[0].lastRunAt;
    const lastStatus = (await scheduler.loadSchedules())[0].lastRunStatus;
    expect(lastStatus).toBe('passed');

    await scheduler.tick(async () => 'busy');
    const [saved] = await scheduler.loadSchedules();
    expect(saved.lastRunStatus).toBe('passed');
    expect(saved.lastRunAt).toBe(lastRun);
  });

  it('a schedule with a busy retry is not run again before retryAt', async () => {
    await dueSchedule();
    await scheduler.tick(async () => 'busy');
    const again: CheckupSchedule[] = [];
    const summary = await scheduler.tick(async (s) => {
      again.push(s);
      return true;
    });
    expect(again).toHaveLength(0);
    expect(summary).toMatchObject({ started: 0, skipped: 1 });
  });

  it('once retryAt has passed the schedule runs, and the retry is cleared', async () => {
    await dueSchedule();
    await scheduler.tick(async () => 'busy');
    const all = await scheduler.loadSchedules();
    all[0].retryAt = new Date(Date.now() - 1000).toISOString();
    await scheduler.saveSchedules(all);

    const fired: string[] = [];
    const summary = await scheduler.tick(async (s) => {
      fired.push(s.id);
      return true;
    });
    expect(fired).toHaveLength(1);
    expect(summary).toMatchObject({ started: 1, retrying: 0 });
    const [saved] = await scheduler.loadSchedules();
    expect(saved.retryAt).toBeUndefined();
    expect(saved.lastRunStatus).toBe('passed');
  });

  it('a run that failed (false) is still recorded as failed, not retried', async () => {
    await dueSchedule();
    const summary = await scheduler.tick(async () => false);
    expect(summary).toMatchObject({ failed: 1, retrying: 0 });
    const [saved] = await scheduler.loadSchedules();
    expect(saved.lastRunStatus).toBe('failed');
    expect(saved.retryAt).toBeUndefined();
  });
});

describe('R4: the schedule store is atomic and its saves are serialised', () => {
  const dir = path.join(process.cwd(), '.tmp-scheduler-store-lock');

  beforeEach(async () => {
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('FileScheduleStore.write leaves only schedules.json behind and it parses back', async () => {
    const store = new FileScheduleStore(dir);
    await store.write([{ id: 'sched_1_a', ...input, createdAt: 'x', nextRunAt: 'y' } as CheckupSchedule]);
    expect(await fs.readdir(dir)).toEqual(['schedules.json']);
    const parsed = JSON.parse(await fs.readFile(path.join(dir, 'schedules.json'), 'utf8')) as unknown[];
    expect(parsed).toHaveLength(1);
  });

  it('concurrent adds all survive (no lost write)', async () => {
    const scheduler = new SchedulerManager(dir);
    const added = await Promise.all([1, 2, 3, 4, 5].map((n) => scheduler.addSchedule({ ...input, name: `s${n}` })));
    const saved = await scheduler.loadSchedules();
    expect(saved.map((s) => s.id).sort()).toEqual(added.map((s) => s.id).sort());
  });

  it('a schedule added while a tick is running is kept after the tick', async () => {
    const scheduler = new SchedulerManager(dir);
    const due = await scheduler.addSchedule(input);
    const all = await scheduler.loadSchedules();
    all[0].nextRunAt = new Date(Date.now() - 1000).toISOString();
    await scheduler.saveSchedules(all);

    const tick = scheduler.tick(async () => {
      await scheduler.addSchedule({ ...input, name: 'added during the run' });
      return true;
    });
    const summary = await tick;
    expect(summary.started).toBe(1);
    const saved = await scheduler.loadSchedules();
    expect(saved.map((s) => s.name)).toContain('added during the run');
    expect(saved.find((s) => s.id === due.id)?.lastRunStatus).toBe('passed');
  });

  it('a delete and a pause issued together both apply', async () => {
    const scheduler = new SchedulerManager(dir);
    const a = await scheduler.addSchedule({ ...input, name: 'a' });
    const b = await scheduler.addSchedule({ ...input, name: 'b' });
    await Promise.all([scheduler.deleteSchedule(a.id), scheduler.toggleSchedule(b.id, false)]);
    const saved = await scheduler.loadSchedules();
    expect(saved.map((s) => s.id)).toEqual([b.id]);
    expect(saved[0].enabled).toBe(false);
  });
});
