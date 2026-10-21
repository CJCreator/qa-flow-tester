import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerManager, type CheckupSchedule } from '../src/scheduler.js';

const PAST = '2020-01-01T00:00:00.000Z';
const LATER = new Date('2099-01-01T00:00:00.000Z');

function schedule(overrides: Partial<CheckupSchedule> = {}): CheckupSchedule {
  return {
    id: 'sched_1',
    name: 'Daily',
    targetUrl: 'https://example.com',
    cadence: 'daily',
    hour: 2,
    preset: 'full',
    enabled: true,
    createdAt: PAST,
    nextRunAt: PAST,
    ...overrides,
  };
}

describe('T-50 scheduler: one writer shared by ticks and HTTP handlers', () => {
  let dir: string;
  let file: string;
  let sched: SchedulerManager;

  const readFile = async (): Promise<CheckupSchedule[]> =>
    JSON.parse(await fs.readFile(file, 'utf8')) as CheckupSchedule[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-sched-'));
    file = path.join(dir, 'schedules.json');
    sched = new SchedulerManager(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('a toggle made while a tick is running keeps the toggled state and the run happens once', async () => {
    await fs.writeFile(file, JSON.stringify([schedule()]));
    let started!: () => void;
    const runStarted = new Promise<void>((resolve) => (started = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = vi.fn(async (_s: CheckupSchedule) => {
      started();
      await gate;
      return true;
    });

    const ticking = sched.tick(run, LATER);
    await runStarted;
    await sched.toggleSchedule('sched_1', false);
    release();
    await ticking;

    expect(run).toHaveBeenCalledTimes(1);
    const after = await readFile();
    expect(after[0].enabled).toBe(false);
    expect(after[0].lastRunStatus).toBe('passed');
  });

  it('a delete made while a tick is running is not undone by the tick', async () => {
    await fs.writeFile(file, JSON.stringify([schedule()]));
    let started!: () => void;
    const runStarted = new Promise<void>((resolve) => (started = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ticking = sched.tick(async (_s: CheckupSchedule) => {
      started();
      await gate;
      return true;
    }, LATER);

    await runStarted;
    expect(await sched.deleteSchedule('sched_1')).toBe(true);
    release();
    await ticking;

    expect(await sched.loadSchedules()).toEqual([]);
  });

  it('a truncated schedules.json is kept as a .corrupt copy, is reported, and is never replaced by []', async () => {
    const truncated = '[{"id":"sched_1","name":"Dai';
    await fs.writeFile(file, truncated);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(sched.loadSchedules()).rejects.toThrow(/could not be read/);
    await expect(
      sched.addSchedule({ name: 'New', targetUrl: 'https://example.com', cadence: 'daily', hour: 2, preset: 'full', enabled: true })
    ).rejects.toThrow(/could not be read/);

    expect(await fs.readFile(file, 'utf8')).toBe(truncated);
    const names = await fs.readdir(dir);
    expect(names.some((n) => n.startsWith('schedules.json.corrupt-'))).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a missing schedules.json loads as an empty list', async () => {
    expect(await sched.loadSchedules()).toEqual([]);
  });

  it('a due schedule whose run finds a check-up busy is tried again on the next tick and recorded once', async () => {
    await fs.writeFile(file, JSON.stringify([schedule()]));
    const run = vi.fn(async (_s: CheckupSchedule) => true);
    run.mockResolvedValueOnce(false);

    await sched.tick(run);
    expect((await readFile())[0].lastRunStatus).toBeUndefined();

    await sched.tick(run);
    await sched.tick(run);

    expect(run).toHaveBeenCalledTimes(2);
    expect((await readFile())[0].lastRunStatus).toBe('passed');
  });

  it('a schedule still busy on its retry is recorded as failed once, and is not retried again', async () => {
    await fs.writeFile(file, JSON.stringify([schedule()]));
    const run = vi.fn(async (_s: CheckupSchedule) => false);

    await sched.tick(run);
    await sched.tick(run);
    await sched.tick(run);

    expect(run).toHaveBeenCalledTimes(2);
    expect((await readFile())[0].lastRunStatus).toBe('failed');
  });

  it('a due schedule is not fired twice: its next run time is saved before the run starts', async () => {
    await fs.writeFile(file, JSON.stringify([schedule()]));
    let nextRunSeen = '';
    const run = vi.fn(async (_s: CheckupSchedule) => {
      nextRunSeen = (await readFile())[0].nextRunAt;
      return true;
    });

    await sched.tick(run);
    await sched.tick(run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(new Date(nextRunSeen).getTime()).toBeGreaterThan(Date.now());
  });
});
