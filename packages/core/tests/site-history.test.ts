import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SiteHistoryManager } from '../src/site-history.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Finding, SiteAspectGrades } from '@qa/types';

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
});
