import { promises as fs } from 'fs';
import path from 'path';
import type { AuditStoreBackend } from '@qa/core';

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

/** Where the schedule list lives. A failed read must throw: an empty list would be saved over the real one. */
export interface ScheduleStore {
  read(): Promise<CheckupSchedule[]>;
  write(list: CheckupSchedule[]): Promise<void>;
}

/** What one tick did. Counts only: no ids, addresses or errors. */
export interface TickSummary {
  /** Runs that finished well. */
  started: number;
  /** Runs that could not start, finished with an error, or threw. */
  failed: number;
  /** Enabled schedules that were not due. */
  skipped: number;
  /** Another tick was still going, so this one did nothing. */
  busy: boolean;
}

/** `<dataDir>/schedules.json`: the local copy's store. A missing or unreadable file reads as no schedules. */
export class FileScheduleStore implements ScheduleStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'schedules.json');
  }

  async read(): Promise<CheckupSchedule[]> {
    try {
      const data = await fs.readFile(this.file, 'utf8');
      const parsed: unknown = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as CheckupSchedule[]) : [];
    } catch {
      return [];
    }
  }

  async write(list: CheckupSchedule[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(list, null, 2), 'utf8');
  }
}

/** The audit store key the hosted copy keeps its schedules under (ADR 0036 backend, ADR 0039). */
export const SCHEDULES_KEY = 'schedules/schedules.json';

/** Schedules in the audit store backend (Cloud Storage on the hosted copy). Store errors propagate. */
export class BackendScheduleStore implements ScheduleStore {
  constructor(private readonly backend: AuditStoreBackend) {}

  async read(): Promise<CheckupSchedule[]> {
    const stored = await this.backend.getJson<CheckupSchedule[]>(SCHEDULES_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  async write(list: CheckupSchedule[]): Promise<void> {
    await this.backend.putJson(SCHEDULES_KEY, list);
  }
}

export class SchedulerManager {
  private readonly store: ScheduleStore;
  private timer: NodeJS.Timeout | null = null;

  constructor(storeOrDataDir: string | ScheduleStore) {
    this.store = typeof storeOrDataDir === 'string' ? new FileScheduleStore(storeOrDataDir) : storeOrDataDir;
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

  async loadSchedules(): Promise<CheckupSchedule[]> {
    return this.store.read();
  }

  async saveSchedules(schedules: CheckupSchedule[]): Promise<void> {
    await this.store.write(schedules);
  }

  async addSchedule(input: Omit<CheckupSchedule, 'id' | 'createdAt' | 'nextRunAt'>): Promise<CheckupSchedule> {
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
  }

  async deleteSchedule(id: string): Promise<boolean> {
    const schedules = await this.loadSchedules();
    const filtered = schedules.filter((s) => s.id !== id);
    if (filtered.length === schedules.length) return false;
    await this.saveSchedules(filtered);
    return true;
  }

  async toggleSchedule(id: string, enabled: boolean): Promise<CheckupSchedule | null> {
    const schedules = await this.loadSchedules();
    const target = schedules.find((s) => s.id === id);
    if (!target) return null;
    target.enabled = enabled;
    if (enabled) {
      target.nextRunAt = this.calculateNextRun(target.cadence, target.hour, target.dayOfWeek);
    }
    await this.saveSchedules(schedules);
    return target;
  }

  private ticking = false;

  /**
   * Runs every schedule that is due, once, one after another. The next run time is saved before the run is
   * started, so a schedule that is due is never fired twice, and a tick that is still going is not entered
   * again (it answers busy). Once `deadlineMs` (epoch ms) has passed no new run is started: the rest stay due
   * for the next tick.
   */
  async tick(
    onRunScheduled: (schedule: CheckupSchedule) => Promise<boolean>,
    now: Date = new Date(),
    opts: { deadlineMs?: number } = {}
  ): Promise<TickSummary> {
    const summary: TickSummary = { started: 0, failed: 0, skipped: 0, busy: false };
    if (this.ticking) return { ...summary, busy: true };
    this.ticking = true;
    try {
      const schedules = await this.loadSchedules();
      const due = schedules.filter((s) => s.enabled && now >= new Date(s.nextRunAt));
      summary.skipped = schedules.filter((s) => s.enabled).length - due.length;
      for (const { id } of due) {
        if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) break;
        // Re-load so a schedule added, paused or removed while an earlier run was going is not undone.
        const list = await this.loadSchedules();
        const sched = list.find((s) => s.id === id);
        if (!sched || !sched.enabled) continue;
        sched.lastRunAt = now.toISOString();
        sched.nextRunAt = this.calculateNextRun(sched.cadence, sched.hour, sched.dayOfWeek);
        await this.saveSchedules(list);
        const ok = await onRunScheduled({ ...sched }).catch(() => false);
        if (ok) summary.started += 1;
        else summary.failed += 1;
        const latest = await this.loadSchedules();
        const target = latest.find((s) => s.id === id);
        if (target) {
          target.lastRunStatus = ok ? 'passed' : 'failed';
          await this.saveSchedules(latest);
        }
      }
    } catch {
      // scheduler tick error resilience: a failed store read stops the tick and saves nothing
    } finally {
      this.ticking = false;
    }
    return summary;
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
