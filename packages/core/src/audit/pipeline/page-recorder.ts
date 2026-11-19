/**
 * Stage 1 of the audit pipeline, run inside the crawl (REQ-005, REQ-037, REQ-038): each recorded page is read
 * once while it is still open (`runAuditCrawl`'s `onRenderedPage`). Every page gets its Page Content
 * (`readPage`) and lab work (every page, ADR 0047): the accessibility basics, the speed timing and then the phone
 * layout (last, as it resizes the page).
 *
 * Lab work runs off the crawl workers (T-404): when the crawl offers `openPage` and `defer`, each page's
 * lab work is queued and done on a page of its own, at most `labInFlight` at once, while the crawl worker goes on
 * to its next page. The crawl waits for the queue only before it closes its browser. Without them (older
 * callers, tests), lab work runs on the crawl's page as before.
 *
 * One lab load per page at most (T-430), so a page costs the site 2 page starts, or 1 when PSI measures it:
 *  - a page PSI does not measure gets one load on a lab page, from a cold cache under the lab profile: that load
 *    is its timing, and axe and the phone layout then run on the same page;
 *  - a page PSI measures (`pageSpeed`, the first 20) gets axe and the phone layout on the crawl's own page before
 *    the worker moves on, and PSI is asked off the worker; only a page PSI could not measure gets the timing load.
 *
 * Sample Pages are decided as pages arrive, with the Check-up's Layout Group rule (`GroupTracker`): a page with
 * a fixed address and the first three members of a templated group are Sample Pages; later members are covered
 * by their group's first Sample Page (DEC-006). A step that throws is recorded as not done for that page; the
 * hook itself never throws, so the crawl goes on.
 */
import type { Page } from 'playwright';
import type { PageSpeed } from '@qa/types';
import { createFindingIdAllocator, type FindingIdAllocator } from '../analysis/finding-ids.js';
import { readPage, type ReadPageResult } from '../analysis/read-page.js';
import { accessibilityBasics, type AccessibilityBasicsResult } from '../analysis/accessibility-basics.js';
import { recordPhoneLayout, type PhoneLayoutRecord } from '../phone-layout.js';
import { recordDesktopShot } from './desktop-shot.js';
import { measureBrowserTiming, withLabProfile, type BrowserTimingResult } from '../speed/browser-timing.js';
import { PSI_MAX_PAGES, type SampleSpeed } from '../ai/pagespeed.js';
import type { AuditCrawlPage, RenderedPageContext } from '../crawl/crawl.js';
import { GroupTracker } from '../../plan/sampling.js';
import { isLocalOriginHost } from '../../safe-net.js';

/** The page-level stage functions; the defaults are the real modules. Tests pass fakes. */
export interface PageStages {
  readPage: typeof readPage;
  accessibilityBasics: typeof accessibilityBasics;
  recordPhoneLayout: typeof recordPhoneLayout;
  measureBrowserTiming: typeof measureBrowserTiming;
}

export const DEFAULT_PAGE_STAGES: PageStages = {
  readPage,
  accessibilityBasics,
  recordPhoneLayout,
  measureBrowserTiming,
};

/** Lab pages open at once when the crawl does not say (T-404: 2 on the hosted copy, 4 locally). */
export const DEFAULT_LAB_IN_FLIGHT = 2;
/** One lab page load's limit: the crawl's own (AUDIT_PAGE_TIMEOUT_MS). */
const LAB_LOAD_TIMEOUT_MS = 30_000;
/** The wait after the lab load for its late paints, as the timing reload had. */
const TIMING_SETTLE_MS = 400;

export interface PageRecorderOptions {
  /** Local working folder of the version: phone screenshots are written under it, then saved to the store. */
  workDir: string;
  stages?: Partial<PageStages>;
  /**
   * PageSpeed Insights for one page, when a PSI key is available (T-404). The first `maxPages` pages
   * (default 20) on a public host are measured here and get no browser timing reload, unless PSI fails.
   */
  pageSpeed?: { measure: (url: string) => Promise<SampleSpeed | undefined>; maxPages?: number };
}

/** One recorded page as the pipeline keeps it. */
export interface RecordedPage {
  info: AuditCrawlPage;
  /** Null when the page could not be read. */
  read: ReadPageResult | null;
  coverage: 'sample' | 'covered';
  /** A covered page's Sample Page. */
  sampleUrlPath?: string;
  /** The tracker's group key while the crawl runs; final ids come from `layoutGroups()`. */
  groupKey?: string;
  /** Every page (ADR 0047). Null when the step threw. */
  accessibility?: AccessibilityBasicsResult | null;
  /** Every page (ADR 0047). Null when the step threw. */
  phone?: PhoneLayoutRecord | null;
  /** Sample Pages (T-431): the 1440 px screenshot taken on the open page; null when it could not be taken. */
  desktopShot?: string | null;
  /** Every page (ADR 0047). Lab speed measured by this tool directly in the browser (ADR 0042). Null when the step threw. */
  timing?: BrowserTimingResult | null;
  /** Set when PageSpeed Insights was asked for this page during the crawl (T-404); `psi` holds its answer. */
  psiTried?: boolean;
  psi?: PageSpeed | null;
  /** The lab work ran to its end (T-407): a checkpoint keeps only such pages; the others are loaded again. */
  labDone?: boolean;
}

