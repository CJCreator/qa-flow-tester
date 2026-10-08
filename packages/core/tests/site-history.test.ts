import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SiteHistoryManager } from '../src/site-history.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Finding, PageSpeedMap, SiteAspectGrades } from '@qa/types';

describe('Site History & Delta Tracking (site-history.ts)', () => {
  let tempDir: string;
  let historyManager: SiteHistoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-test-history-'));
    historyManager = new SiteHistoryManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const baseGrades: SiteAspectGrades = {
    aspects: {
      Works: { grade: 'B', score: 85, findings: ['F-001'] },
      Accessible: { grade: 'A', score: 95, findings: [] },
      'Fast and mobile': { grade: 'A', score: 95, findings: [] },
      Findable: { grade: 'A', score: 95, findings: [] },
      Secure: { grade: 'B', score: 85, findings: ['F-002'] },
      'Looks and reads well': { grade: 'A', score: 100, findings: [] },
    },
    overallGrade: 'B',
    overallScore: 89,
  };

  const initialFindings: Finding[] = [
    {
      id: 'F-001',
      title: 'Console error on load',
      severity: 'Major',
      checker: 'bug-detection',
      where: { urlPath: '/dashboard', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: '', actual: '' },
      stepsToReproduce: [],
      evidence: {},
      resolution: '',
    },
    {
      id: 'F-002',
      title: 'Missing Content-Security-Policy header',
      severity: 'Major',
      checker: 'security',
      where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: '', actual: '' },
      stepsToReproduce: [],
      evidence: {},
      resolution: '',
    },
  ];

  it('records initial run and establishes baseline history', async () => {
    const diff = await historyManager.recordRun('localhost:3050', 'run-001', baseGrades, initialFindings, 'prod-test');
    expect(diff.previousRunId).toBeUndefined();
    expect(diff.newFindingFingerprints.length).toBe(2);
    expect(diff.fixedFindingFingerprints.length).toBe(0);

    const history = await historyManager.loadHistory('localhost:3050');
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].runId).toBe('run-001');
  });

  it('detects fixed defects on subsequent run with grade improvements', async () => {
    // Run 1: baseline with 2 issues
    await historyManager.recordRun('localhost:3050', 'run-001', baseGrades, initialFindings, 'prod-test');

    // Run 2: Console error was FIXED! Only 1 finding remains.
    const improvedGrades: SiteAspectGrades = {
      ...baseGrades,
      aspects: {
        ...baseGrades.aspects,
        Works: { grade: 'A', score: 100, findings: [] }, // Improved from B (85) to A (100)
      },
      overallGrade: 'A',
      overallScore: 95,
    };

    const remainingFindings = [initialFindings[1]]; // Only F-002 remaining

    const diff = await historyManager.recordRun(
      'localhost:3050',
      'run-002',
      improvedGrades,
      remainingFindings,
      'prod-test'
    );

    expect(diff.previousRunId).toBe('run-001');
    expect(diff.fixedFindingFingerprints.length).toBe(1);
    expect(diff.openFindingFingerprints.length).toBe(1);
    expect(diff.newFindingFingerprints.length).toBe(0);

    // Works aspect grade delta
    expect(diff.aspectDeltas.Works.previousGrade).toBe('B');
    expect(diff.aspectDeltas.Works.currentGrade).toBe('A');
    expect(diff.aspectDeltas.Works.currentScore).toBe(100);
  });

  describe('slower than last check-up: stored page speeds', () => {
    const speeds = (ms: number): PageSpeedMap => ({
      'visitor|375px|/': { metric: 'lcp', ms, loads: 3, throttled: true, profile: 'p1' },
    });

    it("slower: stores this check-up's page speeds so the next one can compare", async () => {
      await historyManager.recordRun('h', 'run-001', baseGrades, [], 'p', speeds(1200));
      const prev = await historyManager.previousPageSpeeds('h');
      expect(prev?.runId).toBe('run-001');
      expect(prev?.speeds).toEqual(speeds(1200));
    });

    it('slower: only the latest entry keeps page speeds', async () => {
      await historyManager.recordRun('h', 'run-001', baseGrades, [], 'p', speeds(1000));
      await historyManager.recordRun('h', 'run-002', baseGrades, [], 'p', speeds(1100));
      await historyManager.recordRun('h', 'run-003', baseGrades, [], 'p', speeds(1200));
      const history = await historyManager.loadHistory('h');
      expect(history.runs).toHaveLength(3);
      expect(history.runs[0].pageSpeeds).toBeUndefined();
      expect(history.runs[1].pageSpeeds).toBeUndefined();
      expect(history.runs[2].pageSpeeds).toEqual(speeds(1200));
    });

    it('slower: history file written before this change has no speeds and gives no baseline', async () => {
      const old = {
        host: 'h',
        runs: [
          { runId: 'run-old', timestamp: '2026-01-01T00:00:00.000Z', grades: baseGrades, findingFingerprints: [] },
        ],
      };
      await fs.writeFile(path.join(tempDir, 'h.history.json'), JSON.stringify(old), 'utf8');
      expect(await historyManager.previousPageSpeeds('h')).toBeUndefined();
      const diff = await historyManager.recordRun('h', 'run-new', baseGrades, [], 'p', speeds(900));
      expect(diff.previousRunId).toBe('run-old');
    });

    it('slower: first check-up has no previous speeds', async () => {
      expect(await historyManager.previousPageSpeeds('never-seen')).toBeUndefined();
    });

    it('slower: recordRun without speeds keeps existing diff behaviour', async () => {
      await historyManager.recordRun('h', 'run-001', baseGrades, initialFindings, 'p');
      const diff = await historyManager.recordRun('h', 'run-002', baseGrades, initialFindings, 'p');
      expect(diff.openFindingFingerprints).toHaveLength(2);
      expect(await historyManager.previousPageSpeeds('h')).toBeUndefined();
    });
  });
});
