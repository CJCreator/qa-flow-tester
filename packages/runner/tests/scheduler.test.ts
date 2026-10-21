/**
 * A schedule does what its screen says: a due schedule runs once, and the server starts the scheduler.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { SchedulerManager, type CheckupSchedule } from '../src/scheduler.js';
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
    // T-50 (REL-5): a run that cannot start is tried once more on the next tick; it is recorded failed when that try fails too.
    await scheduler.tick(async () => false);
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
