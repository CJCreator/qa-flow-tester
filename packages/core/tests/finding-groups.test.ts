import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import type { Finding } from '@qa/types';
import { mergeDuplicateFindings } from '../src/finding-groups.js';
import { EvidenceCollector } from '../src/evidence.js';

const finding = (overrides: Partial<Finding> & { urlPath: string; testCaseId: string }): Finding => {
  const { urlPath, ...rest } = overrides;
  return {
    id: `F-${overrides.testCaseId}`,
    severity: 'Major',
    checker: 'ux-quality',
    title: 'WCAG Violation: Images must have alternative text (image-alt)',
    where: { urlPath, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: '' },
    stepsToReproduce: [],
    evidence: {},
    resolution: '',
    ...rest,
  };
};

describe('mergeDuplicateFindings', () => {
  it('merges the same problem on the same page, recording where else it was seen', () => {
    const merged = mergeDuplicateFindings([
      finding({ urlPath: '/', testCaseId: 'TC-1' }),
      finding({
        urlPath: 'http://localhost:3000/',
        testCaseId: 'TC-2',
        where: { urlPath: '/', role: 'admin', breakpoint: '375px' },
      }),
      finding({ urlPath: '/about', testCaseId: 'TC-3' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      occurrences: 2,
      seenAt: { breakpoints: ['1440px', '375px'], roles: ['visitor', 'admin'], testCaseIds: ['TC-1', 'TC-2'] },
    });
    expect(merged[1].occurrences).toBeUndefined();
  });

  it('reports one element that appears on every page once, but page-wide problems once per page', () => {
    const smallLink = (page: string, id: string) =>
      finding({
        urlPath: page,
        testCaseId: id,
        title: 'Touch target too small: Home (37x18px)',
        where: { urlPath: page, role: 'visitor', breakpoint: '375px', cssSelector: 'a:has-text("Home")' },
      });
    const deadEnd = (page: string, id: string) =>
      finding({ urlPath: page, testCaseId: id, title: 'Dead End Page: No back button' });

    const merged = mergeDuplicateFindings([
      smallLink('/', 'P1'),
      smallLink('/about', 'P2'),
      deadEnd('/a', 'P3'),
      deadEnd('/b', 'P4'),
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0].seenAt?.pages).toEqual(['/', '/about']);
  });

  it('reports a file that fails on every page once', () => {
    const failing = (page: string, id: string) =>
      finding({
        urlPath: page,
        testCaseId: id,
        checker: 'bug-detection',
        title: 'Third-party request failed: HTTP 404 on GET https://cdn.example.net/a.js',
        evidence: { networkLogs: [{ url: 'https://cdn.example.net/a.js', method: 'GET', status: 404, timestamp: 1 }] },
      });
    expect(mergeDuplicateFindings([failing('/', 'P1'), failing('/about', 'P2'), failing('/shop', 'P3')])).toHaveLength(
      1
    );
  });

  it('assigns canonical issueKey and deduplicates findings with query strings or unnormalized paths', () => {
    const f1 = finding({
      urlPath: '/products/?utm_source=google&id=1#details',
      testCaseId: 'TC-1',
      title: 'Missing landmark <main>',
      where: { urlPath: '/products/?utm_source=google&id=1#details', role: 'visitor', breakpoint: '1440px' },
    });
    const f2 = finding({
      urlPath: 'https://example.com/products',
      testCaseId: 'TC-2',
      title: 'Missing landmark <main>',
      where: { urlPath: 'https://example.com/products', role: 'admin', breakpoint: '375px' },
    });
    const merged = mergeDuplicateFindings([f1, f2]);
    expect(merged).toHaveLength(1);
    expect(merged[0].issueKey).toBeDefined();
    expect(merged[0].where.urlPath).toBe('/products');
    expect(merged[0].seenAt?.pages).toEqual(['/products']);
    expect(merged[0].seenAt?.roles).toEqual(['visitor', 'admin']);
  });

  it('reports one console error once, however many steps with different names caught it', () => {
    const consoleError = (stepName: string, id: string, text = 'Simulated Unhandled Runtime Bug') =>
      finding({
        urlPath: '/dashboard',
        testCaseId: id,
        checker: 'bug-detection',
        title: `Console Error in step "${stepName}"`,
        expectedVsActual: { expected: 'Zero unhandled errors', actual: text },
        evidence: { consoleLogs: [{ type: 'error', text, timestamp: 1 }] },
      });

    const merged = mergeDuplicateFindings([
      consoleError('Click Trigger Console Error Button', 'FLOW-006'),
      consoleError('Try “Trigger Console Error”', 'SWEEP-006'),
      consoleError('Try “Trigger Console Error”', 'SWEEP-006', 'A different error'),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].seenAt?.testCaseIds).toEqual(['FLOW-006', 'SWEEP-006']);
  });
});

describe('EvidenceCollector', () => {
  it('reports each console error at the step where it happened, not again at every later step', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const collector = new EvidenceCollector(path.join(os.tmpdir(), `qa-evidence-${Date.now()}`));
    collector.attach(page);

    await page.setContent('<p>hi</p>');
    await page.evaluate(() => console.error('first problem'));
    const first = await collector.recordStep(page, 1, 'one', 'click', 'about:blank', true);
    const second = await collector.recordStep(page, 2, 'two', 'click', 'about:blank', true);
    await browser.close();

    expect(first.consoleErrors.map((c) => c.text)).toEqual(['first problem']);
    expect(second.consoleErrors).toEqual([]);
  }, 30000);
});
