import type { Page } from 'playwright';
import type { Breakpoint, Finding, FindingSeverity, PageSpeedSample } from '@qa/types';

export interface PerformanceContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
  urlPath: string;
  /**
   * How many times to load the page in a throttled test browser to measure its vitals (the median
   * is reported, and 2 more loads are added when the first ones look slow). Left out, the vitals
   * are read once from the page as it already loaded, and are only indicative.
   */
  repeatLoads?: number;
  /**
   * Called with the page's speed number (LCP, else page-ready time) when it came from the
   * throttled repeat loads. Never called for a single un-slowed load. Does not change findings.
   */
  onSpeed?: (sample: PageSpeedSample) => void;
}

/** What the page's own performance observers reported. */
export interface RawPageMetrics {
  /** Start time of the last Largest Contentful Paint entry. Undefined when the browser reported none. */
  lcpMs?: number;
  /** Time the HTML finished loading and parsing. Never reported as LCP. */
  domReadyMs?: number;
  layoutShifts?: Array<{ startTime: number; value: number }>;
  /** Slowest interaction, from Event Timing entries. Undefined when none was slow enough to be reported. */
  inpMs?: number;
  totalWeightBytes: number;
  weightByOrigin?: Record<string, number>;
  slowestRequests: Array<{ url: string; durationMs: number }>;
  overflowElements: Array<{ tag: string; selector: string; right: number }>;
  hasHorizontalScroll: boolean;
  overlappingElements: Array<{ tag: string; selector: string; overlapsWith: string }>;
}

export interface PagePerformanceMetrics extends RawPageMetrics {
  /** Cumulative Layout Shift, as the worst 5-second session window of shifts. */
  cls?: number;
}

export const SPEED_THRESHOLDS = {
  LCP_GOOD_MS: 2500,
  LCP_POOR_MS: 4000,
  CLS_GOOD: 0.1,
  CLS_POOR: 0.25,
  INP_GOOD_MS: 200,
  INP_POOR_MS: 500,
  SLOW_REQUEST_MS: 2000,
  MAX_PAGE_WEIGHT_BYTES: 4 * 1024 * 1024, // 4MB
};

/** A mid-range phone on slow 4G, the profile Lighthouse and PageSpeed Insights use for mobile. */
export const LAB_THROTTLING = {
  latencyMs: 150,
  downloadKbps: 1600,
  uploadKbps: 750,
  cpuSlowdown: 4,
};

/** Id of `LAB_THROTTLING`, stored with each speed sample so a changed profile is never compared. */
export const LAB_PROFILE_ID = `lat${LAB_THROTTLING.latencyMs}-dl${LAB_THROTTLING.downloadKbps}-ul${LAB_THROTTLING.uploadKbps}-cpu${LAB_THROTTLING.cpuSlowdown}`;

const TEST_BROWSER_NOTE = 'Measured in a test browser, not by real visitors.';
const LAB_PROFILE_NOTE = 'a simulated mid-range phone on slow 4G';
const BASE_LOADS = 3;
const EXTRA_LOADS_WHEN_SLOW = 2;

/**
 * Cumulative Layout Shift as web.dev defines it: shifts less than 1s apart (and in a window no
 * longer than 5s) are added together, and the worst window is the score. Shifts right after a
 * person's input are expected and must be left out before calling this.
 */
