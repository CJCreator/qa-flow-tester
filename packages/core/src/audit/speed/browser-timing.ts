/**
 * Browser lab timing for Website Audit Sample Pages (REQ-012, ADR 0042).
 *
 * Measures speed directly in Chromium using the Check-up's lab profile (`LAB_THROTTLING`) with a single throttled
 * reload of the open Sample Page. Collects LCP, CLS, FCP, TTFB, and load time, shaping into ExternalSpeed format
 * with source: 'this-tool', method: 'lab', strategy: 'mobile'.
 */
import type { Page, CDPSession } from 'playwright';
import type { ExternalSpeed, SpeedValue } from '@qa/types';
import { LAB_THROTTLING, sessionWindowCls } from '@qa/checkers';

export { LAB_THROTTLING };

export interface BrowserTimingRawMetrics {
  /** Largest Contentful Paint in milliseconds. */
  lcpMs?: number;
  /** Cumulative Layout Shift score (worst 5s session window). */
  cls?: number;
  /** First Contentful Paint in milliseconds. */
  fcpMs?: number;
  /** Time to First Byte in milliseconds. */
  ttfbMs?: number;
  /** Full page load time in milliseconds. */
  loadTimeMs?: number;
  /** DOM Content Loaded time in milliseconds. */
  domReadyMs?: number;
}

export interface PerformanceNavigationLike {
  responseStart?: number;
  requestStart?: number;
  loadEventEnd?: number;
  domContentLoadedEventEnd?: number;
  startTime?: number;
}

export interface PerformancePaintLike {
  name: string;
  startTime: number;
}

export interface PerformanceLcpLike {
  startTime: number;
}

export interface PerformanceLayoutShiftLike {
  startTime: number;
  value: number;
  hadRecentInput?: boolean;
}

export interface PerformanceEntriesInput {
  navigation?: PerformanceNavigationLike | null;
  paints?: PerformancePaintLike[];
  lcpEntries?: PerformanceLcpLike[];
  layoutShifts?: PerformanceLayoutShiftLike[];
}

export interface BrowserTimingResult {
  speed: ExternalSpeed;
  raw: BrowserTimingRawMetrics;
}

export interface BrowserTimingOptions {
  timeoutMs?: number;
  now?: () => Date;
  throttling?: typeof LAB_THROTTLING;
}

/**
 * Extracts raw timing metrics from navigation, paint, LCP, and layout-shift entries.
 * Accepts either structured entries object or a flat list of PerformanceEntry-like objects.
 */
export function extractTimingMetrics(input: PerformanceEntriesInput | readonly any[]): BrowserTimingRawMetrics {
  const metrics: BrowserTimingRawMetrics = {};

  if (Array.isArray(input)) {
    const shifts: Array<{ startTime: number; value: number }> = [];
    for (const entry of input) {
      if (!entry || typeof entry !== 'object') continue;
      const type = entry.entryType;
      if (type === 'navigation') {
        const respStart =
          typeof entry.responseStart === 'number' && entry.responseStart >= 0 ? entry.responseStart : undefined;
        if (respStart !== undefined) {
          metrics.ttfbMs = Math.round(respStart);
        }
        const loadEnd =
          typeof entry.loadEventEnd === 'number' && entry.loadEventEnd >= 0 ? entry.loadEventEnd : undefined;
        if (loadEnd !== undefined) {
          metrics.loadTimeMs = Math.round(loadEnd);
        }
        const domReady =
          typeof entry.domContentLoadedEventEnd === 'number' && entry.domContentLoadedEventEnd >= 0
            ? entry.domContentLoadedEventEnd
            : undefined;
        if (domReady !== undefined) {
          metrics.domReadyMs = Math.round(domReady);
        }
      } else if (type === 'paint') {
        if (entry.name === 'first-contentful-paint' && typeof entry.startTime === 'number' && entry.startTime >= 0) {
          metrics.fcpMs = Math.round(entry.startTime);
        }
      } else if (type === 'largest-contentful-paint') {
        if (typeof entry.startTime === 'number' && entry.startTime >= 0) {
          metrics.lcpMs = Math.round(entry.startTime);
        }
      } else if (type === 'layout-shift') {
        if (!entry.hadRecentInput && typeof entry.value === 'number' && typeof entry.startTime === 'number') {
          shifts.push({ startTime: entry.startTime, value: entry.value });
        }
      }
    }
    if (shifts.length > 0) {
      metrics.cls = Math.round(sessionWindowCls(shifts) * 1000) / 1000;
    }
    return metrics;
  }

  const structured = input as PerformanceEntriesInput;
  if (structured.navigation) {
    const nav = structured.navigation;
    if (typeof nav.responseStart === 'number' && nav.responseStart >= 0) {
      metrics.ttfbMs = Math.round(nav.responseStart);
    }
    if (typeof nav.loadEventEnd === 'number' && nav.loadEventEnd >= 0) {
      metrics.loadTimeMs = Math.round(nav.loadEventEnd);
    }
    if (typeof nav.domContentLoadedEventEnd === 'number' && nav.domContentLoadedEventEnd >= 0) {
      metrics.domReadyMs = Math.round(nav.domContentLoadedEventEnd);
    }
  }

  if (Array.isArray(structured.paints)) {
    const fcp = structured.paints.find((p) => p.name === 'first-contentful-paint');
    if (fcp && typeof fcp.startTime === 'number' && fcp.startTime >= 0) {
      metrics.fcpMs = Math.round(fcp.startTime);
    }
  }

  if (Array.isArray(structured.lcpEntries) && structured.lcpEntries.length > 0) {
    const last = structured.lcpEntries[structured.lcpEntries.length - 1];
    if (last && typeof last.startTime === 'number' && last.startTime >= 0) {
      metrics.lcpMs = Math.round(last.startTime);
    }
  }

  if (Array.isArray(structured.layoutShifts)) {
    const shifts = structured.layoutShifts
      .filter((s) => !s.hadRecentInput && typeof s.value === 'number' && typeof s.startTime === 'number')
      .map((s) => ({ startTime: s.startTime, value: s.value }));
    if (shifts.length > 0) {
      metrics.cls = Math.round(sessionWindowCls(shifts) * 1000) / 1000;
    }
  }

  return metrics;
}

