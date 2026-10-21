import path from 'path';
import { readJsonSafe, writeJsonAtomic } from '@qa/core';

export interface CheckupSchedule {
  id: string;
  name: string;
  targetUrl: string;
  cadence: 'daily' | 'weekly' | 'hourly';
  hour: number; // 0 - 23
  dayOfWeek?: number; // 0 (Sun) - 6 (Sat)
  preset: 'full' | 'quick';
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'passed' | 'failed';
  nextRunAt: string;
}

export class SchedulerManager {
  private schedulesFile: string;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Due schedules whose run found a check-up already running: tried once more on the next tick. */
  private retry = new Set<string>();

  /** Runs one change to the schedules file after the previous one, so a tick, a toggle and a delete never interleave. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  constructor(dataDir: string) {
    this.schedulesFile = path.join(dataDir, 'schedules.json');
  }

  calculateNextRun(cadence: 'daily' | 'weekly' | 'hourly', hour: number = 2, dayOfWeek: number = 1): string {
    const now = new Date();
    const next = new Date(now);

    if (cadence === 'hourly') {
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next.toISOString();
    }

    if (cadence === 'daily') {
      next.setHours(hour, 0, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next.toISOString();
    }

    if (cadence === 'weekly') {
      next.setHours(hour, 0, 0, 0);
      const currentDay = next.getDay();
      let daysUntil = (dayOfWeek - currentDay + 7) % 7;
      if (daysUntil === 0 && next <= now) {
        daysUntil = 7;
      }
      next.setDate(next.getDate() + daysUntil);
      return next.toISOString();
    }

    return next.toISOString();
  }

  /** The schedules, or [] when there is no file yet. A file that cannot be parsed is kept as a `.corrupt` copy and throws: never read as []. */
  async loadSchedules(): Promise<CheckupSchedule[]> {
    const res = await readJsonSafe<CheckupSchedule[]>(this.schedulesFile, {
      logWarning: (msg) => console.warn(`[Release check-up] ${msg}`),
    });
    if (res.corrupt || (res.data !== null && !Array.isArray(res.data))) {
      throw new Error(
        'The schedules file could not be read. It was kept as a .corrupt copy, and schedules are not changed until it is fixed.'
      );
    }
    return res.data ?? [];
  }

  async saveSchedules(schedules: CheckupSchedule[]): Promise<void> {
    await writeJsonAtomic(this.schedulesFile, schedules);
  }

  addSchedule(input: Omit<CheckupSchedule, 'id' | 'createdAt' | 'nextRunAt'>): Promise<CheckupSchedule> {
    return this.exclusive(async () => {
      const schedules = await this.loadSchedules();
      const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const nextRunAt = this.calculateNextRun(input.cadence, input.hour, input.dayOfWeek);

      const newSchedule: CheckupSchedule = {
        ...input,
        id,
        createdAt: new Date().toISOString(),
        nextRunAt,
      };

      schedules.push(newSchedule);
      await this.saveSchedules(schedules);
      return newSchedule;
    });
  }

  deleteSchedule(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      const schedules = await this.loadSchedules();
      const filtered = schedules.filter((s) => s.id !== id);
      if (filtered.length === schedules.length) return false;
      await this.saveSchedules(filtered);
      return true;
    });
  }

  toggleSchedule(id: string, enabled: boolean): Promise<CheckupSchedule | null> {
    return this.exclusive(async () => {
      const schedules = await this.loadSchedules();
      const target = schedules.find((s) => s.id === id);
      if (!target) return null;
      target.enabled = enabled;
      if (enabled) {
        target.nextRunAt = this.calculateNextRun(target.cadence, target.hour, target.dayOfWeek);
      }
      await this.saveSchedules(schedules);
      return target;
    });
  }

  private ticking = false;

  /**
   * Runs every schedule that is due, once. The next run time is saved before the run is started, so a
   * schedule that is due is never fired twice, and a tick that is still going is not entered again.
   * A due schedule whose run finds a check-up already running is tried again on the next tick; it is
   * recorded once, when that try starts or fails.
   */
  async tick(onRunScheduled: (schedule: CheckupSchedule) => Promise<boolean>, now: Date = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.exclusive(async () => {
        const schedules = await this.loadSchedules();
        for (const id of this.retry) if (!schedules.some((s) => s.id === id && s.enabled)) this.retry.delete(id);
        const due = schedules.filter((s) => s.enabled && (this.retry.has(s.id) || now >= new Date(s.nextRunAt)));
        if (due.length === 0) return due;
        for (const sched of due) {
          sched.lastRunAt = now.toISOString();
          if (this.retry.has(sched.id)) continue;
          sched.nextRunAt = this.calculateNextRun(sched.cadence, sched.hour, sched.dayOfWeek);
        }
        await this.saveSchedules(schedules);
        return due;
      });
      if (due.length === 0) return;
      const outcomes = new Map<string, 'passed' | 'failed'>();
      for (const sched of due) {
        const retrying = this.retry.has(sched.id);
        const started = await onRunScheduled(sched).catch(() => false);
        if (!started && !retrying) {
          this.retry.add(sched.id);
          continue;
        }
        this.retry.delete(sched.id);
        outcomes.set(sched.id, started ? 'passed' : 'failed');
      }
      if (outcomes.size === 0) return;
      // Re-read so a schedule added, toggled or removed while a run was starting is not undone.
      await this.exclusive(async () => {
        const latest = await this.loadSchedules();
        for (const [id, status] of outcomes) {
          const target = latest.find((s) => s.id === id);
          if (target) target.lastRunStatus = status;
        }
        await this.saveSchedules(latest);
      });
    } catch (err) {
      console.warn(`[Release check-up] Schedules were not run: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  start(onRunScheduled: (schedule: CheckupSchedule) => Promise<boolean>, intervalMs = 60000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(onRunScheduled), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
