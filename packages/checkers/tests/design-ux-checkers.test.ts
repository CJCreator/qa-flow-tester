import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DesignStandardsChecker, hexToRgb, normalizeColor } from '../src/design-standards.js';
import { UXQualityChecker, wcagCriteria } from '../src/ux-quality.js';
import { chromium, type Browser } from 'playwright';
import type { Finding } from '@qa/types';
import { PNG } from 'pngjs';

describe('Design & UX Checkers', () => {
  describe('Color Normalization & Tokens', () => {
    it('converts 6-digit and 3-digit hex colors to rgb', () => {
      expect(hexToRgb('#2563eb')).toBe('rgb(37, 99, 235)');
      expect(hexToRgb('#fff')).toBe('rgb(255, 255, 255)');
      expect(hexToRgb('#000')).toBe('rgb(0, 0, 0)');
      expect(hexToRgb('not-a-hex')).toBeNull();
    });

    it('normalizes hex and rgb color strings for comparison', () => {
      expect(normalizeColor('#2563eb')).toBe('rgb(37, 99, 235)');
      expect(normalizeColor('rgb(37,99,235)')).toBe('rgb(37, 99, 235)');
      expect(normalizeColor('rgb(37,  99,  235)')).toBe('rgb(37, 99, 235)');
    });
  });

  describe('DesignStandardsChecker Visual Diff', () => {
    const checker = new DesignStandardsChecker();

    /** Solid-color PNG with an optional filled rectangle painted on top. */
    function makePng(
      width: number,
      height: number,
      bg: [number, number, number],
      rect?: { x: number; y: number; w: number; h: number; color: [number, number, number] }
    ): Buffer {
      const png = new PNG({ width, height });
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const inRect = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
          const [r, g, b] = inRect ? rect!.color : bg;
          const i = (y * width + x) * 4;
          png.data[i] = r;
          png.data[i + 1] = g;
          png.data[i + 2] = b;
          png.data[i + 3] = 255;
        }
      }
      return PNG.sync.write(png);
    }

    it('matches identical images with 0% diff', async () => {
      const a = makePng(50, 50, [255, 255, 255]);
      const result = await checker.checkVisualDiff(a, makePng(50, 50, [255, 255, 255]));
      expect(result.match).toBe(true);
      expect(result.diffPercent).toBe(0);
    });

    it('measures the changed region as a fraction of pixels', async () => {
      const baseline = makePng(100, 100, [255, 255, 255]);
      const current = makePng(100, 100, [255, 255, 255], { x: 0, y: 0, w: 20, h: 10, color: [220, 38, 38] });
      const result = await checker.checkVisualDiff(current, baseline, { maxDiffPercent: 0.01 });
      expect(result.diffPixels).toBe(200);
      expect(result.diffPercent).toBeCloseTo(0.02);
      expect(result.match).toBe(false);
    });

    it('tolerates changes below maxDiffPercent', async () => {
      const baseline = makePng(100, 100, [255, 255, 255]);
      const current = makePng(100, 100, [255, 255, 255], { x: 0, y: 0, w: 5, h: 5, color: [0, 0, 0] });
      const result = await checker.checkVisualDiff(current, baseline, { maxDiffPercent: 0.01 });
      expect(result.match).toBe(true);
    });

    it('treats a dimension change as a full mismatch', async () => {
      const result = await checker.checkVisualDiff(makePng(100, 120, [0, 0, 0]), makePng(100, 100, [0, 0, 0]));
      expect(result).toMatchObject({ match: false, sizeMismatch: true, diffPercent: 1 });
    });
  });

  describe('UXQualityChecker Route Deduplication', () => {
    const uxChecker = new UXQualityChecker();

    it('deduplicates recurring rule violations on the same route', () => {
      const findings: Finding[] = [
        {
          id: 'F-1',
          severity: 'Major',
          checker: 'ux-quality',
          title: 'WCAG Violation: color-contrast',
          where: { urlPath: '/checkout', role: 'shopper', breakpoint: '1440px', cssSelector: 'header > a' },
          expectedVsActual: { expected: 'contrast >= 4.5', actual: '2.1' },
          stepsToReproduce: [],
          evidence: {},
          resolution: '',
        },
        {
          id: 'F-2', // Duplicate on same route and selector from step 2
          severity: 'Major',
          checker: 'ux-quality',
          title: 'WCAG Violation: color-contrast',
          where: { urlPath: '/checkout', role: 'shopper', breakpoint: '1440px', cssSelector: 'header > a' },
          expectedVsActual: { expected: 'contrast >= 4.5', actual: '2.1' },
          stepsToReproduce: [],
          evidence: {},
          resolution: '',
        },
        {
          id: 'F-3', // Distinct issue on different route
          severity: 'Major',
          checker: 'ux-quality',
          title: 'WCAG Violation: color-contrast',
          where: { urlPath: '/invoices', role: 'shopper', breakpoint: '1440px', cssSelector: 'header > a' },
          expectedVsActual: { expected: 'contrast >= 4.5', actual: '2.1' },
          stepsToReproduce: [],
          evidence: {},
          resolution: '',
        },
      ];

      const deduplicated = uxChecker.deduplicateFindings(findings);
      expect(deduplicated.length).toBe(2);
      expect(deduplicated.map((d) => d.where.urlPath)).toEqual(['/checkout', '/invoices']);
    });
  });
});