/**
 * Shapes extracted raw timing metrics into the ExternalSpeed format.
 */
export function shapeBrowserTimingSpeed(
  metrics: BrowserTimingRawMetrics,
  now: () => Date = () => new Date()
): ExternalSpeed {
  const values: SpeedValue[] = [];

  if (metrics.lcpMs !== undefined && Number.isFinite(metrics.lcpMs)) {
    values.push({ metric: 'lcp', value: Math.round(metrics.lcpMs), unit: 'ms' });
  }
  if (metrics.cls !== undefined && Number.isFinite(metrics.cls)) {
    values.push({ metric: 'cls', value: Math.round(metrics.cls * 1000) / 1000, unit: 'none' });
  }
  if (metrics.fcpMs !== undefined && Number.isFinite(metrics.fcpMs)) {
    values.push({ metric: 'fcp', value: Math.round(metrics.fcpMs), unit: 'ms' });
  }
  if (metrics.ttfbMs !== undefined && Number.isFinite(metrics.ttfbMs)) {
    values.push({ metric: 'ttfb', value: Math.round(metrics.ttfbMs), unit: 'ms' });
  }

  if (values.length === 0) {
    return {
      status: 'not-measured',
      source: 'this-tool',
      method: 'lab',
      reason: 'failed',
    };
  }

  return {
    status: 'measured',
    source: 'this-tool',
    method: 'lab',
    strategy: 'mobile',
    values,
    measuredAt: now().toISOString(),
  };
}

/**
 * Convenience helper to extract and shape entries directly.
 */
export function createBrowserTimingSpeed(
  input: PerformanceEntriesInput | readonly any[],
  now: () => Date = () => new Date()
): ExternalSpeed {
  return shapeBrowserTimingSpeed(extractTimingMetrics(input), now);
}

const READ_BROWSER_TIMING = async (): Promise<PerformanceEntriesInput> => {
  const observe = (type: string) =>
    new Promise<any[]>((resolve) => {
      const entries: any[] = [];
      try {
        const po = new PerformanceObserver((list) => entries.push(...list.getEntries()));
        po.observe({ type, buffered: true } as PerformanceObserverInit);
        setTimeout(() => {
          entries.push(...po.takeRecords());
          po.disconnect();
          resolve(entries);
        }, 80);
      } catch {
        resolve([]);
      }
    });

  const [lcpEntries, shiftEntries, paintEntries] = await Promise.all([
    observe('largest-contentful-paint'),
    observe('layout-shift'),
    observe('paint'),
  ]);

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

  return {
    navigation: nav
      ? {
          responseStart: nav.responseStart,
          requestStart: nav.requestStart,
          loadEventEnd: nav.loadEventEnd,
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
          startTime: nav.startTime,
        }
      : null,
    paints: paintEntries.map((p: any) => ({ name: p.name, startTime: p.startTime })),
    lcpEntries: lcpEntries.map((l: any) => ({ startTime: l.startTime })),
    layoutShifts: shiftEntries
      .filter((s: any) => !s.hadRecentInput)
      .map((s: any) => ({ startTime: s.startTime, value: s.value })),
  };
};

/**
 * Measures an open page with one throttled reload under Chromium lab throttling.
 */
export async function measureBrowserTiming(page: Page, options?: BrowserTimingOptions): Promise<BrowserTimingResult> {
  const fallback = (reason: 'failed' | 'timeout' = 'failed'): BrowserTimingResult => ({
    speed: { status: 'not-measured', source: 'this-tool', method: 'lab', reason },
    raw: {},
  });

  if (!page || typeof page.url !== 'function' || typeof page.context !== 'function') {
    return fallback('failed');
  }

  const url = page.url();
  if (!/^https?:/i.test(url)) {
    return fallback('failed');
  }

  const throttling = options?.throttling ?? LAB_THROTTLING;
  let cdp: CDPSession | null = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: throttling.latencyMs,
      downloadThroughput: (throttling.downloadKbps * 1024) / 8,
      uploadThroughput: (throttling.uploadKbps * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttling.cpuSlowdown });
  } catch {
    // Non-Chromium or CDP unavailable: continue without throttling
  }

  try {
    const timeout = options?.timeoutMs ?? 30_000;
    try {
      await page.reload({ waitUntil: 'load', timeout });
      await page.waitForTimeout(400);
    } catch (reloadErr) {
      const isTimeout =
        reloadErr instanceof Error && (reloadErr.name === 'TimeoutError' || /timeout/i.test(reloadErr.message));
      return fallback(isTimeout ? 'timeout' : 'failed');
    }

    let inPageData: PerformanceEntriesInput | null = null;
    try {
      inPageData = await page.evaluate(READ_BROWSER_TIMING);
    } catch {
      return fallback('failed');
    }

    const raw = extractTimingMetrics(inPageData ?? {});
    const speed = shapeBrowserTimingSpeed(raw, options?.now);
    return { speed, raw };
  } finally {
    if (cdp) {
      try {
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
        await cdp.detach();
      } catch {
        // Ignore CDP cleanup errors
      }
    }
  }
}
