import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateSingleFileHtmlReport } from '../src/html-report.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { ReleaseReport } from '@qa/types';

describe('Single-File Offline HTML Report (html-report.ts)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-test-html-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const mockReport: ReleaseReport = {
    runId: 'run-test-123',
    productId: 'test-product',
    targetUrl: 'http://localhost:3050',
    timestamp: new Date().toISOString(),
    durationMs: 4200,
    coverage: {
      totalTestPoints: 5,
      passed: 4,
      failed: 1,
      blocked: 0,
      skipped: 0,
      couldNotVerify: 0,
      completionRate: 100,
    },
    results: [],
    findings: [
      {
        id: 'F-001',
        title: 'Missing Content-Security-Policy header',
        severity: 'Major',
        checker: 'security',
        where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: 'CSP header set', actual: 'No CSP header' },
        stepsToReproduce: ['Visit /', 'Inspect headers'],
        evidence: {},
        resolution: 'Add CSP header',
      },
    ],
    grades: {
      aspects: {
        Works: { grade: 'A', score: 100, findings: [] },
        Accessible: { grade: 'A', score: 95, findings: [] },
        'Fast and mobile': { grade: 'A', score: 90, findings: [] },
        Findable: { grade: 'B', score: 85, findings: [] },
        Secure: { grade: 'B', score: 85, findings: ['F-001'] },
        'Looks and reads well': { grade: 'A', score: 100, findings: [] },
      },
      overallGrade: 'A',
      overallScore: 92,
    },
    recommendations: [
      {
        id: 'REC-001',
        category: 'quick-win',
        title: 'Configure Content-Security-Policy header',
        aspect: 'Secure',
        severity: 'Major',
        effort: 'Low',
        impact: 'High',
        affectedPages: ['/'],
        findingIds: ['F-001'],
        summary: 'No CSP header was returned',
        suggestedFix: "Set default-src 'self'",
      },
    ],
  };

  it('generates a single self-contained HTML file without external asset links', async () => {
    const reportPath = await generateSingleFileHtmlReport(mockReport, { outputDir: tempDir });
    expect(reportPath).toBeDefined();

    const content = await fs.readFile(reportPath, 'utf8');

    // Basic structure checks
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('QA Readiness Report');
    expect(content).toContain('run-test-123');

    // Aspect cards present
    expect(content).toContain('Works');
    expect(content).toContain('Accessible');
    expect(content).toContain('Fast and mobile');
    expect(content).toContain('Findable');
    expect(content).toContain('Secure');
    expect(content).toContain('Looks and reads well');

    // Recommendations present
    expect(content).toContain('Prioritized Improvement Recommendations');
    expect(content).toContain('Configure Content-Security-Policy header');

    // Findings collapsible details present
    expect(content).toContain('Missing Content-Security-Policy header');
    expect(content).toContain('Run the check-up again on the same address');

    // Direction B theme color present
    expect(content).toContain('#0D1322');

    // No external scripts or CDNs (works 100% offline)
    expect(content).not.toContain('<script src="http');
    expect(content).not.toContain('<link rel="stylesheet" href="http');
  });

  it('leads with the same verdict as the screen, and no overall grade to contradict it', async () => {
    // One Major finding: not ready, whatever the overall score says.
    const content = await fs.readFile(await generateSingleFileHtmlReport(mockReport, { outputDir: tempDir }), 'utf8');
    expect(content).toContain('Not ready yet');
    expect(content).toContain('1 problem must be fixed first.');
    expect(content).not.toContain('92/100');
    expect(content).not.toContain('Overall Readiness');
    expect(content).not.toContain('Ready to release');

    const clean = await fs.readFile(
      await generateSingleFileHtmlReport({ ...mockReport, findings: [] }, { outputDir: tempDir }),
      'utf8'
    );
    expect(clean).toContain('Ready to release');
    expect(clean).toContain('No problems found.');
  });

  it('says "Not checked" for an aspect none of whose checks ran', async () => {
    const report: ReleaseReport = {
      ...mockReport,
      grades: {
        ...mockReport.grades!,
        aspects: { ...mockReport.grades!.aspects, Findable: { grade: 'A', score: 100, findings: [], checked: false } },
      },
    };
    const content = await fs.readFile(await generateSingleFileHtmlReport(report, { outputDir: tempDir }), 'utf8');
    const findable = content.slice(content.indexOf('>Findable<'), content.indexOf('>Secure<'));
    expect(findable).toContain('Not checked');
    expect(findable).not.toContain('Grade A');
  });

  it('slower: report.html lists it with escaped text, and omits the section when none', async () => {
    const report: ReleaseReport = {
      ...mockReport,
      slowerThanLastTime: [
        {
          urlPath: '/a<b>',
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
          summary: 'Slower than the last check-up: <script>x</script> 2.0 s to 2.6 s',
        },
      ],
    };
    const content = await fs.readFile(await generateSingleFileHtmlReport(report, { outputDir: tempDir }), 'utf8');
    expect(content).toContain('Slower than the last check-up');
    expect(content).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(content).not.toContain('<script>x</script>');
    expect(content).toContain('/a&lt;b&gt;');

    const none = await fs.readFile(await generateSingleFileHtmlReport(mockReport, { outputDir: tempDir }), 'utf8');
    expect(none).not.toContain('Slower than the last check-up');
  });
});