export function sessionWindowCls(shifts: Array<{ startTime: number; value: number }>): number {
  let worst = 0;
  let windowValue = 0;
  let windowStart = 0;
  let lastShift = 0;
  for (const shift of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
    const startsNewWindow =
      windowValue === 0 || shift.startTime - lastShift >= 1000 || shift.startTime - windowStart >= 5000;
    if (startsNewWindow) {
      windowValue = shift.value;
      windowStart = shift.startTime;
    } else {
      windowValue += shift.value;
    }
    lastShift = shift.startTime;
    worst = Math.max(worst, windowValue);
  }
  return worst;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One load of the page: what the test browser saw. */
interface VitalsRun {
  lcpMs?: number;
  cls: number;
  inpMs?: number;
  domReadyMs?: number;
}

/** The vitals to report, and how steady the numbers were. */
interface VitalsSummary {
  loads: number;
  throttled: boolean;
  lcpMs?: number;
  cls?: number;
  inpMs?: number;
  domReadyMs?: number;
  measurements: Record<string, unknown>;
}

const round = (n: number, places = 0) => Math.round(n * 10 ** places) / 10 ** places;
const spread = (values: number[]) => (values.length > 1 ? Math.max(...values) - Math.min(...values) : 0);

export class PerformanceChecker {
  /**
   * Run speed, vitals, and mobile layout checks on the current page.
   */
  async checkPage(page: Page, context: PerformanceContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const metrics = await this.collectMetrics(page);
    const repeated = context.repeatLoads ? await this.measureVitals(page, context.repeatLoads) : null;
    const vitals: VitalsSummary | null =
      repeated ??
      (metrics
        ? {
            loads: 1,
            throttled: false,
            lcpMs: metrics.lcpMs,
            cls: metrics.cls,
            inpMs: metrics.inpMs,
            domReadyMs: metrics.domReadyMs,
            measurements: { loads: 1, throttled: false },
          }
        : null);
    if (repeated && context.onSpeed) {
      const speed = repeated.lcpMs ?? repeated.domReadyMs;
      if (speed !== undefined && speed > 0) {
        context.onSpeed({
          metric: repeated.lcpMs !== undefined ? 'lcp' : 'domReady',
          ms: Math.round(speed),
          loads: repeated.loads,
          throttled: repeated.throttled,
          profile: LAB_PROFILE_ID,
        });
      }
    }
    const basis = vitals?.throttled
      ? `median of ${vitals.loads} loads on ${LAB_PROFILE_NOTE}`
      : 'one load in a test browser, not slowed down';
    const where = { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint };
    const base = { testCaseId: context.testCaseId, flowId: context.flowId, checker: 'performance' as const };
    const idPrefix = `F-PERF-${context.testCaseId || 'GEN'}`;

    // 1. Largest Contentful Paint (LCP). Only the browser's own LCP entry counts as LCP.
    if (vitals?.lcpMs !== undefined && vitals.lcpMs > SPEED_THRESHOLDS.LCP_GOOD_MS) {
      const isPoor = vitals.lcpMs >= SPEED_THRESHOLDS.LCP_POOR_MS;
      const severity: FindingSeverity = isPoor ? 'Major' : 'Minor';
      findings.push({
        id: `${idPrefix}-LCP-${findings.length + 1}`,
        ...base,
        severity,
        title: `Slow Largest Contentful Paint (${(vitals.lcpMs / 1000).toFixed(1)}s)`,
        where,
        expectedVsActual: {
          expected: `Largest Contentful Paint should be under ${(SPEED_THRESHOLDS.LCP_GOOD_MS / 1000).toFixed(1)}s (${TEST_BROWSER_NOTE})`,
          actual: `Measured ${(vitals.lcpMs / 1000).toFixed(1)}s to render the largest visible element (${basis}). ${TEST_BROWSER_NOTE}`,
        },
        stepsToReproduce: [
          `Visit ${context.urlPath} at screen width ${context.breakpoint}`,
          'Measure page render timing',
        ],
        evidence: { measurements: vitals.measurements },
        resolution: 'Optimize server response time, defer heavy non-critical scripts, and compress hero images.',
      });
    } else if (
      vitals?.lcpMs === undefined &&
      vitals?.domReadyMs !== undefined &&
      vitals.domReadyMs > SPEED_THRESHOLDS.LCP_GOOD_MS
    ) {
      // The browser reported no LCP, so say what was measured: how long the HTML took to be ready.
      findings.push({
        id: `${idPrefix}-LOAD-${findings.length + 1}`,
        ...base,
        severity: 'Minor',
        title: `Slow initial page load (page ready after ${(vitals.domReadyMs / 1000).toFixed(1)}s)`,
        where,
        expectedVsActual: {
          expected: `The page's HTML should be loaded and parsed within ${(SPEED_THRESHOLDS.LCP_GOOD_MS / 1000).toFixed(1)}s (${TEST_BROWSER_NOTE})`,
          actual: `The page was ready after ${(vitals.domReadyMs / 1000).toFixed(1)}s (${basis}). The browser reported no Largest Contentful Paint for it, so that number was not measured.`,
        },
        stepsToReproduce: [
          `Visit ${context.urlPath} at screen width ${context.breakpoint}`,
          'Measure page load timing',
        ],
        evidence: { measurements: vitals.measurements },
        resolution: 'Optimize server response time and defer heavy non-critical scripts.',
      });
    }

    // 2. Cumulative Layout Shift (CLS)
    if (vitals?.cls !== undefined && vitals.cls > SPEED_THRESHOLDS.CLS_GOOD) {
      const isPoor = vitals.cls >= SPEED_THRESHOLDS.CLS_POOR;
      const severity: FindingSeverity = isPoor ? 'Major' : 'Minor';
      findings.push({
        id: `${idPrefix}-CLS-${findings.length + 1}`,
        ...base,
        severity,
        title: `Cumulative Layout Shift of ${vitals.cls.toFixed(2)} causes visible jumping`,
        where,
        expectedVsActual: {
          expected: `Cumulative Layout Shift should be under ${SPEED_THRESHOLDS.CLS_GOOD} (${TEST_BROWSER_NOTE})`,
          actual: `Measured CLS of ${vitals.cls.toFixed(2)} during page visit (${basis}). ${TEST_BROWSER_NOTE}`,
        },
        stepsToReproduce: [
          `Open ${context.urlPath} at ${context.breakpoint}`,
          'Observe content shifting during loading',
        ],
        evidence: { measurements: vitals.measurements },
        resolution: 'Set explicit width and height dimensions on images and banners to reserve space before loading.',
      });
    }

    // 3. Interaction to Next Paint (INP): how long the page took to respond to a click or key press.
    if (vitals?.inpMs !== undefined && vitals.inpMs > SPEED_THRESHOLDS.INP_GOOD_MS) {
      const isPoor = vitals.inpMs >= SPEED_THRESHOLDS.INP_POOR_MS;
      findings.push({
        id: `${idPrefix}-INP-${findings.length + 1}`,
        ...base,
        severity: isPoor ? 'Major' : 'Minor',
        title: `Slow response to clicks and key presses (${Math.round(vitals.inpMs)}ms)`,
        where,
        expectedVsActual: {
          expected: `The page should react to an interaction within ${SPEED_THRESHOLDS.INP_GOOD_MS}ms (${TEST_BROWSER_NOTE})`,
          actual: `The slowest interaction took ${Math.round(vitals.inpMs)}ms to show a result (${basis}). It covers the interactions the test performed, not every one a visitor might.`,
        },
        stepsToReproduce: [
          `Open ${context.urlPath} at ${context.breakpoint}`,
          'Click a menu button or press Tab and watch how long the page takes to react',
        ],
        evidence: { measurements: vitals.measurements },
        resolution:
          'Break up long JavaScript tasks, defer work that is not needed to show the next screen, and avoid heavy re-renders on click.',
      });
    }

    // 3b. Page weight
    if (metrics && metrics.totalWeightBytes > SPEED_THRESHOLDS.MAX_PAGE_WEIGHT_BYTES) {
      const weight = weightBreakdown(metrics, page.url());
      findings.push({
        id: `${idPrefix}-WEIGHT-${findings.length + 1}`,
        ...base,
        severity: 'Minor',
        title: `Heavy page: ${formatMb(metrics.totalWeightBytes)} downloaded`,
        where,
        expectedVsActual: {
          expected: `A page should download less than ${formatMb(SPEED_THRESHOLDS.MAX_PAGE_WEIGHT_BYTES)}`,
          actual: `At least ${formatMb(metrics.totalWeightBytes)} was downloaded: ${formatMb(weight.firstPartyBytes)} from this site and ${formatMb(weight.thirdPartyBytes)} from other sites. Files from other sites that hide their size are not counted.`,
        },
        stepsToReproduce: [
          `Open ${context.urlPath} with the browser's network panel open`,
          'Add up the transferred size',
        ],
        evidence: { measurements: { weight } },
        resolution: 'Compress and resize images, drop unused scripts and fonts, and lazy-load what is below the fold.',
      });
    }

    // 4. Slow network requests (> 2s)
    if (metrics?.slowestRequests && metrics.slowestRequests.length > 0) {
      for (const req of metrics.slowestRequests) {
        if (req.durationMs >= SPEED_THRESHOLDS.SLOW_REQUEST_MS) {
          findings.push({
            id: `F-PERF-${context.testCaseId || 'GEN'}-SLOWREQ-${findings.length + 1}`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Minor',
            checker: 'performance',
            title: `Slow request: ${truncateUrl(req.url)} took ${(req.durationMs / 1000).toFixed(1)}s`,
            where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
            expectedVsActual: {
              expected: `Asset requests should complete in under ${(SPEED_THRESHOLDS.SLOW_REQUEST_MS / 1000).toFixed(1)}s (${TEST_BROWSER_NOTE})`,
              actual: `Request to ${req.url} took ${(req.durationMs / 1000).toFixed(1)}s`,
            },
            stepsToReproduce: [`Visit ${context.urlPath}`, `Inspect network waterfall for ${req.url}`],
            evidence: {},
            resolution: 'Enable compression (gzip/brotli), optimize query performance, or use edge caching.',
          });
          break; // Flag the most severe one per page
        }
      }
    }

    // 5. Mobile viewport horizontal overflow (especially 375px)
    if (metrics?.hasHorizontalScroll || (metrics?.overflowElements && metrics.overflowElements.length > 0)) {
      const target = metrics.overflowElements[0]?.selector || 'body';
      findings.push({
        id: `F-PERF-${context.testCaseId || 'GEN'}-OVERFLOW-${findings.length + 1}`,
        testCaseId: context.testCaseId,
        flowId: context.flowId,
        severity: context.breakpoint === '375px' ? 'Major' : 'Minor',
        checker: 'performance',
        title: `Content overflows the screen horizontally at ${context.breakpoint}`,
        where: {
          urlPath: context.urlPath,
          role: context.role,
          breakpoint: context.breakpoint,
          cssSelector: target,
        },
        expectedVsActual: {
          expected: `Page content fits within the ${context.breakpoint} viewport without horizontal scroll`,
          actual: `Content exceeds viewport width, forcing the user to scroll sideways`,
        },
        stepsToReproduce: [
          `Open ${context.urlPath} with viewport width set to ${context.breakpoint}`,
          `Notice horizontal scrollbar and overflowing element: ${target}`,
        ],
        evidence: {},
        resolution:
          'Ensure all containers use max-width: 100% or overflow: hidden, and avoid fixed pixel widths wider than 375px.',
      });
    }

    // 6. Overlapping interactive elements
    if (metrics?.overlappingElements && metrics.overlappingElements.length > 0) {
      const overlap = metrics.overlappingElements[0];
      findings.push({
        id: `F-PERF-${context.testCaseId || 'GEN'}-OVERLAP-${findings.length + 1}`,
        testCaseId: context.testCaseId,
        flowId: context.flowId,
        severity: 'Major',
        checker: 'performance',
        title: `Interactive elements overlap: ${overlap.selector} covers ${overlap.overlapsWith}`,
        where: {
          urlPath: context.urlPath,
          role: context.role,
          breakpoint: context.breakpoint,
          cssSelector: overlap.selector,
        },
        expectedVsActual: {
          expected: 'Interactive elements must have distinct bounding boxes without colliding',
          actual: `Element ${overlap.selector} overlaps with ${overlap.overlapsWith} at ${context.breakpoint}`,
        },
        stepsToReproduce: [
          `View ${context.urlPath} at ${context.breakpoint}`,
          `Inspect ${overlap.selector} and ${overlap.overlapsWith}`,
        ],
        evidence: {},
        resolution:
          'Adjust CSS margins, z-index, or flex/grid stacking order so interactive controls do not cover each other.',
      });
    }

    return findings;
  }

  /** Reads the observers' entries the page already collected, plus its layout and weight. */
  private async collectMetrics(page: Page): Promise<PagePerformanceMetrics | null> {
    try {
      const raw: RawPageMetrics = await page.evaluate(READ_PAGE_METRICS);
      return { ...raw, cls: round(sessionWindowCls(raw.layoutShifts ?? []), 2) };
    } catch {
      return null;
    }
  }

  /**
   * Loads the page several times in a separate tab, slowed to a mid-range phone on slow 4G, and
   * reports the median of each vital. The tab shares the page's browser context (so a signed-in
   * page stays signed in) but the page under test is never touched.
   */
  async measureVitals(page: Page, loads: number): Promise<VitalsSummary | null> {
    const url = page.url();
    if (!/^https?:/i.test(url)) return null;
    let probe: Page | undefined;
    try {
      probe = await page.context().newPage();
      let throttled = false;
      try {
        const cdp = await page.context().newCDPSession(probe);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: LAB_THROTTLING.latencyMs,
          downloadThroughput: (LAB_THROTTLING.downloadKbps * 1024) / 8,
          uploadThroughput: (LAB_THROTTLING.uploadKbps * 1024) / 8,
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: LAB_THROTTLING.cpuSlowdown });
        throttled = true;
      } catch {
        // Only Chromium can be slowed down this way: the numbers still come, labelled as not slowed.
      }

      const runs: VitalsRun[] = [];
      const loadOnce = async () => {
        try {
          await probe!.goto(url, { waitUntil: 'load', timeout: 45000 });
          await probe!.waitForTimeout(600);
          await interactSafely(probe!);
          await probe!.waitForTimeout(300);
          const raw: RawPageMetrics = await probe!.evaluate(READ_PAGE_METRICS);
          runs.push({
            lcpMs: raw.lcpMs,
            cls: sessionWindowCls(raw.layoutShifts ?? []),
            inpMs: raw.inpMs,
            domReadyMs: raw.domReadyMs,
          });
        } catch {
          // A load that failed or timed out is left out; the others still count.
        }
      };

      for (let i = 0; i < Math.max(1, loads); i++) await loadOnce();
      // Three loads are enough for a page that is fine. A slow one gets two more, so one lucky or
      // unlucky load does not decide the verdict.
      const looksSlow = () => {
        const lcp = median(runs.flatMap((r) => (r.lcpMs === undefined ? [] : [r.lcpMs])));
        const cls = median(runs.map((r) => r.cls));
        const inp = median(runs.flatMap((r) => (r.inpMs === undefined ? [] : [r.inpMs])));
        return (
          (lcp ?? 0) > SPEED_THRESHOLDS.LCP_GOOD_MS ||
          (cls ?? 0) > SPEED_THRESHOLDS.CLS_GOOD ||
          (inp ?? 0) > SPEED_THRESHOLDS.INP_GOOD_MS
        );
      };
      if (runs.length > 0 && loads <= BASE_LOADS && looksSlow()) {
        for (let i = 0; i < EXTRA_LOADS_WHEN_SLOW; i++) await loadOnce();
      }
      if (runs.length === 0) return null;

      const lcps = runs.flatMap((r) => (r.lcpMs === undefined ? [] : [r.lcpMs]));
      const clss = runs.map((r) => r.cls);
      const inps = runs.flatMap((r) => (r.inpMs === undefined ? [] : [r.inpMs]));
      const domReady = runs.flatMap((r) => (r.domReadyMs === undefined ? [] : [r.domReadyMs]));
      const lcpMs = median(lcps);
      const cls = median(clss);
      const inpMs = median(inps);
      return {
        loads: runs.length,
        throttled,
        lcpMs,
        cls: cls === undefined ? undefined : round(cls, 2),
        inpMs,
        domReadyMs: median(domReady),
        measurements: {
          loads: runs.length,
          throttled,
          profile: throttled ? LAB_THROTTLING : undefined,
          lcpMsRuns: lcps.map((v) => round(v)),
          lcpMsMedian: lcpMs === undefined ? undefined : round(lcpMs),
          lcpSpreadMs: round(spread(lcps)),
          clsRuns: clss.map((v) => round(v, 3)),
          clsSpread: round(spread(clss), 3),
          inpMsRuns: inps.map((v) => round(v)),
          inpMsMedian: inpMs === undefined ? undefined : round(inpMs),
        },
      };
    } catch {
      return null;
    } finally {
      await probe?.close().catch(() => {});
    }
  }
}

