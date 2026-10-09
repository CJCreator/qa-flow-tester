/** PlanPipeline (ADR 0020): pages are planned while the crawl runs. No browser. */
import { describe, it, expect } from 'vitest';
import type { AIMessage, AICompletionOptions, ElementInventoryItem, PageInventoryItem } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import { PlanPipeline } from '../src/plan/pipeline.js';
import { buildSiteGraph } from '../src/plan/site-graph.js';
import type { PagePlannerInput } from '../src/plan/ai-planner.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const button = (name: string, selector: string): ElementInventoryItem => ({
  role: 'button',
  name,
  selector,
  tagName: 'button',
  visible: true,
  enabled: true,
});

const page = (urlPath: string, layoutGroup: string, label = 'Toggle details', key = 'k'): PageInventoryItem => ({
  urlPath,
  title: urlPath,
  interactiveElementsCount: 1,
  formsCount: 0,
  elements: [button(label, `[data-testid="${label.replace(/\s+/g, '-')}"]`)],
  links: [],
  layoutGroup,
  contentKey: `${key}:${label}`,
});

/** The mock AI, slowed down. */
class Slow implements AIProvider {
  readonly providerType = 'mock' as const;
  private inner = new MockAIProvider();
  calls = 0;
  constructor(private ms: number) {}
  async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    this.calls++;
    await sleep(this.ms);
    return this.inner.generateText(messages, options);
  }
}

// 12 pages in 3 templated groups (5, 2, 3) plus two fixed addresses.
const feed: PageInventoryItem[] = [
  page('/about', 'layout-a'),
  ...[1, 2, 3, 4, 5].map((n) => page(`/products/${n}`, 'layout-p')),
  ...[1, 2].map((n) => page(`/orders/${n}`, 'layout-o')),
  page('/pricing', 'layout-a'),
  ...[1, 2, 3].map((n) => page(`/news/${n}`, 'layout-n')),
];

const base = {
  targetUrl: 'https://app.example/',
  readOnly: false,
  redact: (t: string) => t,
};

function finalInput(pipeline: PlanPipeline, pages: PageInventoryItem[]): PagePlannerInput {
  const { coverage } = pipeline.layout();
  return {
    ...base,
    pages: pages.map((p) => ({ ...p, reachedBy: ['visitor'] })),
    forms: [],
    coverage,
    graph: buildSiteGraph(pages, '/about'),
    siteType: 'website',
  };
}