describe('UXQualityChecker accessibility scan', () => {
  const checker = new UXQualityChecker();
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });
  const ctx = { role: 'visitor', breakpoint: '1440px' as const, urlPath: '/' };

  it('maps axe tags to WCAG criteria', () => {
    expect(wcagCriteria(['wcag2aa', 'wcag143'])).toEqual(['WCAG 1.4.3 Contrast (Minimum)']);
    expect(wcagCriteria(['best-practice'])).toEqual([]);
  });

  it('reports a scan that could not run instead of a clean pass', async () => {
    const brokenPage = {
      evaluate: async () => {
        throw new Error('boom');
      },
    } as never;
    const findings = await checker.check(brokenPage, ctx);
    const failed = findings.find((f) => f.id.startsWith('F-A11Y-SCAN-FAILED'));
    expect(failed?.severity).toBe('Major');
    expect(failed?.expectedVsActual.actual).toContain('has not been checked');
  });

  it('lists every element that breaks a rule, with the WCAG criterion', async () => {
    const page = await (await browser.newContext()).newPage();
    try {
      await page.setContent(
        '<html lang="en"><head><title>t</title></head><body><main>' +
          '<img src="a.png"><img src="b.png"><img src="c.png"></main></body></html>'
      );
      const findings = await checker.check(page, ctx);
      const img = findings.find((f) => f.title.includes('image-alt'));
      expect(img?.title).toContain('WCAG 1.1.1');
      expect(img?.evidence.allTargets).toHaveLength(3);
      expect(img?.expectedVsActual.actual).toContain('3 elements');
    } finally {
      await page.context().close();
    }
  });

  it('rates targets between 24 and 44px as a suggestion, not an AA failure', async () => {
    const page = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    try {
      await page.setContent(
        '<html lang="en"><head><title>t</title></head><body><main>' +
          '<button style="box-sizing:border-box;padding:0;width:30px;height:30px">a</button>' +
          '<button style="box-sizing:border-box;padding:0;width:10px;height:10px">b</button></main></body></html>'
      );
      const findings = await checker.check(page, { ...ctx, breakpoint: '375px', enableAxe: false });
      const targets = findings.filter((f) => f.id.startsWith('F-UX-TARGET'));
      expect(targets.find((f) => f.title.includes('(30x30px)'))?.severity).toBe('Suggestion');
      expect(targets.find((f) => f.title.includes('(10x10px)'))?.severity).toBe('Minor');
      expect(targets.find((f) => f.title.includes('(10x10px)'))?.title).toContain('2.5.8');
    } finally {
      await page.context().close();
    }
  });
});