/** A Retry-After header in ms (seconds or an HTTP date); undefined when absent or unreadable. */
function retryAfterMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/** A tiny pool: at most `limit` jobs at once, in the order queued. */
class LabQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run(job: () => Promise<void>): Promise<void> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export class AuditPageRecorder {
  private readonly stages: PageStages;
  private readonly workDir: string;
  private readonly tracker = new GroupTracker();
  private readonly recorded: RecordedPage[] = [];
  private readonly byPath = new Set<string>();
  /** Accessibility ids are scratch ids: the analysis renumbers them. */
  private a11yIds: FindingIdAllocator = createFindingIdAllocator();
  /** Each page's read and lab work, by path: settled once the page's work has ended (T-407). */
  private readonly settledByPath = new Map<string, Promise<void>>();
  private sampleCount = 0;
  private readonly pageSpeed?: PageRecorderOptions['pageSpeed'];
  private psiLeft: number;
  private lab?: LabQueue;
  private readonly labJobs: Promise<void>[] = [];

  constructor(opts: PageRecorderOptions) {
    this.workDir = opts.workDir;
    this.stages = { ...DEFAULT_PAGE_STAGES, ...(opts.stages ?? {}) };
    this.pageSpeed = opts.pageSpeed;
    this.psiLeft = opts.pageSpeed ? Math.max(0, opts.pageSpeed.maxPages ?? PSI_MAX_PAGES) : 0;
  }

  /** Pass as `runAuditCrawl(request, { onRenderedPage: recorder.onRenderedPage })`. Never throws. */
  readonly onRenderedPage = async (page: Page, info: AuditCrawlPage, context?: RenderedPageContext): Promise<void> => {
    // A path recorded twice is the same page: the first wins (as in the analysis).
    if (this.byPath.has(info.urlPath)) return;
    this.byPath.add(info.urlPath);
    let settle!: () => void;
    this.settledByPath.set(info.urlPath, new Promise<void>((resolve) => (settle = resolve)));
    let deferred: Promise<void> | undefined;
    try {
      deferred = (await this.record(page, info, context)).deferred;
    } finally {
      if (deferred) void deferred.then(settle, settle);
      else settle();
    }
  };

  /** Reads the page and runs or queues its lab work; hands back the queued lab job, if any, without awaiting it. */
  private async record(
    page: Page,
    info: AuditCrawlPage,
    context?: RenderedPageContext
  ): Promise<{ deferred?: Promise<void> }> {
    const arrival = this.tracker.add({
      urlPath: info.urlPath,
      title: info.title,
      interactiveElementsCount: 0,
      formsCount: 0,
      ...(info.layoutGroup ? { layoutGroup: info.layoutGroup } : {}),
    });
    const entry: RecordedPage = {
      info,
      read: null,
      coverage: arrival.coverage === 'covered' ? 'covered' : 'sample',
      ...(arrival.layoutGroup ? { groupKey: arrival.layoutGroup } : {}),
      ...(arrival.coverage === 'covered' && arrival.coveredBy?.[0] ? { sampleUrlPath: arrival.coveredBy[0] } : {}),
    };
    this.recorded.push(entry);

    try {
      entry.read = await this.stages.readPage(
        page,
        context?.responseHeaders ? { responseHeaders: context.responseHeaders } : {}
      );
    } catch {
      entry.read = null;
    }

    const n = ++this.sampleCount;
    let url: string | undefined;
    try {
      url = page.url();
    } catch {
      url = undefined;
    }
    const usePsi = this.claimPsi(url);

    // Off the crawl worker (T-404), with one load of the site per page at most (T-430).
    const openPage = context?.openPage;
    if (openPage && context?.defer && url) {
      const pageUrl = url;
      this.lab ??= new LabQueue(Math.max(1, context.labInFlight ?? DEFAULT_LAB_IN_FLIGHT));
      const lab = this.lab;
      let job: Promise<void>;
      if (usePsi) {
        // PSI measures on Google's side, so the crawl's own page is checked now and the site is not loaded again.
        // Only a page PSI could not measure gets the timing load, on a page of its own.
        await this.checkOpenPage(page, entry, n);
        job = lab.run(async () => {
          if (context.signal?.aborted) return;
          if (await this.askPsi(entry, pageUrl)) {
            entry.labDone = true;
            return;
          }
          const lab = await this.loadForLab(openPage, pageUrl, context);
          if (!lab) {
            entry.timing = null;
            if (!context.signal?.aborted) entry.labDone = true;
            return;
          }
          try {
            entry.timing = await this.readTiming(lab);
            entry.labDone = true;
          } finally {
            await lab.page.close().catch(() => {});
          }
        });
      } else {
        // The lab's one load is the cold, throttled timing load; axe and the phone layout then run on that page.
        job = lab.run(async () => {
          if (context.signal?.aborted) return;
          const lab = await this.loadForLab(openPage, pageUrl, context);
          if (!lab) {
            entry.accessibility = null;
            entry.phone = null;
            entry.timing = null;
            // Not checked after a stop: a resume loads the page again. Otherwise the failure is the result.
            if (!context.signal?.aborted) entry.labDone = true;
            return;
          }
          try {
            entry.timing = await this.readTiming(lab);
            await this.checkOpenPage(lab.page, entry, n);
            entry.labDone = true;
          } finally {
            await lab.page.close().catch(() => {});
          }
        });
      }
      this.labJobs.push(job);
      context.defer(job);
      return { deferred: job };
    }

    await this.labWork(page, entry, n, usePsi, url, context);
    return {};
  }

