import { promises as fs } from 'fs';
import path from 'path';
import type { AspectGradeDelta, AspectType, Finding, PageSpeedMap, SiteAspectGrades, SiteHistoryDiff } from '@qa/types';
import { findingFingerprint } from '@qa/types';

export interface SiteHistoryEntry {
  runId: string;
  timestamp: string;
  grades: SiteAspectGrades;
  findingFingerprints: string[];
  /** Speed numbers of this check-up. Only the latest entry keeps them. */
  pageSpeeds?: PageSpeedMap;
}

export interface SiteHistoryData {
  host: string;
  runs: SiteHistoryEntry[];
}

export class SiteHistoryManager {
  /** `dataDir` is the folder of history files: the runner passes `<its data folder>/sites`. */
  constructor(private readonly dataDir: string = path.join(process.cwd(), '.qa-data', 'sites')) {}

  private historyFilePath(host: string): string {
    const safeHost = host.replace(/[:\/\\?%*|"<>]/g, '_');
    return path.join(this.dataDir, `${safeHost}.history.json`);
  }

  async loadHistory(host: string): Promise<SiteHistoryData> {
    try {
      const content = await fs.readFile(this.historyFilePath(host), 'utf8');
      return JSON.parse(content);
    } catch {
      return { host, runs: [] };
    }
  }

  /** Page speeds of the last check-up, or undefined when there is none (or the file predates them). */
  async previousPageSpeeds(
    host: string
  ): Promise<{ runId: string; timestamp: string; speeds: PageSpeedMap } | undefined> {
    const history = await this.loadHistory(host);
    const last = history.runs.length > 0 ? history.runs[history.runs.length - 1] : undefined;
    if (!last?.pageSpeeds) return undefined;
    return { runId: last.runId, timestamp: last.timestamp, speeds: last.pageSpeeds };
  }

  async recordRun(
    host: string,
    runId: string,
    grades: SiteAspectGrades,
    findings: Finding[],
    productId: string,
    pageSpeeds?: PageSpeedMap
  ): Promise<SiteHistoryDiff> {
    const history = await this.loadHistory(host);
    const lastRun = history.runs.length > 0 ? history.runs[history.runs.length - 1] : undefined;

    // Compute structural fingerprints for current findings
    const currentFingerprints = new Set<string>();
    for (const f of findings) {
      if (!f.needsConfirmation && f.triageStatus !== 'False Positive' && f.triageStatus !== 'Intended') {
        const fp = findingFingerprint(f, productId);
        currentFingerprints.add(fp);
      }
    }

    const currentFpList = Array.from(currentFingerprints);
    const prevFpSet = new Set(lastRun?.findingFingerprints || []);

    const newFindings = currentFpList.filter((fp) => !prevFpSet.has(fp));
    const openFindings = currentFpList.filter((fp) => prevFpSet.has(fp));
    const fixedFindings = Array.from(prevFpSet).filter((fp) => !currentFingerprints.has(fp));

    const aspectList: AspectType[] = [
      'Works',
      'Accessible',
      'Fast and mobile',
      'Findable',
      'Secure',
      'Looks and reads well',
    ];

    const aspectDeltas: Record<AspectType, AspectGradeDelta> = {} as any;
    for (const aspect of aspectList) {
      const curr = grades.aspects[aspect];
      const prev = lastRun?.grades.aspects[aspect];
      aspectDeltas[aspect] = {
        previousGrade: prev?.grade,
        previousScore: prev?.score,
        currentGrade: curr.grade,
        currentScore: curr.score,
      };
    }

    const diff: SiteHistoryDiff = {
      previousRunId: lastRun?.runId,
      previousTimestamp: lastRun?.timestamp,
      aspectDeltas,
      newFindingFingerprints: newFindings,
      fixedFindingFingerprints: fixedFindings,
      openFindingFingerprints: openFindings,
    };

    // Append current run to history. Every run is kept: the reports themselves are pruned, the
    // grade history (a few kilobytes a run) isn't.
    // Only the latest entry keeps page speeds, so the file does not grow with every check-up.
    for (const older of history.runs) delete older.pageSpeeds;
    history.runs.push({
      runId,
      timestamp: new Date().toISOString(),
      grades,
      findingFingerprints: currentFpList,
      ...(pageSpeeds && Object.keys(pageSpeeds).length > 0 ? { pageSpeeds } : {}),
    });

    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.historyFilePath(host), JSON.stringify(history, null, 2), 'utf8');

    return diff;
  }
}
