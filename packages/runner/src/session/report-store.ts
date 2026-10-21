import fs from 'fs/promises';
import path from 'path';
import type { ReleaseReport, RunSummary } from '@qa/types';
import { releaseVerdict } from '@qa/types';
import { writeJsonAtomic } from '@qa/core';
import type { SessionPaths } from './checkup-session.js';

export const RUNS_KEPT_PER_SITE = 10;

export function isRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) && !value.includes('..');
}

/** Every run folder and the headline of each finished run, in one file, so a list reads one file, not every summary. */
interface RunIndex {
  /** The run folders under runs/, sorted (a folder without a summary is a run that never finished). */
  names: string[];
  /** The finished runs, newest first. */
  runs: RunSummary[];
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
  /** Today's `siteDir`: the per-site memory/history folder. */
  siteDirFor(): string;
  /** Today's `listRuns`. */
  list(): Promise<RunSummary[]>;
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

  siteDirFor(): string {
    return path.join(this.paths.dataDir, 'sites');
  }

  /** Newest first. The index is used while the run folders are the ones it lists; otherwise the summaries are read again. */
  async list(): Promise<RunSummary[]> {
    const root = path.join(this.paths.outputDir, 'runs');
    const names = (await fs.readdir(root).catch(() => [] as string[])).filter((n) => isRunId(n)).sort();
    const index = await this.readIndex();
    if (index && index.names.length === names.length && index.names.every((n, i) => n === names[i])) return index.runs;
    const runs: RunSummary[] = [];
    for (const name of names) {
      try {
        runs.push(JSON.parse(await fs.readFile(path.join(root, name, 'summary.json'), 'utf8')) as RunSummary);
      } catch {
        // not finished
      }
    }
    runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (index || names.length > 0) await this.writeIndex({ names, runs });
    return runs;
  }

  private indexFile(): string {
    return path.join(this.paths.outputDir, 'runs-index.json');
  }

  private async readIndex(): Promise<RunIndex | null> {
    try {
      const index = JSON.parse(await fs.readFile(this.indexFile(), 'utf8')) as RunIndex;
      return Array.isArray(index.names) && Array.isArray(index.runs) ? index : null;
    } catch {
      return null;
    }
  }

  private async writeIndex(index: RunIndex): Promise<void> {
    await writeJsonAtomic(this.indexFile(), index);
  }

  /** Puts a finished run in the index. With no index yet, the next list builds it. */
  private async keepInIndex(summary: RunSummary): Promise<void> {
    const index = await this.readIndex();
    if (!index) return;
    const names = [...new Set([...index.names, summary.runId])].sort();
    const runs = [summary, ...index.runs.filter((r) => r.runId !== summary.runId)].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
    await this.writeIndex({ names, runs });
  }

  /** Takes deleted run folders out of the index. */
  private async dropFromIndex(runIds: string[]): Promise<void> {
    const index = await this.readIndex();
    if (!index || runIds.length === 0) return;
    const gone = new Set(runIds);
    await this.writeIndex({
      names: index.names.filter((n) => !gone.has(n)),
      runs: index.runs.filter((r) => !gone.has(r.runId)),
    });
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
    await this.keepInIndex(summary);
    for (const name of ['findings.json', 'fix-these.md', 'known-findings.json', 'AGENTS.snippet.md']) {
      await fs.copyFile(path.join(dir, name), path.join(this.paths.outputDir, name)).catch(() => {});
    }
    await this.prune(host);
  }

  async prune(host: string): Promise<void> {
    const runs = await this.list();
    const old = runs.filter((r) => r.host === host).slice(RUNS_KEPT_PER_SITE);
    const removed: string[] = [];
    for (const run of old) {
      await fs.rm(this.dirFor(run.runId), { recursive: true, force: true }).catch(() => {});
      removed.push(run.runId);
    }
    const finished = new Set(runs.map((r) => r.runId));
    const root = path.join(this.paths.outputDir, 'runs');
    const protectedIds = new Set(this.getProtectedRunIds ? this.getProtectedRunIds() : []);
    for (const name of await fs.readdir(root).catch(() => [] as string[])) {
      if (!isRunId(name) || finished.has(name) || protectedIds.has(name)) continue;
      await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
      removed.push(name);
    }
    await this.dropFromIndex(removed);
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
