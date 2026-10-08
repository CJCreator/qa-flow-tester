import { describe, it, expect, afterEach } from 'vitest';
import { ReportGenerator } from '../src/reporter.js';
import type { ReleaseReport } from '@qa/types';
import { promises as fs } from 'fs';
import path from 'path';

describe('ReportGenerator', () => {
  const tempDir = path.resolve(__dirname, './temp-reporter-test');

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('renders report.md and findings.json matching spec structure', async () => {
    const generator = new ReportGenerator(tempDir);

    const mockReport: ReleaseReport = {
      runId: 'run-12345',
      productId: 'product-omega',
      targetUrl: 'http://localhost:4000',
      timestamp: '2026-09-26T12:00:00Z',
      durationMs: 4200,
      coverage: {
        totalTestPoints: 4,
        passed: 3,
        failed: 1,
        blocked: 0,
        skipped: 0,
        couldNotVerify: 0,
        completionRate: 100,
      },
      results: [],
      findings: [
        {
          id: 'F-BLOCKER-001',
          severity: 'Blocker',
          checker: 'bug-detection',
          title: 'Critical checkout crash',
          where: { urlPath: '/checkout', role: 'member', breakpoint: '1440px' },
          expectedVsActual: { expected: 'Checkout succeeds', actual: 'Crash with 500 error' },
          stepsToReproduce: ['Navigate to /checkout', 'Click Pay'],
          evidence: {},
          resolution: 'Fix server endpoint',
        },
      ],
    };

    const { jsonPath, mdPath } = await generator.generate(mockReport);

    // Verify findings.json
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(jsonContent);
    expect(parsed.productId).toBe('product-omega');
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].id).toBe('F-BLOCKER-001');

    // Verify report.md
    const mdContent = await fs.readFile(mdPath, 'utf8');
    expect(mdContent).toContain('# Pre-Release Readiness Report');
    expect(mdContent).toContain('product-omega');
    expect(mdContent).toContain('**Not ready yet**: 1 problem must be fixed first.');
    expect(mdContent).toContain('F-BLOCKER-001');
    expect(mdContent).toContain('Critical checkout crash');
    expect(mdContent).toContain('Run the check-up again on the same address');
  });

  describe('slower than last check-up', () => {
    const base: ReleaseReport = {
      runId: 'run-2',
      productId: 'product-omega',
      targetUrl: 'http://localhost:4000',
      timestamp: '2026-09-26T12:00:00Z',
      durationMs: 1000,
      coverage: {
        totalTestPoints: 1,
        passed: 1,
        failed: 0,
        blocked: 0,
        skipped: 0,
        couldNotVerify: 0,
        completionRate: 100,
      },
      results: [],
      findings: [],
    };
    const withSlower: ReleaseReport = {
      ...base,
      slowerThanLastTime: [
        {
          urlPath: '/pricing',
          role: 'visitor',
          breakpoint: '375px',
          aspect: 'Fast and mobile',
          checker: 'performance',
          metric: 'lcp',
          previousMs: 2000,
          currentMs: 2600,
          increaseMs: 600,
          increasePercent: 30,
          loads: 3,
          throttled: true,
          summary: 'Slower than the last check-up: it was 2.0 s, now 2.6 s.',
        },
      ],
    };

    it('slower: findings.json carries slowerThanLastTime and report.md lists it', async () => {
      const { jsonPath, mdPath } = await new ReportGenerator(tempDir).generate(withSlower);
      const parsed = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
      expect(parsed.slowerThanLastTime).toHaveLength(1);
      expect(parsed.slowerThanLastTime[0].currentMs).toBe(2600);
      expect(parsed.findings).toHaveLength(0);
      const md = await fs.readFile(mdPath, 'utf8');
      expect(md).toContain('## Slower than the last check-up');
      expect(md).toContain('/pricing');
      expect(md).toContain('now 2.6 s');
    });

    it('slower: report without slower pages has no section and findings.json has no slowerThanLastTime key', async () => {
      const { jsonPath, mdPath } = await new ReportGenerator(tempDir).generate(base);
      const parsed = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
      expect(parsed).not.toHaveProperty('slowerThanLastTime');
      expect(await fs.readFile(mdPath, 'utf8')).not.toContain('Slower than the last check-up');
    });

    it('slower: md Active Findings count and verdict stamp same with and without slower pages', async () => {
      const gen = new ReportGenerator(tempDir);
      const a = await fs.readFile((await gen.generate(base)).mdPath, 'utf8');
      const b = await fs.readFile((await gen.generate(withSlower)).mdPath, 'utf8');
      const verdictLine = (md: string) => md.split('\n').filter((l) => /Ready to release|Not ready yet/.test(l));
      expect(verdictLine(a).length).toBeGreaterThan(0);
      expect(verdictLine(b)).toEqual(verdictLine(a));
      const count = (md: string) => md.split('\n').filter((l) => /Active Findings/.test(l));
      expect(count(b)).toEqual(count(a));
    });
  });
});

describe('ReportGenerator findings contract', () => {
  const dirA = path.resolve(__dirname, './temp-reporter-contract-a');
  const dirB = path.resolve(__dirname, './temp-reporter-contract-b');

  afterEach(async () => {
    await fs.rm(dirA, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dirB, { recursive: true, force: true }).catch(() => {});
  });

  const mk = (runId: string, timestamp: string): ReleaseReport => ({
    runId,
    productId: 'product-omega',
    targetUrl: 'http://localhost:4000',
    timestamp,
    durationMs: 1,
    coverage: {
      totalTestPoints: 1,
      passed: 0,
      failed: 1,
      blocked: 0,
      skipped: 0,
      couldNotVerify: 0,
      completionRate: 100,
    },
    results: [],
    findings: [
      {
        id: 'F-1',
        severity: 'Major',
        checker: 'bug-detection',
        title: 'Broken link',
        where: { urlPath: '/pricing', role: 'member', breakpoint: '1440px' },
        expectedVsActual: { expected: 'a', actual: 'b' },
        stepsToReproduce: [],
        evidence: {},
        resolution: 'Fix it',
      },
    ],
  });

  it('findings.json has schemaVersion 1 and a fingerprint on every finding', async () => {
    const { jsonPath } = await new ReportGenerator(dirA).generate(mk('run-a', '2026-10-08T10:00:00Z'));
    const parsed = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    expect(parsed.schemaVersion).toBe(1);
    for (const f of parsed.findings) expect(f.fingerprint).toMatch(/^fp_[0-9a-f]{16}$/);
  });

  it('fingerprints are identical across two generate calls with different runId, timestamp and output folder', async () => {
    const a = await new ReportGenerator(dirA).generate(mk('run-a', '2026-10-08T10:00:00Z'));
    const b = await new ReportGenerator(dirB).generate(mk('run-b', '2027-01-01T00:00:00Z'));
    const fps = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8')).findings.map((f: any) => f.fingerprint);
    expect(await fps(a.jsonPath)).toEqual(await fps(b.jsonPath));
  });
});
