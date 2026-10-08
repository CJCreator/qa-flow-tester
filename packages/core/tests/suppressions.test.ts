import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SuppressionsManager } from '../src/suppressions.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { Finding } from '@qa/types';

describe('SuppressionsManager', () => {
  const tmpDir = path.join(process.cwd(), '.tmp-suppression-test');

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should save and load suppressions properly', async () => {
    const manager = new SuppressionsManager(tmpDir);
    await manager.saveSuppression({
      findingTitle: 'Known cosmetic issue',
      urlPath: '/dashboard',
      triageStatus: 'Intended',
      dateAdded: new Date().toISOString(),
    });

    const list = await manager.loadSuppressions();
    expect(list).toHaveLength(1);
    expect(list[0].findingTitle).toBe('Known cosmetic issue');
    expect(list[0].triageStatus).toBe('Intended');
  });

  it('should apply suppressions to matching findings', async () => {
    const manager = new SuppressionsManager(tmpDir);
    await manager.saveSuppression({
      findingTitle: 'False positive alert',
      urlPath: '/login',
      triageStatus: 'False Positive',
      dateAdded: new Date().toISOString(),
    });

    const findings: Finding[] = [
      {
        id: 'F-1',
        title: 'False positive alert',
        severity: 'Minor',
        checker: 'ux-quality',
        where: { urlPath: '/login', role: 'anonymous', breakpoint: '1440px' },
        expectedVsActual: { expected: 'a', actual: 'b' },
        stepsToReproduce: [],
        evidence: {},
        resolution: 'None',
      },
      {
        id: 'F-2',
        title: 'Real blocker',
        severity: 'Blocker',
        checker: 'bug-detection',
        where: { urlPath: '/invoices', role: 'manager', breakpoint: '1440px' },
        expectedVsActual: { expected: 'a', actual: 'b' },
        stepsToReproduce: [],
        evidence: {},
        resolution: 'Fix',
      },
    ];

    const { activeFindings, suppressedFindings } = await manager.applySuppressions(findings);
    expect(suppressedFindings).toHaveLength(1);
    expect(suppressedFindings[0].id).toBe('F-1');
    expect(suppressedFindings[0].triageStatus).toBe('False Positive');

    expect(activeFindings).toHaveLength(1);
    expect(activeFindings[0].id).toBe('F-2');
  });

  const mk = (id: string, title: string): Finding => ({
    id,
    title,
    severity: 'Major',
    checker: 'bug-detection',
    where: { urlPath: '/a', role: 'anonymous', breakpoint: '1440px' },
    expectedVsActual: { expected: 'a', actual: 'b' },
    stepsToReproduce: [],
    evidence: {},
    resolution: 'Fix',
  });

  it('computeDelta reads a pre-contract findings.json with no schemaVersion or fingerprint', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'findings.json'),
      JSON.stringify({ runId: 'old', findings: [mk('F-1', 'Old one'), mk('F-2', 'Still here')] }),
      'utf8'
    );
    const delta = await new SuppressionsManager(tmpDir).computeDelta([
      mk('F-9', 'Still here'),
      mk('F-10', 'Brand new'),
    ]);
    expect(delta).toEqual({ newFindings: 1, fixedFindings: 1, openFindings: 1, suppressedFindings: 0 });
  });

  it('computeDelta ignores unknown extra fields from a newer file', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'findings.json'),
      JSON.stringify({
        schemaVersion: 7,
        futureField: { a: 1 },
        findings: [{ ...mk('F-1', 'Still here'), fingerprint: 'fp_0123456789abcdef', somethingNew: true }],
      }),
      'utf8'
    );
    const delta = await new SuppressionsManager(tmpDir).computeDelta([mk('F-2', 'Still here')]);
    expect(delta).toEqual({ newFindings: 0, fixedFindings: 0, openFindings: 1, suppressedFindings: 0 });
  });
});
