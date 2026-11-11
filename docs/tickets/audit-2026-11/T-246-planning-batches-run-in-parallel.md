# T-246: Page planning batches run in parallel when the AI pacing allows

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | core | performance | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/ai-planner.ts`
- `packages/core/tests/ai-planner-concurrency.test.ts` (new)

**Do not build in parallel with:** nothing.

## Problem

`planPagesAndMenus` plans its page batches one after another with `for ... await`. The scan's pipeline (`plan/pipeline.ts`) runs batches in parallel up to `PacedAI.concurrency` (1 to 5, set from the provider's headroom, see `pacingFor`). So a re-plan ("Re-plan everything", "Add pages") of a big site is slower than the first scan, even when the AI provider allows several requests at once. `PacedAI` itself already limits how many calls are in flight, so running batches together cannot break the limit.

## Current code

Branch from `main`. `packages/core/src/plan/ai-planner.ts` (`grep -n "for (const batch of batches)" packages/core/src/plan/ai-planner.ts`), inside `planPagesAndMenus`:

```ts
for (const batch of batches) {
  for (const [urlPath, entry] of await planBatch(batch, input, ai, { safety, titles, binding, asking })) {
    planned.set(urlPath, entry);
  }
  done++;
  onProgress?.({ done, total, what: `Planned ${batch.map((p) => p.urlPath).join(', ')}` });
}
```

The file already imports from `./ai-budget.js`: `import { BudgetSpentError, CapSpentError, StoppedEarlyError } from './ai-budget.js';`. `PacedAI` (same file `ai-budget.ts`) has `readonly concurrency: number` (at least 1). `planBatch` never throws for a failed request (it falls back to fixed rules).

Who calls `planPagesAndMenus` with a `PacedAI`: `discovery-agent.ts` (when `sequentialPlanning` is set or there is no pipeline) and `runner/src/routes/plan.ts` (re-plans, with `new PacedAI(provider, ..., budget.pacing)`).

## Change

1. Add `PacedAI` to the `./ai-budget.js` import.

2. Replace the `for (const batch of batches) { ... }` loop with:

```ts
// As many batches at once as the pacing allows (PacedAI holds the real limit); results go back in order.
const concurrency = ai instanceof PacedAI ? ai.concurrency : 1;
const results: Array<Map<string, PlannedPage>> = new Array(batches.length);
let next = 0;
const worker = async (): Promise<void> => {
  while (next < batches.length) {
    const index = next++;
    const batch = batches[index];
    results[index] = await planBatch(batch, input, ai, { safety, titles, binding, asking });
    done++;
    onProgress?.({ done, total, what: `Planned ${batch.map((p) => p.urlPath).join(', ')}` });
  }
};
await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
for (const result of results) for (const [urlPath, entry] of result) planned.set(urlPath, entry);
```

3. Run `pnpm exec prettier --write packages/core/src/plan/ai-planner.ts packages/core/tests/ai-planner-concurrency.test.ts`, then `pnpm build`.

## Tests

New file `packages/core/tests/ai-planner-concurrency.test.ts`. It counts how many AI calls are in flight at once. Nine tested pages make three batches (3 pages per request).

```ts
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
```

Run: `pnpm exec vitest run packages/core/tests/ai-planner-concurrency.test.ts packages/core/tests/plan-pipeline.test.ts packages/core/tests/ai-planner-limits.test.ts packages/core/tests/ai-planner-sources.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "for (const batch of batches)" packages/core/src/plan/ai-planner.ts` prints nothing.
- [ ] The four test files pass; `pnpm build` passes.

## Notes

- If `out.pages` is not in input order in the second test, check `assemblePlan`: it walks `input.pages`, so it should be. If it is not, compare as sorted lists and tell the owner in the PR.
- If the mock AI's answers make `planBatch` ask a repair request, the number of calls grows but `maxInFlight` is still what the test reads.
- Not in this ticket: the "remembered pages are re-asked from the AI" finding. It is already handled: `PlanPipeline.push` (`plan/pipeline.ts`, `rememberedFor`) and `planPagesAndMenus` both skip a page whose `contentKey` matches the remembered one (and whose remembered plan was not fixed rules).
