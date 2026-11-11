# T-260: One `addTokens` for AI token use

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | duplication | todo |

**Files you may edit (no others):**

- `packages/runner/src/ai-tokens.ts` (new)
- `packages/runner/src/server.ts`
- `packages/runner/src/routes/plan.ts`
- `packages/runner/tests/ai-tokens.test.ts` (new)

**Do not build in parallel with:** T-255, T-258, T-259, T-261, T-265, T-267 (all edit `server.ts`, about 3,900 lines); T-256, T-258 (edit `routes/plan.ts`).

## Problem

`addTokens` (adds the tokens each AI stage used) exists twice with different code: in `server.ts` (adds a visual review's use to the report) and in `routes/plan.ts` (adds a replan's use to the plan budget). The sums are the same. They differ in what they return when the second argument adds nothing.

## Owner decision needed

Case: the first argument is `undefined` and the second is an empty object `{}` (the AI made no request).

- Option A (recommended default): return the first argument unchanged, so `undefined` stays `undefined` (the `server.ts` behaviour). The saved plan or report then has no `tokens` key.
- Option B: return `{}` (the `routes/plan.ts` behaviour). The saved plan has `"tokens": {}`.

Nothing reads the difference: the wizard's two readers (`PlanDocument.tsx` and `ReportScreen.tsx`) both do `Object.entries(x || {})`, so `undefined` and `{}` show the same. The only effect is one key in the saved JSON of a replan that made no AI request. Change below is written for Option A. If the owner picks B, change the first line of the function to `if (!a && !b) return undefined; if (!b) return { ...(a ?? {}) };` and make the empty-object test expect `{}`.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "function addTokens" packages/runner/src/server.ts packages/runner/src/routes/plan.ts`.

`server.ts`:

```ts
/** Token use per stage, added together. */
function addTokens(a: AIRequestBudget['tokens'], b: AIRequestBudget['tokens']): AIRequestBudget['tokens'] {
  if (!b || Object.keys(b).length === 0) return a;
  const sum: NonNullable<AIRequestBudget['tokens']> = JSON.parse(JSON.stringify(a ?? {}));
  for (const [stage, u] of Object.entries(b) as Array<
    [keyof typeof sum, NonNullable<(typeof sum)[keyof typeof sum]>]
  >) {
    const s = (sum[stage] ??= { requests: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, truncated: 0 });
    s.requests += u.requests;
    s.promptTokens += u.promptTokens;
    s.completionTokens += u.completionTokens;
    s.reasoningTokens += u.reasoningTokens;
    s.truncated += u.truncated;
  }
  return sum;
}
```

`routes/plan.ts`:

```ts
function addTokens(
  a?: Partial<Record<AIStage, AIStageUsage>>,
  b?: Partial<Record<AIStage, AIStageUsage>>
): Partial<Record<AIStage, AIStageUsage>> | undefined {
  if (!a && !b) return undefined;
  const out: Partial<Record<AIStage, AIStageUsage>> = { ...(a || {}) };
  if (!b) return out;
  for (const [stage, usage] of Object.entries(b) as Array<[AIStage, AIStageUsage]>) {
    ...
  }
  return out;
}
```

Uses: `server.ts` `report.aiUsage = addTokens(report.aiUsage, paced.tokens);` and `routes/plan.ts` `tokens: addTokens(plan.budget?.tokens, paced?.tokens),`.

## Change

1. Create `packages/runner/src/ai-tokens.ts`:

```ts
import type { AIStage, AIStageUsage } from '@qa/types';

export type StageTokens = Partial<Record<AIStage, AIStageUsage>>;

/**
 * Token use per stage, added together. Adding nothing returns `a` as it is (possibly undefined); otherwise a new
 * object, so a saved report or plan is never changed through an alias.
 */
export function addTokens(a?: StageTokens, b?: StageTokens): StageTokens | undefined {
  if (!b || Object.keys(b).length === 0) return a;
  const sum: StageTokens = {};
  for (const [stage, usage] of Object.entries(a ?? {}) as Array<[AIStage, AIStageUsage]>) {
    sum[stage] = { ...usage };
  }
  for (const [stage, usage] of Object.entries(b) as Array<[AIStage, AIStageUsage]>) {
    const s = (sum[stage] ??= { requests: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, truncated: 0 });
    s.requests += usage.requests;
    s.promptTokens += usage.promptTokens;
    s.completionTokens += usage.completionTokens;
    s.reasoningTokens += usage.reasoningTokens;
    s.truncated += usage.truncated;
  }
  return sum;
}
```

2. `server.ts`: delete the local `addTokens` and its comment; add `import { addTokens } from './ai-tokens.js';`.
3. `routes/plan.ts`: delete the local `addTokens`; add `import { addTokens } from '../ai-tokens.js';`.
4. Run `pnpm exec eslint packages/runner/src/server.ts packages/runner/src/routes/plan.ts 2>&1 | grep "never used"` and remove imports that are now unused (`AIStage`, `AIStageUsage` in `plan.ts` if nothing else uses them; `AIRequestBudget` in `server.ts` if nothing else uses it). Then `pnpm exec prettier --write` on the changed files and `pnpm build`.

## Tests

Add `packages/runner/tests/ai-tokens.test.ts` (unit):

```ts
import { describe, it, expect } from 'vitest';
import { addTokens } from '../src/ai-tokens.js';

const use = (requests: number) => ({
  requests,
  promptTokens: requests * 10,
  completionTokens: requests * 5,
  reasoningTokens: 0,
  truncated: 0,
});
```

- `'adds the same stage'`: `addTokens({ planning: use(1) }, { planning: use(2) })` toEqual `{ planning: use(3) }`.
- `'keeps stages that appear on one side only'`: `addTokens({ planning: use(1) }, { repair: use(2) })` toEqual `{ planning: use(1), repair: use(2) }`.
- `'does not change either input'`: take `JSON.stringify` of both before, call, compare after.
- `'adding nothing returns the first argument as it is'`: `addTokens(a, {})` toBe `a`; `addTokens(a, undefined)` toBe `a`; `addTokens(undefined, {})` toBeUndefined; `addTokens(undefined, undefined)` toBeUndefined.
- `'adding to nothing copies the second'`: `const b = { planning: use(1) }; const r = addTokens(undefined, b);` toEqual `b` and `r!.planning` not toBe `b.planning`.

Run: `pnpm exec vitest run packages/runner/tests/ai-tokens.test.ts packages/runner/tests/plan-routes.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "function addTokens" packages/runner/src/server.ts packages/runner/src/routes/plan.ts` prints nothing.
- [ ] `grep -c "addTokens" packages/runner/src/ai-tokens.ts` is at least 1.
- [ ] The two test files pass and `pnpm build` passes.

## Notes

- Stored plans and reports from before this change have no extra requirement: the stored shape is unchanged.
