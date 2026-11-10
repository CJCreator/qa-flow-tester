import { promises as fs } from 'fs';
import path from 'path';
import { writeJsonAtomic, type AuditStoreBackend } from '@qa/core';

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
  /** Set when the slot was busy (another check-up running): the schedule is due again at this time (R5). */
  retryAt?: string;
}

/** How long a busy slot waits before it is tried again. */
export const BUSY_RETRY_MS = 5 * 60_000;

/**
 * What one run came to: started and finished well (true), failed (false), or the slot was busy, so the run
 * did not start and the schedule is retried (R5).
 */
export type RunOutcome = boolean | 'busy';

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
  /** Runs refused because the slot was busy: due again after BUSY_RETRY_MS. */
  retrying: number;
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
    await writeJsonAtomic(this.file, list);
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

/** A schedule is due when its next run time has come, or its busy-slot retry has. */
function isDue(schedule: CheckupSchedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  if (now >= new Date(schedule.nextRunAt)) return true;
  return schedule.retryAt !== undefined && now >= new Date(schedule.retryAt);
}

export class SchedulerManager {
  private readonly store: ScheduleStore;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  /** Tail of the store queue: every read-modify-write of the list runs after the one before it (R4). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(storeOrDataDir: string | ScheduleStore) {
    this.store = typeof storeOrDataDir === 'string' ? new FileScheduleStore(storeOrDataDir) : storeOrDataDir;
  }

  /** Runs `work` once every earlier store operation has finished, so no save overwrites another's (R4). */
  private locked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The next time a schedule is due. `hour` and `dayOfWeek` (0 = Sunday) are UTC, as the Settings form says. */
  calculateNextRun(cadence: 'daily' | 'weekly' | 'hourly', hour: number = 2, dayOfWeek: number = 1): string {
    const now = new Date();
    const next = new Date(now);

    if (cadence === 'hourly') {
      next.setUTCMinutes(0, 0, 0);
      next.setUTCHours(next.getUTCHours() + 1);
      return next.toISOString();
    }

    if (cadence === 'daily') {
      next.setUTCHours(hour, 0, 0, 0);
      if (next <= now) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      return next.toISOString();
    }

    if (cadence === 'weekly') {
      next.setUTCHours(hour, 0, 0, 0);
      const currentDay = next.getUTCDay();
      let daysUntil = (dayOfWeek - currentDay + 7) % 7;
      if (daysUntil === 0 && next <= now) {
        daysUntil = 7;
      }
      next.setUTCDate(next.getUTCDate() + daysUntil);
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
    return this.locked(async () => {
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

  async deleteSchedule(id: string): Promise<boolean> {
    return this.locked(async () => {
      const schedules = await this.loadSchedules();
      const filtered = schedules.filter((s) => s.id !== id);
      if (filtered.length === schedules.length) return false;
      await this.saveSchedules(filtered);
      return true;
    });
  }

  async toggleSchedule(id: string, enabled: boolean): Promise<CheckupSchedule | null> {
    return this.locked(async () => {
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

  /**
   * Runs every schedule that is due, once, one after another. The next run time is saved before the run is
   * started, so a schedule that is due is never fired twice, and a tick that is still going is not entered
   * again (it answers busy). A run refused because the slot was busy is not a failure: the schedule gets a
   * `retryAt` and is due again after BUSY_RETRY_MS (R5). Once `deadlineMs` (epoch ms) has passed no new run is
   * started: the rest stay due for the next tick.
   */
  async tick(
    onRunScheduled: (schedule: CheckupSchedule) => Promise<RunOutcome>,
    now: Date = new Date(),
    opts: { deadlineMs?: number } = {}
  ): Promise<TickSummary> {
    const summary: TickSummary = { started: 0, failed: 0, skipped: 0, retrying: 0, busy: false };
    if (this.ticking) return { ...summary, busy: true };
    this.ticking = true;
    try {
      const schedules = await this.loadSchedules();
      const due = schedules.filter((s) => isDue(s, now));
      summary.skipped = schedules.filter((s) => s.enabled).length - due.length;
      for (const { id } of due) {
        if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) break;
        // Claim the slot under the queue: re-load (a schedule added, paused or removed meanwhile is not undone),
        // re-check it is still due, and save its next run before the run starts (R4: one slot, one run).
        const claim = await this.locked(async () => {
          const list = await this.loadSchedules();
          const sched = list.find((s) => s.id === id);
          if (!sched || !isDue(sched, now)) return null;
          const previousLastRunAt = sched.lastRunAt;
          sched.lastRunAt = now.toISOString();
          sched.nextRunAt = this.calculateNextRun(sched.cadence, sched.hour, sched.dayOfWeek);
          delete sched.retryAt;
          await this.saveSchedules(list);
          return { run: { ...sched }, previousLastRunAt };
        });
        if (!claim) continue;
        const outcome: RunOutcome = await onRunScheduled(claim.run).catch((): RunOutcome => false);
        if (outcome === 'busy') summary.retrying += 1;
        else if (outcome) summary.started += 1;
        else summary.failed += 1;
        await this.locked(async () => {
          const latest = await this.loadSchedules();
          const target = latest.find((s) => s.id === id);
          if (!target) return;
          if (outcome === 'busy') {
            // Not a run: keep the last real run time and last status, and try again soon.
            target.lastRunAt = claim.previousLastRunAt;
            target.retryAt = new Date(Date.now() + BUSY_RETRY_MS).toISOString();
          } else {
            target.lastRunStatus = outcome ? 'passed' : 'failed';
          }
          await this.saveSchedules(latest);
        });
      }
    } catch {
      // scheduler tick error resilience: a failed store read stops the tick and saves nothing
    } finally {
      this.ticking = false;
    }
    return summary;
  }

  start(onRunScheduled: (schedule: CheckupSchedule) => Promise<RunOutcome>, intervalMs = 60000): void {
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