  /** Resolves once the read and lab work of each of these paths has ended (T-407); unknown paths count as ended. */
  async settled(urlPaths: readonly string[]): Promise<void> {
    await Promise.all(urlPaths.map((p) => this.settledByPath.get(p)));
  }

  /**
   * Pages a checkpoint saved (T-407), in crawl order, before the resumed crawl records more. They keep their
   * reads, lab results and coverage; the Layout Group tracker, the PSI allowance and the scratch accessibility
   * ids carry on after them.
   */
  restore(pages: readonly RecordedPage[]): void {
    let lastId = 0;
    for (const entry of pages) {
      const { info } = entry;
      if (this.byPath.has(info.urlPath)) continue;
      this.byPath.add(info.urlPath);
      this.tracker.add({
        urlPath: info.urlPath,
        title: info.title,
        interactiveElementsCount: 0,
        formsCount: 0,
        ...(info.layoutGroup ? { layoutGroup: info.layoutGroup } : {}),
      });
      this.recorded.push(entry);
      this.sampleCount++;
      if (entry.psiTried && this.psiLeft > 0) this.psiLeft--;
      for (const f of entry.accessibility?.findings ?? []) {
        const n = Number(/^AF-(\d+)$/.exec(f.id)?.[1] ?? 0);
        if (n > lastId) lastId = n;
      }
    }
    if (lastId >= this.a11yIds.nextNumber) this.a11yIds = createFindingIdAllocator(lastId + 1);
  }

  /** Resolves once every queued lab job has ended (the crawl awaits this through `defer`). */
  async drain(): Promise<void> {
    await Promise.all(this.labJobs);
  }

  /**
   * The lab's one load of a page (T-430): a fresh page, loaded from a cold cache under the lab profile in the host's
   * turn. Null, and the page closed, when the page did not answer: only the page the crawl recorded is checked, so
   * a busy answer, an error page or a load that left the address is not scanned in its place. A 429 or 503 slows
   * the host down, as in the crawl (ADR 0043). A page that answered but did not finish loading in time is still
   * checked; only its timing is lost (`loaded: false`), as when the timing reload timed out.
   */
  private async loadForLab(
    openPage: () => Promise<Page>,
    pageUrl: string,
    context: RenderedPageContext
  ): Promise<{ page: Page; loaded: boolean } | null> {
    let labPage: Page | undefined;
    try {
      labPage = await openPage();
      const open = labPage;
      const host = new URL(pageUrl).host;
      const load = () =>
        withLabProfile(open, async () => {
          const response = await open.goto(pageUrl, { waitUntil: 'commit', timeout: LAB_LOAD_TIMEOUT_MS });
          let loaded = true;
          if (typeof open.waitForLoadState === 'function') {
            loaded = await open
              .waitForLoadState('load', { timeout: LAB_LOAD_TIMEOUT_MS })
              .then(() => true)
              .catch(() => false);
          }
          return { response, loaded };
        });
      const { response, loaded } = await context.pacer.run(host, load, context.signal);
      const status = response?.status();
      if (status === 429 || status === 503) {
        context.pacer.slowDown(host, retryAfterMs(response?.headers()['retry-after']));
      }
      if (!response || status === undefined || status >= 400 || new URL(open.url()).host !== host) {
        throw new Error('lab load failed');
      }
      // The late paints of the load, as the timing reload waits for them.
      if (loaded && typeof open.waitForTimeout === 'function') await open.waitForTimeout(TIMING_SETTLE_MS);
      return { page: open, loaded };
    } catch {
      await labPage?.close().catch(() => {});
      return null;
    }
  }

