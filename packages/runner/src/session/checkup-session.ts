import path from 'path';
import { type PlanStore, DefaultPlanStore } from './plan-store.js';
import { type ReportStore, DefaultReportStore } from './report-store.js';
import { type RunSlot, DefaultRunSlot } from './run-slot.js';
import { type RunSecrets, DefaultRunSecrets } from './run-secrets.js';
import { type RunEvents, DefaultRunEvents } from './run-events.js';

export interface SessionPaths {
  outputDir: string;
  dataDir: string;
  authDir: string;
  /** Pre-migration data folder, moved once on first use (today's moveLegacyData). */
  legacyDataDir?: string;
}

export interface CheckupSession {
  readonly paths: SessionPaths;
  readonly plan: PlanStore;
  readonly report: ReportStore;
  readonly run: RunSlot;
  readonly secrets: RunSecrets;
  readonly events: RunEvents;
}

export class DefaultCheckupSession implements CheckupSession {
  readonly paths: SessionPaths;
  readonly plan: PlanStore;
  readonly report: ReportStore;
  readonly run: RunSlot;
  readonly secrets: RunSecrets;
  readonly events: RunEvents;

  constructor(paths: SessionPaths) {
    this.paths = paths;
    this.run = new DefaultRunSlot();
    this.secrets = new DefaultRunSecrets(paths.authDir);
    this.events = new DefaultRunEvents();
    this.plan = new DefaultPlanStore(paths.dataDir, this.secrets);
    this.report = new DefaultReportStore(paths, () => {
      const active = this.run.runId ? [this.run.runId] : [];
      const parked = [...this.plan.parked.values()].map((r) => r.plan.runId);
      return [...active, ...parked];
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      paths: this.paths,
      run: {
        isRunning: this.run.isRunning,
        phase: this.run.phase,
        runId: this.run.runId,
        targetUrl: this.run.targetUrl,
        generation: this.run.generation,
      },
    };
  }
}

export function createCheckupSession(input: {
  outputDir: string;
  dataDir: string;
  authDir?: string;
  legacyDataDir?: string;
}): CheckupSession {
  const outputDir = path.resolve(input.outputDir);
  const dataDir = path.resolve(input.dataDir);
  const authDir = input.authDir ? path.resolve(input.authDir) : path.join(outputDir, 'auth');
  const legacyDataDir = input.legacyDataDir ? path.resolve(input.legacyDataDir) : undefined;

  const paths: SessionPaths = {
    outputDir,
    dataDir,
    authDir,
    legacyDataDir,
  };

  const session = new DefaultCheckupSession(paths);
  // Startup only: runs start on a later request, so the sweep does not normally race a live run's folder.
  void session.secrets.sweepLeftovers().catch(() => {});
  return session;
}

export * from './plan-store.js';
export * from './report-store.js';
export * from './run-slot.js';
export * from './run-secrets.js';
export * from './run-events.js';
export * from './checkup-run.js';
