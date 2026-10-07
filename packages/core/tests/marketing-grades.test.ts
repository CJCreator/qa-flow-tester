import { describe, it, expect } from 'vitest';
import type { Finding, MarketingReview, ReleaseReport } from '@qa/types';
import { calculateSiteAspectGrades } from '../src/scoring.js';
import { generateSingleFileHtmlReport } from '../src/html-report.js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const searchRan = { checkersRun: ['seo' as const] };

describe('The Marketing score of the Findable area', () => {
  it('is marked not checked when the home page was never read, so it is not shown as a pass', () => {
    const grades = calculateSiteAspectGrades([], { ...searchRan, marketingChecked: false });
    expect(grades.aspects.Findable.subBreakdown?.marketing).toMatchObject({ score: 100, checked: false });
    // The other parts of the area are unaffected.
    expect(grades.aspects.Findable.subBreakdown?.seo.checked).toBeUndefined();
  });

  it('is an ordinary score when it was checked, or when nobody says (older callers)', () => {
    expect(
      calculateSiteAspectGrades([], { ...searchRan, marketingChecked: true }).aspects.Findable.subBreakdown?.marketing
        .checked
    ).toBeUndefined();
    expect(calculateSiteAspectGrades([], searchRan).aspects.Findable.subBreakdown?.marketing.checked).toBeUndefined();
  });

  it('counts a marketing finding against it', () => {
    const finding = {
      id: 'F-MKT-1',
      severity: 'Minor',
      checker: 'seo',
      categoryTag: 'MKT',
      title: 'x',
      where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: 'a', actual: 'b' },
      stepsToReproduce: [],
      evidence: {},
      resolution: 'r',
    } as unknown as Finding;
    const grades = calculateSiteAspectGrades([finding], { ...searchRan, marketingChecked: true });
    expect(grades.aspects.Findable.subBreakdown?.marketing).toMatchObject({
      score: 95,
      issueCount: 1,
      status: 'Clean',
    });
  });
});

describe('The marketing checklist in the written reports', () => {
  const marketing: MarketingReview = {
    readPages: ['/'],
    checks: [
      {
        key: 'CTA',
        label: 'A clear call to action',
        kind: 'fact',
        status: 'gap',
        detail: 'Not found on /.',
        findingId: 'F-MKT-1',
      },
      { key: 'PRICING', label: 'Pricing or plans', kind: 'opinion', status: 'gap', detail: 'Not found on /.' },
      {
        key: 'SOCIAL',
        label: 'Links to social profiles',
        kind: 'fact',
        status: 'not-checked',
        detail: 'This is looked for on the home page, which wasn’t among the pages tested.',
      },
    ],
  };

  it('is listed in the HTML report, saying which are suggestions and which were not checked', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-mkt-'));
    try {
      const report = {
        runId: 'r1',
        productId: 'p',
        targetUrl: 'https://example.com',
        timestamp: new Date().toISOString(),
        durationMs: 1,
        coverage: {
          totalTestPoints: 0,
          passed: 0,
          failed: 0,
          blocked: 0,
          skipped: 0,
          couldNotVerify: 0,
          flakyFlows: 0,
          completionRate: 100,
        },
        results: [],
        findings: [],
        marketing,
      } as unknown as ReleaseReport;
      const file = await generateSingleFileHtmlReport(report, { outputDir: dir });
      const html = await fs.readFile(file, 'utf8');
      expect(html).toContain('Marketing basics');
      expect(html).toContain('Pricing or plans (suggestion)');
      expect(html).toContain('Worth adding');
      expect(html).toContain('Missing');
      expect(html).toContain('Not checked');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
