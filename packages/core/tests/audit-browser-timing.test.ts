/**
 * Unit tests for browser lab timing (T-82, ADR 0042).
 * Metric extraction, shaping into ExternalSpeed format, and page recorder integration.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import {
  extractTimingMetrics,
  shapeBrowserTimingSpeed,
  createBrowserTimingSpeed,
  measureBrowserTiming,
  LAB_THROTTLING,
} from '../src/audit/speed/browser-timing.js';
import { createPageRecorder } from '../src/audit/pipeline/page-recorder.js';
import type { AuditCrawlPage } from '../src/audit/crawl/crawl.js';

const FIXED_DATE = new Date('2026-11-05T12:00:00.000Z');
const now = () => FIXED_DATE;

describe('browser-timing: extractTimingMetrics', () => {
  it('extracts TTFB, load time, and DOM ready from structured navigation timing', () => {
    const raw = extractTimingMetrics({
      navigation: {
        responseStart: 245.8,
        requestStart: 120.2,
        loadEventEnd: 1540.2,
        domContentLoadedEventEnd: 820.6,
      },
    });

    expect(raw.ttfbMs).toBe(246);
    expect(raw.loadTimeMs).toBe(1540);
    expect(raw.domReadyMs).toBe(821);
  });

  it('extracts FCP from paint entries', () => {
    const raw = extractTimingMetrics({
      paints: [
        { name: 'first-paint', startTime: 410.2 },
        { name: 'first-contentful-paint', startTime: 620.7 },
      ],
    });

    expect(raw.fcpMs).toBe(621);
  });

  it('extracts LCP from the last largest-contentful-paint entry', () => {
    const raw = extractTimingMetrics({
      lcpEntries: [{ startTime: 850.3 }, { startTime: 1240.6 }, { startTime: 1820.1 }],
    });

    expect(raw.lcpMs).toBe(1820);
  });

  it('calculates CLS using session window algorithm and ignores shifts with recent input', () => {
    const raw = extractTimingMetrics({
      layoutShifts: [
        { startTime: 200, value: 0.05, hadRecentInput: false },
        { startTime: 400, value: 0.03, hadRecentInput: false },
        { startTime: 600, value: 0.5, hadRecentInput: true }, // ignored
        { startTime: 2500, value: 0.02, hadRecentInput: false },
      ],
    });

    expect(raw.cls).toBe(0.08);
  });

  it('extracts metrics from a flat list of PerformanceEntry-like objects', () => {
    const entries = [
      {
        entryType: 'navigation',
        name: 'https://example.com/',
        startTime: 0,
        responseStart: 180.4,
        loadEventEnd: 1200.7,
        domContentLoadedEventEnd: 600.2,
      },
      {
        entryType: 'paint',
        name: 'first-contentful-paint',
        startTime: 450.3,
      },
      {
        entryType: 'largest-contentful-paint',
        startTime: 980.6,
      },
      {
        entryType: 'layout-shift',
        startTime: 300,
        value: 0.04,
        hadRecentInput: false,
      },
    ];

    const raw = extractTimingMetrics(entries);
    expect(raw.ttfbMs).toBe(180);
    expect(raw.loadTimeMs).toBe(1201);
    expect(raw.domReadyMs).toBe(600);
    expect(raw.fcpMs).toBe(450);
    expect(raw.lcpMs).toBe(981);
    expect(raw.cls).toBe(0.04);
  });

  it('handles empty or malformed inputs without throwing', () => {
    expect(extractTimingMetrics({})).toEqual({});
    expect(extractTimingMetrics([])).toEqual({});
    expect(extractTimingMetrics([null, undefined, {} as any])).toEqual({});
  });
});

describe('browser-timing: shapeBrowserTimingSpeed', () => {
  it('shapes extracted metrics into ExternalSpeed format labelled source: this-tool, method: lab, strategy: mobile', () => {
    const speed = shapeBrowserTimingSpeed(
      {
        lcpMs: 2450.2,
        cls: 0.042,
        fcpMs: 820.7,
        ttfbMs: 190.1,
        loadTimeMs: 2800,
      },
      now
    );

    expect(speed).toEqual({
      status: 'measured',
      source: 'this-tool',
      method: 'lab',
      strategy: 'mobile',
      measuredAt: '2026-11-05T12:00:00.000Z',
      values: [
        { metric: 'lcp', value: 2450, unit: 'ms' },
        { metric: 'cls', value: 0.042, unit: 'none' },
        { metric: 'fcp', value: 821, unit: 'ms' },
        { metric: 'ttfb', value: 190, unit: 'ms' },
      ],
    });
  });

  it('omits metrics that were not measured or are not finite', () => {
    const speed = shapeBrowserTimingSpeed(
      {
        lcpMs: 1500,
        cls: undefined,
        fcpMs: NaN,
        ttfbMs: 210,
      },
      now
    );

    expect(speed.status).toBe('measured');
    if (speed.status !== 'measured') throw new Error('Expected measured');
    expect(speed.values).toEqual([
      { metric: 'lcp', value: 1500, unit: 'ms' },
      { metric: 'ttfb', value: 210, unit: 'ms' },
    ]);
  });

  it('returns not-measured with reason failed when no metrics could be extracted', () => {
    const speed = shapeBrowserTimingSpeed({}, now);
    expect(speed).toEqual({
      status: 'not-measured',
      source: 'this-tool',
      method: 'lab',
      reason: 'failed',
    });
  });

  it('createBrowserTimingSpeed extracts and shapes in one step', () => {
    const speed = createBrowserTimingSpeed(
      {
        navigation: { responseStart: 125, loadEventEnd: 800 },
        lcpEntries: [{ startTime: 650 }],
      },
      now
    );

    expect(speed.status).toBe('measured');
    if (speed.status !== 'measured') throw new Error('Expected measured');
    expect(speed.source).toBe('this-tool');
    expect(speed.method).toBe('lab');
    expect(speed.strategy).toBe('mobile');
    expect(speed.values).toEqual([
      { metric: 'lcp', value: 650, unit: 'ms' },
      { metric: 'ttfb', value: 125, unit: 'ms' },
    ]);
  });
});

describe('browser-timing: lab profile and helpers', () => {
  it('uses the Check-up lab profile constants (LAB_THROTTLING)', () => {
    expect(LAB_THROTTLING).toMatchObject({
      latencyMs: 150,
      downloadKbps: 1600,
      uploadKbps: 750,
      cpuSlowdown: 4,
    });
  });

  it('returns not-measured for non-http URLs or invalid pages', async () => {
    const fakePage = {
      url: () => 'file:///etc/passwd',
      context: () => ({}),
    } as unknown as Page;

    const res = await measureBrowserTiming(fakePage);
    expect(res.speed).toEqual({
      status: 'not-measured',
      source: 'this-tool',
      method: 'lab',
      reason: 'failed',
    });
    expect(res.raw).toEqual({});
  });

  it('returns not-measured for pages lacking browser context methods', async () => {
    const emptyPage = {} as unknown as Page;
    const res = await measureBrowserTiming(emptyPage);
    expect(res.speed.status).toBe('not-measured');
  });
});

describe('browser-timing: page-recorder integration', () => {
  it('takes lab timing on Sample Pages and attaches it to RecordedPage', async () => {
    const fakeSpeed = shapeBrowserTimingSpeed({ lcpMs: 1200, fcpMs: 500, ttfbMs: 150 }, now);
    const mockMeasureTiming = vi.fn(async () => ({
      speed: fakeSpeed,
      raw: { lcpMs: 1200, fcpMs: 500, ttfbMs: 150 },
    }));

    const recorder = createPageRecorder({
      workDir: 'tmp/test-recorder',
      stages: {
        readPage: vi.fn(async () => ({
          raw: { url: 'https://example.com/' } as any,
          content: { title: 'Home', language: { htmlLang: 'en' }, sections: [] } as any,
        })),
        accessibilityBasics: vi.fn(async () => null),
        recordPhoneLayout: vi.fn(async () => null),
        measureBrowserTiming: mockMeasureTiming,
      },
    });

    const page1: AuditCrawlPage = { urlPath: '/', title: 'Home', depth: 0 };
    await recorder.onRenderedPage({ url: () => 'https://example.com/' } as unknown as Page, page1);

    expect(mockMeasureTiming).toHaveBeenCalledTimes(1);
    expect(recorder.pages[0].timing).toBeDefined();
    expect(recorder.pages[0].timing?.speed).toEqual(fakeSpeed);
    expect(recorder.pages[0].timing?.raw.lcpMs).toBe(1200);
  });

  it('does not measure timing on covered pages', async () => {
    const mockMeasureTiming = vi.fn(async () => ({
      speed: shapeBrowserTimingSpeed({ lcpMs: 1000 }, now),
      raw: { lcpMs: 1000 },
    }));

    const recorder = createPageRecorder({
      workDir: 'tmp/test-recorder',
      stages: {
        readPage: vi.fn(async () => ({
          raw: { url: 'https://example.com/p' } as any,
          content: { title: 'P', language: { htmlLang: 'en' }, sections: [] } as any,
        })),
        accessibilityBasics: vi.fn(async () => null),
        recordPhoneLayout: vi.fn(async () => null),
        measureBrowserTiming: mockMeasureTiming,
      },
    });

    // Feed 4 pages of same layoutGroup: first 3 are samples, 4th is covered
    for (let i = 1; i <= 4; i++) {
      await recorder.onRenderedPage({ url: () => `https://example.com/items/${i}` } as unknown as Page, {
        urlPath: `/items/${i}`,
        title: `Item ${i}`,
        depth: 1,
        layoutGroup: 'items-:id',
      });
    }

    expect(recorder.pages[0].coverage).toBe('sample');
    expect(recorder.pages[1].coverage).toBe('sample');
    expect(recorder.pages[2].coverage).toBe('sample');
    expect(recorder.pages[3].coverage).toBe('covered');

    // 3 samples measured, covered page skipped
    expect(mockMeasureTiming).toHaveBeenCalledTimes(3);
    expect(recorder.pages[3].timing).toBeUndefined();
  });

  it('records timing as null when measureBrowserTiming throws, without halting crawl', async () => {
    const failingMeasureTiming = vi.fn(async () => {
      throw new Error('CDP connection failed');
    });

    const recorder = createPageRecorder({
      workDir: 'tmp/test-recorder',
      stages: {
        readPage: vi.fn(async () => null),
        accessibilityBasics: vi.fn(async () => null),
        recordPhoneLayout: vi.fn(async () => null),
        measureBrowserTiming: failingMeasureTiming,
      },
    });

    await expect(
      recorder.onRenderedPage({ url: () => 'https://example.com/' } as unknown as Page, {
        urlPath: '/',
        title: 'Home',
        depth: 0,
      })
    ).resolves.not.toThrow();

    expect(recorder.pages[0].timing).toBeNull();
  });
});
