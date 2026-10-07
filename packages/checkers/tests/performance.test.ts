import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PerformanceChecker, SPEED_THRESHOLDS, sessionWindowCls, median } from '../src/performance.js';
import { chromium, type Browser } from 'playwright';
import type { Page } from 'playwright';

describe('PerformanceChecker', () => {
  const checker = new PerformanceChecker();

  function createMockPage(metricsOverride: any): Page {
    return {
      evaluate: async () => metricsOverride,
      url: () => 'http://localhost:3050/reports',
      context: () => ({
        cookies: async () => [],
      }),
    } as unknown as Page;
  }

  it('flags slow Largest Contentful Paint (LCP >= 4s as Major, > 2.5s as Minor)', async () => {
    // 1. Slow LCP = 4200ms -> Major
    const slowPage = createMockPage({
      lcpMs: 4200,
      layoutShifts: [{ startTime: 100, value: 0.02 }],
      slowestRequests: [],
      overflowElements: [],
      hasHorizontalScroll: false,
      overlappingElements: [],
    });

    const findings = await checker.checkPage(slowPage, {
      testCaseId: 'TC-SLOW',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/reports',
    });

    const lcpFinding = findings.find((f) => f.title.includes('Largest Contentful Paint'));
    expect(lcpFinding).toBeDefined();
    expect(lcpFinding?.severity).toBe('Major');
    expect(lcpFinding?.expectedVsActual.expected).toContain('Measured in a test browser, not by real visitors');

    // 2. Fast page (LCP = 1200ms) -> No finding
    const fastPage = createMockPage({
      lcpMs: 1200,
      layoutShifts: [{ startTime: 100, value: 0.01 }],
      slowestRequests: [],
      overflowElements: [],
      hasHorizontalScroll: false,
      overlappingElements: [],
    });

    const fastFindings = await checker.checkPage(fastPage, {
      testCaseId: 'TC-FAST',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/home',
    });

    expect(fastFindings.find((f) => f.title.includes('Largest Contentful Paint'))).toBeUndefined();
  });

  it('flags high Cumulative Layout Shift (CLS)', async () => {
    const shiftingPage = createMockPage({
      lcpMs: 1500,
      layoutShifts: [{ startTime: 100, value: 0.35 }],
      slowestRequests: [],
      overflowElements: [],
      hasHorizontalScroll: false,
      overlappingElements: [],
    });

    const findings = await checker.checkPage(shiftingPage, {
      testCaseId: 'TC-CLS',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/news',
    });

    const clsFinding = findings.find((f) => f.title.includes('Cumulative Layout Shift'));
    expect(clsFinding).toBeDefined();
    expect(clsFinding?.severity).toBe('Major');
    expect(clsFinding?.expectedVsActual.actual).toContain('0.35');
  });

  it('flags slow requests taking 2 seconds or longer', async () => {
    const pageWithSlowAsset = createMockPage({
      lcpMs: 1500,
      layoutShifts: [{ startTime: 100, value: 0.05 }],
      slowestRequests: [{ url: 'http://localhost:3050/api/reports?slow=true', durationMs: 2400 }],
      overflowElements: [],
      hasHorizontalScroll: false,
      overlappingElements: [],
    });

    const findings = await checker.checkPage(pageWithSlowAsset, {
      testCaseId: 'TC-SLOWREQ',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/reports',
    });

    const reqFinding = findings.find((f) => f.title.includes('Slow request'));
    expect(reqFinding).toBeDefined();
    expect(reqFinding?.title).toContain('2.4s');
  });

  it('flags horizontal overflow as Major on mobile (375px)', async () => {
    const overflowingPage = createMockPage({
      lcpMs: 1500,
      layoutShifts: [{ startTime: 100, value: 0.02 }],
      slowestRequests: [],
      overflowElements: [{ tag: 'table', selector: '.wide-data-table', right: 460 }],
      hasHorizontalScroll: true,
      overlappingElements: [],
    });

    const findings = await checker.checkPage(overflowingPage, {
      testCaseId: 'TC-MOBILE',
      role: 'visitor',
      breakpoint: '375px',
      urlPath: '/pricing',
    });

    const overflowFinding = findings.find((f) => f.title.includes('overflows the screen horizontally'));
    expect(overflowFinding).toBeDefined();
    expect(overflowFinding?.severity).toBe('Major');
    expect(overflowFinding?.where.breakpoint).toBe('375px');
    expect(overflowFinding?.where.cssSelector).toBe('.wide-data-table');
  });

  it('flags overlapping interactive elements', async () => {
    const overlappingPage = createMockPage({
      lcpMs: 1500,
      layoutShifts: [{ startTime: 100, value: 0.02 }],
      slowestRequests: [],
      overflowElements: [],
      hasHorizontalScroll: false,
      overlappingElements: [
        { tag: 'button', selector: '[data-testid="submit-btn"]', overlapsWith: '[data-testid="cancel-btn"]' },
      ],
    });

    const findings = await checker.checkPage(overlappingPage, {
      testCaseId: 'TC-OVERLAP',
      role: 'visitor',
      breakpoint: '768px',
      urlPath: '/modal',
    });

    const overlapFinding = findings.find((f) => f.title.includes('Interactive elements overlap'));
    expect(overlapFinding).toBeDefined();
    expect(overlapFinding?.severity).toBe('Major');
  });

  const quiet = {
    slowestRequests: [],
    overflowElements: [],
    hasHorizontalScroll: false,
    overlappingElements: [],
    totalWeightBytes: 1000,
  };
  const ctx = { role: 'visitor', breakpoint: '1440px' as const, urlPath: '/' };

  it('never reports the HTML-ready time as Largest Contentful Paint', async () => {
    const page = createMockPage({ ...quiet, domReadyMs: 3200 });
    const findings = await checker.checkPage(page, ctx);
    expect(findings.some((f) => f.title.includes('Largest Contentful Paint'))).toBe(false);
    const load = findings.find((f) => f.title.includes('Slow initial page load'));
    expect(load).toBeDefined();
    expect(load?.expectedVsActual.actual).toContain('no Largest Contentful Paint');
  });

  it('reports a slow interaction (INP) from the observer, and nothing when none was slow', async () => {
    const slow = await checker.checkPage(createMockPage({ ...quiet, lcpMs: 1000, inpMs: 620 }), ctx);
    const inp = slow.find((f) => f.title.includes('Slow response to clicks'));
    expect(inp?.severity).toBe('Major');
    expect(inp?.title).toContain('620ms');

    const ok = await checker.checkPage(createMockPage({ ...quiet, lcpMs: 1000 }), ctx);
    expect(ok.some((f) => f.title.includes('Slow response'))).toBe(false);
  });

  it('flags a page over 4 MB and splits this site from other sites', async () => {
    const mb = 1024 * 1024;
    const page = createMockPage({
      ...quiet,
      lcpMs: 1000,
      totalWeightBytes: 5 * mb,
      weightByOrigin: { 'http://localhost:3050': 1 * mb, 'https://cdn.example.com': 4 * mb },
    });
    const findings = await checker.checkPage(page, ctx);
    const heavy = findings.find((f) => f.title.includes('Heavy page'));
    expect(heavy).toBeDefined();
    expect(heavy?.expectedVsActual.actual).toContain('1.0 MB from this site and 4.0 MB from other sites');
    expect((heavy?.evidence.measurements as any).weight.heaviestThirdParties[0].origin).toBe('https://cdn.example.com');

    const light = await checker.checkPage(createMockPage({ ...quiet, lcpMs: 1000, totalWeightBytes: 3 * mb }), ctx);
    expect(light.some((f) => f.title.includes('Heavy page'))).toBe(false);
  });

  describe('Cumulative Layout Shift, as web.dev scores it', () => {
    it('adds shifts less than 1s apart and takes the worst window, not the lifetime sum', () => {
      const shifts = [
        { startTime: 100, value: 0.05 },
        { startTime: 600, value: 0.05 },
        // a quiet 3s, then a second burst
        { startTime: 4000, value: 0.04 },
        { startTime: 4500, value: 0.03 },
      ];
      expect(sessionWindowCls(shifts)).toBeCloseTo(0.1);
      // The old lifetime sum would have said 0.17.
    });

    it('closes a window after 5s even when shifts keep coming', () => {
      const shifts = Array.from({ length: 12 }, (_, i) => ({ startTime: i * 600, value: 0.02 }));
      // 0 to 4.8s fit in one window (9 shifts); the rest start a second one.
      expect(sessionWindowCls(shifts)).toBeCloseTo(0.18);
    });

    it('is 0 with no shifts', () => {
      expect(sessionWindowCls([])).toBe(0);
    });
  });

  it('takes the median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  describe('in a real browser', () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await chromium.launch();
    });
    afterAll(async () => {
      await browser.close();
    });

    const PAGE = `<html><head><title>t</title></head><body>
      <h1 style="font-size:60px">Hello</h1>
      <button aria-expanded="false" onclick="const t=Date.now();while(Date.now()-t<350){}; this.setAttribute('aria-expanded','true')">Menu</button>
      <p>Some text that is the largest paint.</p></body></html>`;

    it('reads a real LCP and a real interaction time from the observers', async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.setContent(PAGE);
        await page.waitForTimeout(300);
        await page.click('button');
        await page.waitForTimeout(300);
        const findings = await checker.checkPage(page, ctx);
        const inp = findings.find((f) => f.title.includes('Slow response to clicks'));
        expect(inp).toBeDefined();
        // The handler blocks for 350ms, so the reported interaction is at least that long.
        expect(Number(/\((\d+)ms\)/.exec(inp!.title)![1])).toBeGreaterThanOrEqual(300);
      } finally {
        await context.close();
      }
    }, 30000);

    it('loads the page repeatedly in a throttled tab and reports the median with its spread', async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await context.route('http://slow.test/**', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: PAGE })
        );
        await page.goto('http://slow.test/');
        const summary = await checker.measureVitals(page, 3);
        expect(summary?.throttled).toBe(true);
        expect(summary?.loads).toBeGreaterThanOrEqual(3);
        expect(summary?.measurements).toHaveProperty('lcpMsRuns');
        expect(summary?.measurements).toHaveProperty('lcpSpreadMs');
        // The page being tested was left alone, and the probe tab is gone.
        expect(context.pages()).toHaveLength(1);
      } finally {
        await context.close();
      }
    }, 90000);
  });
});