  /** The timing of the lab load just made (no second load). Null when the step threw. */
  private async readTiming(lab: { page: Page; loaded: boolean }): Promise<BrowserTimingResult | null> {
    if (!lab.loaded) {
      return { speed: { status: 'not-measured', source: 'this-tool', method: 'lab', reason: 'timeout' }, raw: {} };
    }
    try {
      return await this.stages.measureBrowserTiming(lab.page, { reload: false });
    } catch {
      return null;
    }
  }

  /** Asks PageSpeed Insights for one page; true when it measured it. */
  private async askPsi(entry: RecordedPage, url: string): Promise<boolean> {
    if (!this.pageSpeed) return false;
    entry.psiTried = true;
    try {
      const answer = await this.pageSpeed.measure(url);
      entry.psi = answer?.speed ?? null;
      return answer?.speed.lab.status === 'measured';
    } catch {
      entry.psi = null;
      return false;
    }
  }

  /** The accessibility basics, then the phone layout (last, as it resizes the page), on an open page. */
  private async checkOpenPage(page: Page, entry: RecordedPage, n: number): Promise<void> {
    const { info } = entry;
    try {
      entry.accessibility = await this.stages.accessibilityBasics(page, {
        urlPath: info.urlPath,
        ids: this.a11yIds,
        testCaseId: `audit-a11y-${n}`,
      });
    } catch {
      entry.accessibility = null;
    }
    try {
      entry.phone = await this.stages.recordPhoneLayout(page, {
        versionDir: this.workDir,
        urlPath: info.urlPath,
        testCaseId: `audit-phone-${n}`,
      });
    } catch {
      entry.phone = null;
    }
  }

  /** One of the first PSI pages, on a public host, while a PSI key is available. */
  private claimPsi(url: string | undefined): boolean {
    if (!this.pageSpeed || this.psiLeft <= 0 || !url) return false;
    try {
      if (isLocalOriginHost(new URL(url).hostname)) return false;
    } catch {
      return false;
    }
    this.psiLeft--;
    return true;
  }

  /** Accessibility, then speed (PSI or the browser timing reload), then the phone layout. Never throws. */
  private async labWork(
    page: Page,
    entry: RecordedPage,
    n: number,
    usePsi: boolean,
    url: string | undefined,
    context?: RenderedPageContext
  ): Promise<void> {
    const { info } = entry;
    try {
      entry.accessibility = await this.stages.accessibilityBasics(page, {
        urlPath: info.urlPath,
        ids: this.a11yIds,
        testCaseId: `audit-a11y-${n}`,
      });
    } catch {
      entry.accessibility = null;
    }
    // PSI measures on Google's side: no second load of the site. Only a page it could not measure is reloaded.
    let psiMeasured = false;
    if (usePsi && url && this.pageSpeed) {
      entry.psiTried = true;
      try {
        const answer = await this.pageSpeed.measure(url);
        entry.psi = answer?.speed ?? null;
        psiMeasured = answer?.speed.lab.status === 'measured';
      } catch {
        entry.psi = null;
      }
    }
    if (!psiMeasured) {
      try {
        // The timing reloads the page: a second request to the site, so it takes the crawl's turn (ADR 0043).
        const measure = () => this.stages.measureBrowserTiming(page);
        const host = context?.pacer ? new URL(page.url()).host : null;
        entry.timing = context?.pacer && host ? await context.pacer.run(host, measure) : await measure();
      } catch {
        entry.timing = null;
      }
    }
    // T-431: the page is open, so the 1440 px "before" costs no second load. Sample Pages only.
    if (entry.coverage === 'sample') entry.desktopShot = await recordDesktopShot(page, this.workDir, info.urlPath);
    try {
      entry.phone = await this.stages.recordPhoneLayout(page, {
        versionDir: this.workDir,
        urlPath: info.urlPath,
        testCaseId: `audit-phone-${n}`,
      });
    } catch {
      entry.phone = null;
    }
    entry.labDone = true;
  }

  /** Every recorded page, in crawl order. */
  get pages(): readonly RecordedPage[] {
    return this.recorded;
  }

  /** The final Layout Group id of each page in a group of two or more ("group-1"...). */
  layoutGroups(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [path, info] of this.tracker.finish().coverage) {
      if (info.layoutGroup) out.set(path, info.layoutGroup);
    }
    return out;
  }
}

export function createPageRecorder(opts: PageRecorderOptions): AuditPageRecorder {
  return new AuditPageRecorder(opts);
}