/**
 * Runs inside the page. Entries for LCP, layout shifts and interactions are only available
 * through observers (the performance timeline does not list them), so each is read through a
 * buffered observer that is given a moment to hand over what the page already collected.
 */
const READ_PAGE_METRICS = async (): Promise<RawPageMetrics> => {
  const observe = (type: string, extra: Record<string, unknown> = {}) =>
    new Promise<any[]>((resolve) => {
      const entries: any[] = [];
      try {
        const po = new PerformanceObserver((list) => entries.push(...list.getEntries()));
        po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
        setTimeout(() => {
          entries.push(...po.takeRecords());
          po.disconnect();
          resolve(entries);
        }, 60);
      } catch {
        resolve([]);
      }
    });
  const [lcpEntries, shiftEntries, eventEntries] = await Promise.all([
    observe('largest-contentful-paint'),
    observe('layout-shift'),
    observe('event', { durationThreshold: 16 }),
  ]);

  const docWidth = document.documentElement.clientWidth || window.innerWidth;
  const scrollWidth = document.documentElement.scrollWidth;
  const hasHorizontalScroll = scrollWidth > docWidth + 5;

  // Resource timing
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  let totalWeight = 0;
  const weightByOrigin: Record<string, number> = {};
  const slowest: Array<{ url: string; durationMs: number }> = [];
  for (const r of resources) {
    const size = r.transferSize || (r.encodedBodySize ?? 0);
    totalWeight += size;
    try {
      const origin = new URL(r.name).origin;
      weightByOrigin[origin] = (weightByOrigin[origin] ?? 0) + size;
    } catch {
      // not a URL
    }
    if (r.duration > 1500) {
      slowest.push({ url: r.name, durationMs: Math.round(r.duration) });
    }
  }
  slowest.sort((a, b) => b.durationMs - a.durationMs);

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const domReadyMs = nav && nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : undefined;
  const lcpMs = lcpEntries.length > 0 ? Math.round(lcpEntries[lcpEntries.length - 1].startTime) : undefined;

  // Shifts right after a person's input are expected, and do not count.
  const layoutShifts = shiftEntries
    .filter((s) => !s.hadRecentInput)
    .map((s) => ({ startTime: s.startTime as number, value: s.value as number }));

  // The slowest interaction (an interaction can have several events: the longest one counts).
  const byInteraction = new Map<number, number>();
  for (const e of eventEntries) {
    if (!e.interactionId) continue;
    byInteraction.set(e.interactionId, Math.max(byInteraction.get(e.interactionId) ?? 0, e.duration));
  }
  const inpMs = byInteraction.size > 0 ? Math.max(...byInteraction.values()) : undefined;

  // Overflow elements
  const overflowElements: Array<{ tag: string; selector: string; right: number }> = [];
  const all = document.querySelectorAll('body *');
  for (let i = 0; i < Math.min(all.length, 300); i++) {
    const el = all[i] as HTMLElement;
    if (typeof el.getBoundingClientRect !== 'function') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > docWidth + 10) {
      const selector = el.getAttribute('data-testid')
        ? `[data-testid="${el.getAttribute('data-testid')}"]`
        : el.id
          ? `#${el.id}`
          : el.tagName.toLowerCase();
      overflowElements.push({ tag: el.tagName.toLowerCase(), selector, right: Math.round(r.right) });
      if (overflowElements.length >= 2) break;
    }
  }

  // Overlapping interactives
  const overlappingElements: Array<{ tag: string; selector: string; overlapsWith: string }> = [];
  const interactives = Array.from(document.querySelectorAll('button, a, input, select, textarea')).filter(
    (el): el is HTMLElement => {
      if (typeof el.getBoundingClientRect !== 'function') return false;
      if (el.classList.contains('sr-only') || el.closest('.sr-only')) return false;
      if (el.closest('details:not([open])')) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (
        typeof el.checkVisibility === 'function' &&
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      )
        return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
  );

  for (let i = 0; i < Math.min(interactives.length, 30); i++) {
    const a = interactives[i];
    const rA = a.getBoundingClientRect();
    for (let j = i + 1; j < Math.min(interactives.length, 30); j++) {
      const b = interactives[j];
      if (a.contains(b) || b.contains(a)) continue;
      const rB = b.getBoundingClientRect();
      const overlap = !(rA.right <= rB.left || rA.left >= rB.right || rA.bottom <= rB.top || rA.top >= rB.bottom);
      if (overlap) {
        const area =
          (Math.min(rA.right, rB.right) - Math.max(rA.left, rB.left)) *
          (Math.min(rA.bottom, rB.bottom) - Math.max(rA.top, rB.top));
        if (area > 80) {
          // Verify that at least one of the elements is actually hit-tested at the overlap center
          const midX = (Math.max(rA.left, rB.left) + Math.min(rA.right, rB.right)) / 2;
          const midY = (Math.max(rA.top, rB.top) + Math.min(rA.bottom, rB.bottom)) / 2;
          const topEl = document.elementFromPoint(midX, midY);
          if (!topEl || (!a.contains(topEl) && !b.contains(topEl))) {
            // Both elements are clipped by an overflow container or hidden behind another layer
            continue;
          }

          const selA = a.getAttribute('data-testid')
            ? `[data-testid="${a.getAttribute('data-testid')}"]`
            : a.tagName.toLowerCase();
          const selB = b.getAttribute('data-testid')
            ? `[data-testid="${b.getAttribute('data-testid')}"]`
            : b.tagName.toLowerCase();
          overlappingElements.push({ tag: a.tagName.toLowerCase(), selector: selA, overlapsWith: selB });
          break;
        }
      }
    }
    if (overlappingElements.length >= 2) break;
  }

  return {
    lcpMs,
    domReadyMs,
    layoutShifts,
    inpMs,
    totalWeightBytes: totalWeight,
    weightByOrigin,
    slowestRequests: slowest.slice(0, 5),
    overflowElements,
    hasHorizontalScroll,
    overlappingElements,
  };
};

