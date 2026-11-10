/**
 * Stage 1 of the audit pipeline, run inside the crawl (REQ-005, REQ-037, REQ-038): each recorded page is read
 * once while it is still open (`runAuditCrawl`'s `onRenderedPage`). Every page gets its Page Content
 * (`readPage`); Sample Pages also get the accessibility basics and then the phone layout (last, as it resizes
 * the page). Nothing here opens a page or makes a request of its own.
 *
 * Sample Pages are decided as pages arrive, with the Check-up's Layout Group rule (`GroupTracker`): a page with
 * a fixed address and the first three members of a templated group are Sample Pages; later members are covered
 * by their group's first Sample Page (DEC-006). A step that throws is recorded as not done for that page; the
 * hook itself never throws, so the crawl goes on.
 */
import type { Page } from 'playwright';
import { createFindingIdAllocator } from '../analysis/finding-ids.js';
import { readPage, type ReadPageResult } from '../analysis/read-page.js';
import { accessibilityBasics, type AccessibilityBasicsResult } from '../analysis/accessibility-basics.js';
import { recordPhoneLayout, type PhoneLayoutRecord } from '../phone-layout.js';
import { measureBrowserTiming, type BrowserTimingResult } from '../speed/browser-timing.js';
import type { AuditCrawlPage, RenderedPageContext } from '../crawl/crawl.js';
import { GroupTracker } from '../../plan/sampling.js';

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

export interface PageRecorderOptions {
  /** Local working folder of the version: phone screenshots are written under it, then saved to the store. */
  workDir: string;
  stages?: Partial<PageStages>;
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

  constructor(opts: PageRecorderOptions) {
    this.workDir = opts.workDir;
    this.stages = { ...DEFAULT_PAGE_STAGES, ...(opts.stages ?? {}) };
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
      entry.read = await this.stages.readPage(page);
    } catch {
      entry.read = null;
    }
    if (entry.coverage !== 'sample') return;

    const n = ++this.sampleCount;
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
      // The timing reloads the page: a second request to the site, so it takes the crawl's turn (ADR 0043).
      const measure = () => this.stages.measureBrowserTiming(page);
      const host = context?.pacer ? new URL(page.url()).host : null;
      entry.timing = context?.pacer && host ? await context.pacer.run(host, measure) : await measure();
    } catch {
      entry.timing = null;
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
  };

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
