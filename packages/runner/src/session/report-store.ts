import fs from 'fs/promises';
import path from 'path';
import type { ReleaseReport, RunSummary } from '@qa/types';
import { releaseVerdict } from '@qa/types';
import type { SessionPaths } from './checkup-session.js';

export const RUNS_KEPT_PER_SITE = 10;

export function isRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) && !value.includes('..');
}

export interface ReportStore {
  readonly last: ReleaseReport | null;
  set(report: ReleaseReport | null): void;
  /** Today's `lastRunError` / `lastErrorCode`, always set together. */
  error(): { message: string | null; code: string | null };
  setError(message: string | null, code: string | null): void;
  /** Keep a finished run's files, pruning per site (today's `keepRun` / `pruneRuns`). */
  keep(report: ReleaseReport, typedTargetUrl: string, siteHost: string | undefined): Promise<void>;
  prune(host: string): Promise<void>;
  /** Today's `runDir` / `relativeToRun`. */
  dirFor(runId: string): string;
  relativePath(runId: string, file?: string): string | undefined;
  /** Today's `listRuns`. */
  list(): Promise<RunSummary[]>;
  /** Forget the cached run index: call after a run's summary.json is rewritten in place. */
  invalidate(): void;
  /** Today's `readRunReport`. */
  read(runId: string): Promise<ReleaseReport | null>;
  /** Today's `loadLatestReport`. */
  loadLatest(): Promise<void>;
}

export class DefaultReportStore implements ReportStore {
  private readonly paths: SessionPaths;
  private lastReport: ReleaseReport | null = null;
  private lastRunError: string | null = null;
  private lastErrorCode: string | null = null;
  private readonly getProtectedRunIds?: () => string[];
  /**
   * Run summaries by run folder name (LAT-2). Valid while the `runs/` folder keeps the mtime it had when read:
   * a run folder added or removed changes it. keep() and prune() drop the index on their own writes.
   */
  private runIndex: { rootMtimeMs: number; byName: Map<string, RunSummary> } | null = null;

  constructor(paths: SessionPaths, getProtectedRunIds?: () => string[]) {
    this.paths = paths;
    this.getProtectedRunIds = getProtectedRunIds;
  }

  get last(): ReleaseReport | null {
    return this.lastReport;
  }

  set(report: ReleaseReport | null): void {
    this.lastReport = report;
  }

  error(): { message: string | null; code: string | null } {
    return {
      message: this.lastRunError,
      code: this.lastErrorCode,
    };
  }

  setError(message: string | null, code: string | null): void {
    this.lastRunError = message;
    this.lastErrorCode = code;
  }

  dirFor(runId: string): string {
    return path.join(this.paths.outputDir, 'runs', runId);
  }

  relativePath(runId: string, file?: string): string | undefined {
    if (!file) return undefined;
    const rel = path.relative(this.dirFor(runId), file);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : undefined;
  }

  invalidate(): void {
    this.runIndex = null;
  }

  async list(): Promise<RunSummary[]> {
    const root = path.join(this.paths.outputDir, 'runs');
    const rootMtimeMs = await fs.stat(root).then(
      (s) => s.mtimeMs,
      () => -1
    );
    if (!this.runIndex || this.runIndex.rootMtimeMs !== rootMtimeMs) {
      const names = await fs.readdir(root).catch(() => [] as string[]);
      const byName = new Map<string, RunSummary>();
      for (const name of names) {
        if (!isRunId(name)) continue;
        try {
          byName.set(name, JSON.parse(await fs.readFile(path.join(root, name, 'summary.json'), 'utf8')) as RunSummary);
        } catch {
          // not finished
        }
      }
      this.runIndex = { rootMtimeMs, byName };
    }
    return [...this.runIndex.byName.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async keep(report: ReleaseReport, typedTargetUrl: string, siteHost: string | undefined): Promise<void> {
    const dir = this.dirFor(report.runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report), 'utf8');
    const verdict = releaseVerdict(report.findings, undefined, report.grades, report.coverage);
    let host = siteHost;
    try {
      host ??= new URL(typedTargetUrl).host;
    } catch {
      host ??= typedTargetUrl;
    }
    const summary: RunSummary = {
      runId: report.runId,
      targetUrl: typedTargetUrl,
      host,
      timestamp: report.timestamp,
      durationMs: report.durationMs,
      ready: verdict.ready,
      stamp: verdict.stamp,
      reason: verdict.reason,
      counts: verdict.counts,
      readOnly: report.scanMode === 'read-only' || report.scanMode === 'safe-public' || undefined,
      testedWithApprovedPlan: report.testedWithApprovedPlan,
    };
    await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    this.runIndex = null;
    for (const name of ['findings.json', 'fix-these.md', 'known-findings.json', 'AGENTS.snippet.md']) {
      await fs.copyFile(path.join(dir, name), path.join(this.paths.outputDir, name)).catch(() => {});
    }
    await this.prune(host);
  }

  async prune(host: string): Promise<void> {
    const runs = await this.list();
    const old = runs.filter((r) => r.host === host).slice(RUNS_KEPT_PER_SITE);
    for (const run of old) await fs.rm(this.dirFor(run.runId), { recursive: true, force: true }).catch(() => {});
    if (old.length) this.runIndex = null;
    const finished = new Set(runs.map((r) => r.runId));
    const root = path.join(this.paths.outputDir, 'runs');
    const protectedIds = new Set(this.getProtectedRunIds ? this.getProtectedRunIds() : []);
    for (const name of await fs.readdir(root).catch(() => [] as string[])) {
      if (!isRunId(name) || finished.has(name) || protectedIds.has(name)) continue;
      await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
    }
  }

  async loadLatest(): Promise<void> {
    if (this.lastReport) return;
    const [latest] = await this.list();
    if (!latest) return;
    try {
      this.lastReport = JSON.parse(await fs.readFile(path.join(this.dirFor(latest.runId), 'report.json'), 'utf8'));
    } catch {
      // unreadable: the list still shows it
    }
  }

  async read(runId: string): Promise<ReleaseReport | null> {
    if (this.lastReport?.runId === runId) return this.lastReport;
    try {
      return JSON.parse(await fs.readFile(path.join(this.dirFor(runId), 'report.json'), 'utf8'));
    } catch {
      return null;
    }
  }
}