/**
 * A standard interaction for the response-time measurement: a key press, then a click on a
 * control that only opens or closes something (a menu or accordion button), else on the page
 * itself. It never clicks a link or a button that could send or delete anything.
 */
async function interactSafely(page: Page): Promise<void> {
  try {
    await page.keyboard.press('Tab');
    const toggle = page
      .locator('summary, button[aria-expanded], button[aria-controls], [role="tab"], [role="button"][aria-expanded]')
      .filter({ visible: true })
      .first();
    if ((await toggle.count()) > 0) {
      await toggle.click({ timeout: 2000 });
    } else {
      await page.mouse.click(2, 2);
    }
  } catch {
    // Nothing safe to interact with: no response time is reported for this load.
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Splits what was downloaded into this site's own files and everyone else's. */
function weightBreakdown(metrics: PagePerformanceMetrics, pageUrl: string) {
  let pageOrigin = '';
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    // keep empty: everything counts as another site's
  }
  let firstPartyBytes = 0;
  const others: Array<{ origin: string; bytes: number }> = [];
  for (const [origin, bytes] of Object.entries(metrics.weightByOrigin ?? {})) {
    if (origin === pageOrigin) firstPartyBytes += bytes;
    else others.push({ origin, bytes });
  }
  others.sort((a, b) => b.bytes - a.bytes);
  return {
    firstPartyBytes,
    thirdPartyBytes: others.reduce((n, o) => n + o.bytes, 0),
    heaviestThirdParties: others.slice(0, 5),
  };
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.length > 30 ? u.pathname.slice(0, 27) + '...' : u.pathname;
  } catch {
    return url.length > 30 ? url.slice(0, 27) + '...' : url;
  }
}
