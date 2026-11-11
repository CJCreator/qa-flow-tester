# T-265: The AI estimate asks OpenRouter for today's requests once

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | speed | todo |

**Files you may edit (no others):**

- `packages/runner/src/server.ts`
- `packages/runner/tests/ai-estimate-cap.test.ts`

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-267 (all edit `server.ts`, about 3,900 lines).

## Problem

`handleAiEstimate` (the route behind "about how many AI requests will this need") calls `openRouter.freeRequestsToday(key)` itself, and then calls `aiBudgetFor(...)`, which calls `freeRequestsToday` again and also returns the same numbers as `left` and `limit`. Each call is a network request to OpenRouter's `/key` endpoint, so the estimate waits on the same answer twice, one after the other.

T-112 left this alone because it believed `aiBudgetFor`'s return value would need to change. It does not: it already returns `left` (today's remaining requests) and `limit`.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "private async handleAiEstimate" packages/runner/src/server.ts`.

```ts
const setup = await this.aiSetup();
const today =
  setup.provider === 'openrouter' && setup.key
    ? await this.openRouter.freeRequestsToday(setup.key).catch(() => null)
    : null;
// Pacing and price come from what the provider reports; dollars only when the model has a price.
const cap = checkAiCap(body.aiCap);
const capValue = cap.ok ? cap.value : undefined;
const budget =
  setup.provider === 'openrouter' && setup.key
    ? await this.aiBudgetFor({ provider: setup.provider, model: setup.text }, setup.key, capValue).catch(() => null)
    : null;
```

and in the reply:

```ts
      left: today?.remaining ?? null,
      limit: today?.limit ?? null,
```

`aiBudgetFor` (same file) returns:

```ts
return {
  left: today?.remaining,
  limit: today?.limit,
  visualReview: VISUAL_REVIEW_CALLS,
  pacing: { gapMs, concurrency, cap, price: price ?? undefined },
  limits: reported,
};
```

where its `today` is `await this.openRouter.freeRequestsToday(apiKey)` for the same provider and key.

## Change

1. In `handleAiEstimate`, delete the whole `const today = ... ;` statement (the five lines shown above, `const today =` through `: null;`).
2. In the reply, change the two fields to read from `budget`:

```ts
      left: budget?.left ?? null,
      limit: budget?.limit ?? null,
```

3. Check `today` is not used anywhere else in the method: `grep -n "today" packages/runner/src/server.ts` between the method's first and last line. (Other methods have their own `today` variables; leave those.)
4. Run `pnpm exec prettier --write packages/runner/src/server.ts` and `pnpm build`.

## Tests

Edit `packages/runner/tests/ai-estimate-cap.test.ts`. The `estimate(port, price, body)` helper builds the runner with a stub `openRouter` whose `freeRequestsToday` returns `{ remaining: 40, limit: 50 }`. Change the helper to also count calls: add a parameter or a module-level `let freeCalls = 0;` that the stub increments (`freeRequestsToday: async () => { freeCalls++; return { remaining: 40, limit: 50 }; }`), reset it at the start of `estimate`, and return it with the reply (for example return `{ ...reply, freeCalls }`, keeping the existing tests' reads working).

Add:

- Name: `'asks OpenRouter for today\'s free requests once'`. Call `estimate(3729, { prompt: 0, completion: 0 }, { maxPages: 30 })` (use a port no other test in the file uses; check with `grep -n "37[0-9][0-9]" packages/runner/tests/ai-estimate-cap.test.ts`). Expect `freeCalls` toBe `1`.
- Name: `'still reports what the key has left today'`. Same call; expect `r.left` toBe `40` and `r.limit` toBe `50`.

(`ai-estimate-cap.test.ts` is in the `runner` list of `BROWSER_TESTS`; it starts a `RunnerServer`. Run it by file name as below.)

Run: `pnpm exec vitest run packages/runner/tests/ai-estimate-cap.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "freeRequestsToday" packages/runner/src/server.ts` shows 3 lines (it showed 4 before), none of them inside `handleAiEstimate`.
- [ ] The new tests and the two existing ones in the file pass and `pnpm build` passes.

## Notes

- `aiBudgetFor` also calls `keyLimits` (a second request to the same `/key` endpoint). Merging those two is a larger change to `core`'s OpenRouter client. Not in this ticket.
- If `aiBudgetFor` fails, `budget` is null and `left` / `limit` become `null`. Before this ticket the estimate could still show them (its own call could succeed while the other failed). That is a rare double failure and the screen already handles `null`; accept it.