describe('PlanPipeline', () => {
  it('plans the first batches before finish, and leaves them unchanged afterwards', async () => {
    const ai = new Slow(10);
    const pipeline = new PlanPipeline({ input: base, ai, concurrency: 3, startPath: '/about' });
    for (const p of feed.slice(0, 6)) {
      pipeline.push(p, 'visitor');
      await sleep(5);
    }
    await sleep(150);
    // Before finish() is called, items already exist.
    expect(pipeline.plannedSoFar).toBeGreaterThanOrEqual(3);
    const early = pipeline.snapshot();
    const earlyPaths = Object.keys(early);
    expect(earlyPaths.length).toBeGreaterThanOrEqual(3);

    for (const p of feed.slice(6)) pipeline.push(p, 'visitor');
    const out = await pipeline.finish(finalInput(pipeline, feed));

    expect(out.plannedWhileCrawling).toBe(true);
    for (const path of earlyPaths) {
      const before = JSON.parse(early[path]) as { tests: unknown[]; origin: string };
      const after = out.pages.find((p) => p.urlPath === path)!;
      // Byte-identical: the early tests are still the first tests, unchanged.
      expect(JSON.stringify(after.tests.slice(0, before.tests.length))).toBe(JSON.stringify(before.tests));
      expect(after.origin).toBe('while-crawling');
    }
    // Pages that arrived late are marked as added after the scan.
    const late = out.pages.find((p) => p.urlPath === '/news/3')!;
    expect(late.origin).toBe('after-crawl');
  });

  it('lets no tested page go without a plan entry (a lagging free key plans late batches after the crawl)', async () => {
    const ai = new Slow(30);
    const pipeline = new PlanPipeline({ input: base, ai, concurrency: 1, startPath: '/about' });
    for (const p of feed) pipeline.push(p, 'visitor');
    const out = await pipeline.finish(finalInput(pipeline, feed));
    const tested = out.pages.filter((p) => p.coverage !== 'covered');
    expect(tested.length).toBeGreaterThan(0);
    for (const p of tested) {
      expect(p.origin, p.urlPath).toBeDefined();
      expect(p.tests.length, p.urlPath).toBeGreaterThan(0);
    }
    expect(out.pages.some((p) => p.origin === 'after-crawl')).toBe(true);
    expect(out.pages.find((p) => p.urlPath === '/about')!.origin).toBe('while-crawling');
  });

  it('keeps the sample set stable as the 4th and 5th group members arrive; a group of 2 stays tested', async () => {
    const ai = new Slow(1);
    const pipeline = new PlanPipeline({ input: base, ai, concurrency: 2, startPath: '/about' });
    for (const p of feed) pipeline.push(p, 'visitor');
    const out = await pipeline.finish(finalInput(pipeline, feed));
    const by = (path: string) => out.pages.find((p) => p.urlPath === path)!;
    for (const n of [1, 2, 3]) expect(by(`/products/${n}`).coverage).toBe('sample');
    for (const n of [4, 5]) {
      expect(by(`/products/${n}`).coverage).toBe('covered');
      expect(by(`/products/${n}`).coveredBy).toEqual(['/products/1', '/products/2', '/products/3']);
      expect(by(`/products/${n}`).tests).toEqual([]);
    }
    expect(by('/orders/1').coverage).toBe('tested');
    expect(by('/orders/2').coverage).toBe('tested');
    // A group of three is all tested.
    expect(by('/news/3').coverage).toBe('tested');
  });

  it('adds a role view as an addition without touching the original tests', async () => {
    const ai = new Slow(1);
    const pipeline = new PlanPipeline({ input: base, ai, concurrency: 1, startPath: '/dash' });
    // Three pages fill a batch, so it is sent before finish.
    const others = [page('/help', 'layout-h'), page('/team', 'layout-t')];
    pipeline.push(page('/dash', 'layout-d', 'Open overview', 'visitor'), 'visitor');
    for (const o of others) pipeline.push(o, 'visitor');
    await sleep(60);
    const early = pipeline.snapshot();
    const adminView = { ...page('/dash', 'layout-d', 'Invite teammate', 'admin'), reachedBy: ['visitor', 'admin'] };
    const { coverage } = pipeline.layout();
    const out = await pipeline.finish({
      ...base,
      pages: [adminView, ...others],
      forms: [],
      coverage,
      graph: buildSiteGraph([adminView, ...others], '/dash'),
      siteType: 'website',
    });
    const dash = out.pages[0];
    const original = (JSON.parse(early['/dash']) as { tests: unknown[] }).tests;
    expect(original.length).toBeGreaterThan(0);
    expect(JSON.stringify(dash.tests.slice(0, original.length))).toBe(JSON.stringify(original));
    const added = dash.tests.slice(original.length);
    expect(added.length).toBeGreaterThan(0);
    for (const t of added) {
      expect(t.origin).toBe('after-crawl');
      expect(t.role).toBe('admin');
    }
  });

  it('one failing batch does not fail the crawl: its pages are planned at the end', async () => {
    let n = 0;
    class Flaky extends Slow {
      override async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
        if (n++ === 0) throw new Error('boom');
        return super.generateText(messages, options);
      }
    }
    const pipeline = new PlanPipeline({ input: base, ai: new Flaky(1), concurrency: 1, startPath: '/about' });
    for (const p of feed.slice(0, 3)) pipeline.push(p, 'visitor');
    const out = await pipeline.finish(finalInput(pipeline, feed.slice(0, 3)));
    expect(out.pages).toHaveLength(3);
    for (const p of out.pages) expect(p.tests.length).toBeGreaterThan(0);
  });
});
