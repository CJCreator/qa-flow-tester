/**
 * Stage 1 of the audit pipeline, run inside the crawl (REQ-005, REQ-037, REQ-038): each recorded page is read
 * once while it is still open (`runAuditCrawl`'s `onRenderedPage`). Every page gets its Page Content
 * (`readPage`); Sample Pages also get lab work: the accessibility basics, the speed timing and then the phone
 * layout (last, as it resizes the page).
 *
 * Lab work runs off the crawl workers (T-404): when the crawl offers `openPage` and `defer`, each Sample Page's
 * lab work is queued and done on a page of its own (loaded again in the host's turn), at most `labInFlight` at
 * once, while the crawl worker goes on to its next page. The crawl waits for the queue only before it closes
 * its browser. Without them (older callers, tests), lab work runs on the crawl's page as before.
 *
 * Pages PageSpeed Insights measures (`pageSpeed`, the first 20) get no browser timing reload; a page PSI could
 * not measure gets the browser timing afterwards, on the same lab page.
 *
 * Sample Pages are decided as pages arrive, with the Check-up's Layout Group rule (`GroupTracker`): a page with
 * a fixed address and the first three members of a templated group are Sample Pages; later members are covered
 * by their group's first Sample Page (DEC-006). A step that throws is recorded as not done for that page; the
 * hook itself never throws, so the crawl goes on.
 */
import type { Page } from 'playwright';
import type { PageSpeed } from '@qa/types';
import { createFindingIdAllocator } from '../analysis/finding-ids.js';
import { readPage, type ReadPageResult } from '../analysis/read-page.js';
import { accessibilityBasics, type AccessibilityBasicsResult } from '../analysis/accessibility-basics.js';
import { recordPhoneLayout, type PhoneLayoutRecord } from '../phone-layout.js';
import { measureBrowserTiming, type BrowserTimingResult } from '../speed/browser-timing.js';
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

export interface PageRecorderOptions {
  /** Local working folder of the version: phone screenshots are written under it, then saved to the store. */
  workDir: string;
  stages?: Partial<PageStages>;
  /**
   * PageSpeed Insights for one page, when a PSI key is available (T-404). The first `maxPages` Sample Pages
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
  /** Sample Pages only. Null when the step threw. */
  accessibility?: AccessibilityBasicsResult | null;
  /** Sample Pages only. Null when the step threw. */
  phone?: PhoneLayoutRecord | null;
  /** Sample Pages only. Lab speed measured by this tool directly in the browser (ADR 0042). Null when the step threw. */
  timing?: BrowserTimingResult | null;
  /** Set when PageSpeed Insights was asked for this page during the crawl (T-404); `psi` holds its answer. */
  psiTried?: boolean;
  psi?: PageSpeed | null;
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
  private readonly a11yIds = createFindingIdAllocator();
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
    if (entry.coverage !== 'sample') return;

    const n = ++this.sampleCount;
    let url: string | undefined;
    try {
      url = page.url();
    } catch {
      url = undefined;
    }
    const usePsi = this.claimPsi(url);

    // Off the crawl worker: the job loads the page again on a page of its own, in the host's turn.
    const openPage = context?.openPage;
    if (openPage && context?.defer && url) {
      const pageUrl = url;
      this.lab ??= new LabQueue(Math.max(1, context.labInFlight ?? DEFAULT_LAB_IN_FLIGHT));
      const lab = this.lab;
      const job = lab.run(async () => {
        if (context.signal?.aborted) return;
        let labPage: Page | undefined;
        try {
          labPage = await openPage();
          const open = labPage;
          const load = () => open.goto(pageUrl, { waitUntil: 'load', timeout: LAB_LOAD_TIMEOUT_MS });
          const host = new URL(pageUrl).host;
          await context.pacer.run(host, load, context.signal);
        } catch {
          entry.accessibility = null;
          entry.phone = null;
          entry.timing = null;
          await labPage?.close().catch(() => {});
          return;
        }
        try {
          await this.labWork(labPage, entry, n, usePsi, pageUrl, context);
        } finally {
          await labPage.close().catch(() => {});
        }
      });
      this.labJobs.push(job);
      context.defer(job);
      return;
    }

    await this.labWork(page, entry, n, usePsi, url, context);
  };

  /** Resolves once every queued lab job has ended (the crawl awaits this through `defer`). */
  async drain(): Promise<void> {
    await Promise.all(this.labJobs);
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
