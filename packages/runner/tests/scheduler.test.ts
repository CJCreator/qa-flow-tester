/**
 * A schedule does what its screen says: a due schedule runs once, and the server starts the scheduler.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { SchedulerManager, type CheckupSchedule, type ScheduleStore } from '../src/scheduler.js';
import { RunnerServer } from '../src/server.js';

const scratch = path.join(process.cwd(), '.tmp-scheduler');

describe('The scheduler', () => {
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
    const added = await scheduler.addSchedule({
      name: 'Nightly',
      targetUrl: 'http://localhost:3050',
      cadence: 'daily',
      hour: 2,
      preset: 'quick',
      enabled: true,
    });
    const all = await scheduler.loadSchedules();
    all[0].nextRunAt = new Date(Date.now() - 1000).toISOString();
    await scheduler.saveSchedules(all);
    return added;
  };

  it('fires a due schedule once, even when ticks overlap or repeat', async () => {
    const added = await dueSchedule();
    const fired: string[] = [];
    const run = async (s: CheckupSchedule) => {
      fired.push(s.id);
      await new Promise((r) => setTimeout(r, 20));
      return true;
    };

    await Promise.all([scheduler.tick(run), scheduler.tick(run)]);
    await scheduler.tick(run);

    expect(fired).toEqual([added.id]);
    const [saved] = await scheduler.loadSchedules();
    expect(saved.lastRunStatus).toBe('passed');
    expect(new Date(saved.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not fire a disabled or a not-yet-due schedule', async () => {
    const added = await dueSchedule();
    await scheduler.toggleSchedule(added.id, false);
    const run = vi.fn(async () => true);
    await scheduler.tick(run);
    expect(run).not.toHaveBeenCalled();
  });

  it('records a run that could not start as failed and still moves on', async () => {
    await dueSchedule();
    await scheduler.tick(async () => false);
    const [saved] = await scheduler.loadSchedules();
    expect(saved.lastRunStatus).toBe('failed');
    expect(new Date(saved.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('is started by the server, and stopped with it', async () => {
    const start = vi.spyOn(SchedulerManager.prototype, 'start');
    const stop = vi.spyOn(SchedulerManager.prototype, 'stop');
    const server = new RunnerServer({
      port: 3741,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
    });
    await server.start();
    expect(start).toHaveBeenCalledTimes(1);
    await server.stop();
    expect(stop).toHaveBeenCalled();
    start.mockRestore();
    stop.mockRestore();
  });
});

describe('The scheduler tick (ADR 0039)', () => {
  const dir = path.join(process.cwd(), '.tmp-scheduler-tick');
  let scheduler: SchedulerManager;

  beforeEach(async () => {
    await fs.mkdir(dir, { recursive: true });
    scheduler = new SchedulerManager(dir);
  });

  afterEach(async () => {
    scheduler.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const addDue = async (name: string, overrides: Partial<CheckupSchedule> = {}) => {
    const added = await scheduler.addSchedule({
      name,
      targetUrl: 'http://localhost:3050',
      cadence: 'daily',
      hour: 2,
      preset: 'quick',
      enabled: true,
    });
    const all = await scheduler.loadSchedules();
    const target = all.find((s) => s.id === added.id)!;
    target.nextRunAt = new Date(Date.now() - 1000).toISOString();
    Object.assign(target, overrides);
    await scheduler.saveSchedules(all);
    return added;
  };

  it('answers with counts: started, failed, skipped (enabled but not due)', async () => {
    await addDue('ok');
    await addDue('bad');
    await addDue('later', { nextRunAt: new Date(Date.now() + 3_600_000).toISOString() });
    await addDue('off', { enabled: false });
    const summary = await scheduler.tick(async (s) => s.name === 'ok');
    expect(summary).toEqual({ started: 1, failed: 1, skipped: 1, retrying: 0, busy: false });
  });

  it('a second tick that overlaps the first answers busy, and the schedule fires once', async () => {
    await addDue('one');
    const run = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return true;
    });
    const [a, b] = await Promise.all([scheduler.tick(run), scheduler.tick(run)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect([a.busy, b.busy].sort()).toEqual([false, true]);
    const again = await scheduler.tick(run);
    expect(again).toMatchObject({ started: 0, failed: 0, busy: false });
  });

  it('runs due schedules one after another, not at the same time', async () => {
    await addDue('a');
    await addDue('b');
    let active = 0;
    let most = 0;
    await scheduler.tick(async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      return true;
    });
    expect(most).toBe(1);
  });

  it('starts no new run once the deadline has passed, and the schedule stays due', async () => {
    const added = await addDue('late');
    const before = (await scheduler.loadSchedules()).find((s) => s.id === added.id)!.nextRunAt;
    const run = vi.fn(async () => true);
    const summary = await scheduler.tick(run, new Date(), { deadlineMs: Date.now() - 1 });
    expect(run).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ started: 0, failed: 0 });
    expect((await scheduler.loadSchedules())[0].nextRunAt).toBe(before);
  });

  it('a run that throws is a failed run, logs to console.error, and the tick goes on', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await addDue('boom');
    const summary = await scheduler.tick(async () => {
      throw new Error('boom');
    });
    expect(summary.failed).toBe(1);
    expect((await scheduler.loadSchedules())[0].lastRunStatus).toBe('failed');
    expect(consoleError).toHaveBeenCalledWith('[Release check-up] Scheduler tick failed:', 'boom');
    consoleError.mockRestore();
  });

  it('a runner callback that rejects counts as failed and logs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await addDue('rejection');
    const summary = await scheduler.tick(async () => Promise.reject(new Error('schedule runner failed')));
    expect(summary.failed).toBe(1);
    expect((await scheduler.loadSchedules())[0].lastRunStatus).toBe('failed');
    expect(consoleError).toHaveBeenCalledWith('[Release check-up] Scheduler tick failed:', 'schedule runner failed');
    consoleError.mockRestore();
  });

  it('a store whose read() throws makes tick() resolve with error set, nothing started, and console.error called once', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingStore: ScheduleStore = {
      async read() {
        throw new Error('store disk read error');
      },
      async write() {},
    };
    const mgr = new SchedulerManager(throwingStore);
    const run = vi.fn(async () => true);
    const summary = await mgr.tick(run);

    expect(run).not.toHaveBeenCalled();
    expect(summary).toEqual({
      started: 0,
      failed: 0,
      skipped: 0,
      retrying: 0,
      busy: false,
      error: 'store disk read error',
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('[Release check-up] Scheduler tick failed:', 'store disk read error');
    consoleError.mockRestore();
  });

  it('a schedule paused while an earlier run was going is not started', async () => {
    await addDue('first');
    const second = await addDue('second');
    const seen: string[] = [];
    await scheduler.tick(async (s) => {
      seen.push(s.name);
      if (s.name === 'first') await scheduler.toggleSchedule(second.id, false);
      return true;
    });
    expect(seen).toEqual(['first']);
  });
});

describe('The scheduler on a beta server', () => {
  it('is not started by a beta server (the hosted copy ticks from Cloud Scheduler)', async () => {
    const dir = path.join(process.cwd(), '.tmp-scheduler-beta');
    const start = vi.spyOn(SchedulerManager.prototype, 'start');
    const server = new RunnerServer({
      port: 3742,
      outputDir: path.join(dir, 'report'),
      dataDir: path.join(dir, 'data'),
      beta: true,
    });
    try {
      await server.start();
      expect(start).not.toHaveBeenCalled();
    } finally {
      await server.stop();
      start.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('calculateNextRun uses UTC', () => {
  let scheduler: SchedulerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new SchedulerManager(scratch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates daily run before scheduled hour on the same day in UTC', () => {
    vi.setSystemTime(new Date('2026-11-10T01:30:00.000Z'));
    expect(scheduler.calculateNextRun('daily', 2)).toBe('2026-11-10T02:00:00.000Z');
  });

  it('calculates daily run at or after scheduled hour on the next day in UTC', () => {
    vi.setSystemTime(new Date('2026-11-10T02:00:00.000Z'));
    expect(scheduler.calculateNextRun('daily', 2)).toBe('2026-11-11T02:00:00.000Z');
  });

  it('calculates hourly run on the next UTC hour rollover', () => {
    vi.setSystemTime(new Date('2026-11-10T23:59:00.000Z'));
    expect(scheduler.calculateNextRun('hourly')).toBe('2026-11-11T00:00:00.000Z');
  });

  it('calculates weekly run for a different day of the week in UTC', () => {
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
    expect(scheduler.calculateNextRun('weekly', 9, 1)).toBe('2026-11-16T09:00:00.000Z');
  });

  it('calculates weekly run before scheduled hour on the same day of the week in UTC', () => {
    vi.setSystemTime(new Date('2026-11-10T08:00:00.000Z'));
    expect(scheduler.calculateNextRun('weekly', 9, 2)).toBe('2026-11-10T09:00:00.000Z');
  });

  it('calculates weekly run after scheduled hour on the same day of the week rolls over to next week in UTC', () => {
    vi.setSystemTime(new Date('2026-11-10T10:00:00.000Z'));
    expect(scheduler.calculateNextRun('weekly', 9, 2)).toBe('2026-11-17T09:00:00.000Z');
  });
});
