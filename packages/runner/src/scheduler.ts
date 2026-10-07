import { promises as fs } from 'fs';
import path from 'path';

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

  async loadSchedules(): Promise<CheckupSchedule[]> {
    try {
      const data = await fs.readFile(this.schedulesFile, 'utf8');
      return JSON.parse(data) as CheckupSchedule[];
    } catch {
      return [];
    }
  }

  async saveSchedules(schedules: CheckupSchedule[]): Promise<void> {
    await fs.mkdir(path.dirname(this.schedulesFile), { recursive: true });
    await fs.writeFile(this.schedulesFile, JSON.stringify(schedules, null, 2), 'utf8');
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

  start(onRunScheduled: (schedule: CheckupSchedule) => Promise<boolean>): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        const schedules = await this.loadSchedules();
        const now = new Date();
        let changed = false;

        for (const sched of schedules) {
          if (!sched.enabled) continue;
          const runTime = new Date(sched.nextRunAt);
          if (now >= runTime) {
            sched.lastRunAt = now.toISOString();
            const success = await onRunScheduled(sched).catch(() => false);
            sched.lastRunStatus = success ? 'passed' : 'failed';
            sched.nextRunAt = this.calculateNextRun(sched.cadence, sched.hour, sched.dayOfWeek);
            changed = true;
          }
        }

        if (changed) {
          await this.saveSchedules(schedules);
        }
      } catch {
        // scheduler tick error resilience
      }
    }, 60000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
