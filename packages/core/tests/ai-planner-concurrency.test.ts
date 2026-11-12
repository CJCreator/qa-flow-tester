import { describe, it, expect } from 'vitest';
import type { AIMessage, AICompletionOptions, PageInventoryItem } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import { PacedAI } from '../src/plan/ai-budget.js';
import { planPagesAndMenus, type PagePlannerInput } from '../src/plan/ai-planner.js';
import { buildSiteGraph } from '../src/plan/site-graph.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The mock AI, slowed down, that records the most requests it had at once. */
class Tracking implements AIProvider {
  readonly providerType = 'mock' as const;
  private inner = new MockAIProvider();
  inFlight = 0;
  maxInFlight = 0;
  async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await sleep(20);
    try {
      return await this.inner.generateText(messages, options);
    } finally {
      this.inFlight--;
    }
  }
}

const pages: PageInventoryItem[] = Array.from({ length: 9 }, (_, i) => ({
  urlPath: `/p${i + 1}`,
  title: `P${i + 1}`,
  interactiveElementsCount: 1,
  formsCount: 0,
  elements: [
    { role: 'button', name: `Go ${i + 1}`, selector: `#go${i + 1}`, tagName: 'button', visible: true, enabled: true },
  ],
  links: [],
  layoutGroup: `layout-${i + 1}`,
  contentKey: `k${i + 1}`,
}));

const input = (): PagePlannerInput => ({
  pages,
  forms: [],
  coverage: new Map(pages.map((p) => [p.urlPath, { coverage: 'tested' as const }])),
  graph: buildSiteGraph(pages, '/p1'),
  targetUrl: 'https://app.example/',
  siteType: 'website',
  readOnly: false,
  redact: (t) => t,
});

async function plan(concurrency: number) {
  const provider = new Tracking();
  const paced = new PacedAI(provider, Infinity, { concurrency });
  const out = await planPagesAndMenus(input(), paced);
  return { provider, out };
}

describe('planPagesAndMenus batches', () => {
  it('plans one batch at a time when the pacing allows one request', async () => {
    const { provider } = await plan(1);
    expect(provider.maxInFlight).toBe(1);
  });
  it('plans batches together, within the pacing limit, and keeps every page in order', async () => {
    const { provider, out } = await plan(3);
    expect(provider.maxInFlight).toBeGreaterThan(1);
    expect(provider.maxInFlight).toBeLessThanOrEqual(3);
    expect(out.pages.map((p) => p.urlPath)).toEqual(pages.map((p) => p.urlPath));
  });
});
