# T-242: The UX gap synthesizer checks `providerType`, not the class name

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/competitive/ux-gap-synthesizer.ts`
- `packages/core/tests/ux-gap-synthesizer.test.ts` (new)

**Do not build in parallel with:** nothing.

## Problem

`UXGapSynthesizer.synthesize` decides "is this the mock AI?" from `aiProvider.constructor.name !== 'MockAIProvider'`. A class name changes when the code is minified, bundled or wrapped (for example `PacedAI` wraps a provider), and a real provider class that someone names `MockAIProvider` is skipped. Every other place uses the `providerType` field of the `AIProvider` interface (`'mock'` for the mock).

## Current code

Branch from `main`. `packages/core/src/competitive/ux-gap-synthesizer.ts` (`grep -n "constructor.name" packages/core/src/competitive/ux-gap-synthesizer.ts`):

```ts
    // 2. If an AI provider is active and not mock, run LLM synthesis
    if (aiProvider && aiProvider.constructor.name !== 'MockAIProvider') {
```

`AIProvider` (in `ai/ai-provider.ts`) has `readonly providerType: AIProviderType;`, and `MockAIProvider.providerType` is `'mock'`.

## Change

1. Replace the `if` line with:

```ts
    if (aiProvider && aiProvider.providerType !== 'mock') {
```

2. Run `pnpm exec prettier --write packages/core/src/competitive/ux-gap-synthesizer.ts`, then `pnpm build`.

## Tests

New file `packages/core/tests/ux-gap-synthesizer.test.ts`. It uses the flows and scorecards the way `competitive-benchmarking.test.ts` does; to keep it short, build two scorecards by hand:

```ts
import { describe, it, expect } from 'vitest';
import type { FrictionScorecard, ReferenceFlow } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { UXGapSynthesizer } from '../src/competitive/ux-gap-synthesizer.js';

const flow = (name: string) => ({ id: name, name, steps: [] }) as unknown as ReferenceFlow;
const score = (requiredFieldsCount: number) =>
  ({ totalSteps: 3, totalFields: 5, requiredFieldsCount, frictionIndex: 10 }) as unknown as FrictionScorecard;

const answer = JSON.stringify([
  {
    category: 'UX Polish',
    title: 'From the AI',
    effort: 'Low',
    impact: 'High',
    rationale: 'why',
    suggestedAction: 'do it',
  },
]);

/** A provider whose class name is "MockAIProvider" but which is a real one. */
class MockAIProvider {
  constructor(public readonly providerType: AIProvider['providerType']) {}
  calls = 0;
  async generateText(): Promise<string> {
    this.calls++;
    return answer;
  }
}

const run = (ai: MockAIProvider) =>
  new UXGapSynthesizer().synthesize(flow('ours'), flow('theirs'), score(2), score(2), ai as unknown as AIProvider);

describe('UXGapSynthesizer AI step', () => {
  it('does not ask a provider whose providerType is mock', async () => {
    const ai = new MockAIProvider('mock');
    await run(ai);
    expect(ai.calls).toBe(0);
  });
  it('asks a real provider even when its class is named MockAIProvider', async () => {
    const ai = new MockAIProvider('openai');
    const recs = await run(ai);
    expect(ai.calls).toBe(1);
    expect(recs.some((r) => r.title === 'From the AI')).toBe(true);
  });
});
```

Run: `pnpm exec vitest run packages/core/tests/ux-gap-synthesizer.test.ts packages/core/tests/competitive-benchmarking.test.ts`.

## Done when

- [ ] `grep -rn "constructor.name" packages/core/src` prints nothing.
- [ ] The two test files pass; `pnpm build` passes.

## Notes

- Equal scorecards (`score(2)` twice) mean the heuristic part adds nothing, so the only recommendation in the second test comes from the AI answer.
