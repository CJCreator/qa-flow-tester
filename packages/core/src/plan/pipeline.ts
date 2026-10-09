import type { PageInventoryItem, PlanItemOrigin, PlanLayoutGroup } from '@qa/types';
import type { AIProvider } from '../ai/ai-provider.js';
import { SafetyFilter } from '../discovery/safety-filter.js';
import {
  assemblePlan,
  bindRoles,
  CONTROLS_PER_PAGE,
  CONTROLS_PER_REQUEST,
  pageBatches,
  PAGES_PER_REQUEST,
  planBatch,
  testedPages,
  type PagePlannerInput,
  type PagePlannerOutput,
  type PlannedPage,
  type PlannerForm,
  type PlannerProgress,
} from './ai-planner.js';
import { GroupTracker, type PageCoverageInfo } from './sampling.js';
import { buildSiteGraph, pathOf } from './site-graph.js';
import type { RoleBinding } from './sources.js';

/** What a pipeline needs that stays the same for the whole crawl. */
export type PipelineInput = Omit<PagePlannerInput, 'pages' | 'forms' | 'coverage' | 'graph' | 'siteType'>;

export interface PlanPipelineOptions {
  input: PipelineInput;
  ai: AIProvider | undefined;
  /** Requests in flight at once (`PacedAI.concurrency`); a free key is 1, so planning may lag the crawl. */
  concurrency?: number;
  /** The site type for the prompts, worked out from the pages seen so far. */
  siteTypeOf?: (pages: PageInventoryItem[]) => string;
  /** The page the App Flow starts from while the crawl runs. */
  startPath: string;
  onProgress?: (progress: PlannerProgress) => void;
}

/** Who a page's tests run as: the explorer whose view they were planned from (same rule as the planner). */
function explorerOf(page: PageInventoryItem): string {
  const reached = page.reachedBy?.length ? page.reachedBy : ['visitor'];
  return reached[reached.length - 1];
}

/**
 * Plans pages while the Spider is still crawling. Pages arrive with `push`; full batches (3 pages or
 * 120 controls, as in `pageBatches`) go to the AI at once. `finish` plans what is left, checks no
 * tested page was missed, adds the role-view additions, then builds Navigation Checks, shared menus
 * and the rest from the whole site graph. A plan made before `finish` is never changed afterwards.
 */
export class PlanPipeline {
  private readonly tracker = new GroupTracker();
  private readonly seen = new Map<string, { contentKey?: string; who: string }>();
  private readonly pagesSoFar: PageInventoryItem[] = [];
  private readonly formsSoFar: PlannerForm[] = [];
  private readonly planned = new Map<string, PlannedPage>();
  private readonly safety: SafetyFilter;
  private readonly queue: PageInventoryItem[][] = [];
  private readonly settled: Array<Promise<void>> = [];
  private pending: PageInventoryItem[] = [];
  private pendingControls = 0;
  private running = 0;
  private finishing = false;
  private done = 0;
  private total = 0;
  private readonly bound: Promise<{ binding: RoleBinding; failed: boolean }>;

  constructor(private readonly options: PlanPipelineOptions) {
    this.safety = new SafetyFilter(options.input.forbiddenActions || []);
    const asked = (options.input.requirements?.length ?? 0) > 0 && (options.input.roles?.length ?? 0) >= 2;
    if (options.ai && asked) this.total++;
    this.bound = bindRoles(this.provisional(false), options.ai, this.asking('which roles the documents are for')).then(
      (b) => {
        if (options.ai && asked) {
          this.done++;
          this.report('Worked out which roles the documents are for');
        }
        return { binding: b.binding, failed: b.failed };
      }
    );
  }

  /** Pages whose tests exist so far (including ones remembered from the last Plan). */
  get plannedSoFar(): number {
    return this.planned.size;
  }

  /** A page of the crawl, as one explorer saw it. A path already seen is ignored here: `finish` handles role views. */
  push(page: PageInventoryItem, who: string, forms: PlannerForm[] = []): void {
    const key = pathOf(page.urlPath);
    if (this.seen.has(key)) return;
    this.seen.set(key, { contentKey: page.contentKey, who });
    const copy: PageInventoryItem = { ...page, reachedBy: [who] };
    this.pagesSoFar.push(copy);
    this.formsSoFar.push(...forms);
    const arrival = this.tracker.add(copy);
    if (!arrival.planNow) return;
    const before = this.rememberedFor(copy);
    if (before) {
      this.planned.set(key, {
        tests: JSON.parse(JSON.stringify(before.tests)),
        source: before.source,
        links: new Map(),
      });
      return;
    }
    const count = Math.min(copy.elements?.length ?? 0, CONTROLS_PER_PAGE);
    if (
      this.pending.length > 0 &&
      (this.pending.length >= PAGES_PER_REQUEST || this.pendingControls + count > CONTROLS_PER_REQUEST)
    )
      this.flush();
    this.pending.push(copy);
    this.pendingControls += count;
    if (this.pending.length >= PAGES_PER_REQUEST || this.pendingControls >= CONTROLS_PER_REQUEST) this.flush();
  }

  /** The Layout Groups and coverage of the pages pushed so far; final once the crawl is done. */
  layout(): { groups: PlanLayoutGroup[]; coverage: Map<string, PageCoverageInfo> } {
    return this.tracker.finish();
  }

  /** Plain copies of the tests planned so far, by path: what the person could already see. */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, entry] of this.planned) out[path] = JSON.stringify({ tests: entry.tests, origin: entry.origin });
    return out;
  }

  async finish(final: PagePlannerInput): Promise<PagePlannerOutput> {
    this.finishing = true;
    this.flush();
    await this.drain();

    // Coverage check: every page that is tested has a plan entry. A miss (a lagging or failed batch,
    // a page promoted after the crawl) is planned now, as an addition.
    const missing = testedPages(final).filter((p) => !this.planned.has(pathOf(p.urlPath)));
    for (const batch of pageBatches(missing)) this.queue.push(batch);
    this.pump();
    await this.drain();

    // A role saw a page differently from the view it was planned from: one addition for that role.
    for (const page of testedPages(final)) {
      const first = this.seen.get(pathOf(page.urlPath));
      const entry = this.planned.get(pathOf(page.urlPath));
      const who = explorerOf(page);
      if (!first || !entry || entry.origin === undefined || first.who === who) continue;
      if (first.contentKey === page.contentKey) continue;
      this.queue.push([page]);
      this.additions.add(pathOf(page.urlPath));
    }
    this.pump();
    await this.drain();

    const bound = await this.bound;
    const planned = new Map<string, PlannedPage>();
    for (const page of final.pages) {
      const entry = this.planned.get(pathOf(page.urlPath));
      if (entry) planned.set(page.urlPath, { ...entry, tests: [...entry.tests] });
    }
    return assemblePlan(final, this.options.ai, planned, {
      binding: bound.binding,
      boundFailed: bound.failed,
      asking: this.asking,
      step: (what) => {
        this.done++;
        this.total = Math.max(this.total, this.done);
        this.report(what);
      },
    });
  }

  /** Paths whose queued batch is a role-view addition: its tests are appended, never replacing. */
  private readonly additions = new Set<string>();

  private rememberedFor(page: PageInventoryItem) {
    const before = this.options.input.remembered?.pages[page.urlPath];
    return before?.contentKey && before.contentKey === page.contentKey && before.source !== 'fallback'
      ? before
      : undefined;
  }

  private readonly asking = (what: string) => (attempt: number) =>
    this.options.onProgress?.({
      done: this.done,
      total: this.total,
      what: `Asking the AI about ${what}${attempt > 1 ? ` (try ${attempt})` : ''}…`,
      asking: true,
      attempt,
    });

  private report(what: string): void {
    this.options.onProgress?.({ done: this.done, total: this.total, what });
  }

  /** The input a request is written from while the crawl runs: only what has been seen so far. */
  private provisional(withPages: boolean): PagePlannerInput {
    const pages = withPages ? [...this.pagesSoFar] : [];
    return {
      ...this.options.input,
      pages,
      forms: this.formsSoFar,
      coverage: new Map(),
      graph: buildSiteGraph(pages, this.options.startPath),
      siteType: this.options.siteTypeOf?.(pages) ?? 'website',
    };
  }

  private flush(): void {
    if (this.pending.length > 0) this.queue.push(this.pending);
    this.pending = [];
    this.pendingControls = 0;
    this.pump();
  }

  private pump(): void {
    const limit = Math.max(1, this.options.concurrency ?? 1);
    while (this.running < limit && this.queue.length > 0) this.start(this.queue.shift()!);
  }

  private async drain(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) {
      this.pump();
      await Promise.all(this.settled.splice(0));
      if (this.running > 0 && this.settled.length === 0) await new Promise((r) => setTimeout(r, 5));
    }
  }

  private start(batch: PageInventoryItem[]): void {
    const origin: PlanItemOrigin = this.finishing ? 'after-crawl' : 'while-crawling';
    this.running++;
    this.total++;
    const job = (async () => {
      try {
        const bound = await this.bound;
        const input = this.provisional(true);
        // Pages that arrive later (or a final view) are in `batch` itself; make sure it is covered.
        input.pages = [...new Map([...input.pages, ...batch].map((p) => [pathOf(p.urlPath), p])).values()];
        const titles = new Map(
          input.pages.filter((p) => p.title?.trim()).map((p) => [pathOf(p.urlPath), p.title.trim()] as const)
        );
        const results = await planBatch(batch, input, this.options.ai, {
          safety: this.safety,
          titles,
          binding: bound.binding,
          asking: this.asking,
        });
        for (const [urlPath, entry] of results) {
          const key = pathOf(urlPath);
          if (this.additions.has(key) && this.planned.has(key)) {
            this.appendAddition(key, entry);
            continue;
          }
          entry.origin = origin;
          for (const t of entry.tests) t.origin = origin;
          this.planned.set(key, entry);
        }
        this.done++;
        this.report(`Planned ${batch.map((p) => p.urlPath).join(', ')}`);
      } catch {
        // One batch failing never fails the crawl: the coverage check plans its pages at the end.
        this.done++;
      } finally {
        this.running--;
        this.pump();
      }
    })();
    this.settled.push(job);
  }

  /** A role's own view of an already-planned page: its new tests are appended after the original ones. */
  private appendAddition(key: string, entry: PlannedPage): void {
    const existing = this.planned.get(key)!;
    const names = new Set(existing.tests.map((t) => t.name));
    let n = existing.tests.length;
    for (const test of entry.tests) {
      if (names.has(test.name)) continue;
      existing.tests.push({ ...test, id: `${test.id}:view${++n}`, origin: 'after-crawl' });
    }
    this.additions.delete(key);
  }
}
