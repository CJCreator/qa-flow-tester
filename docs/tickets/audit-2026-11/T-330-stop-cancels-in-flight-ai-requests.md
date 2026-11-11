# T-330: Stop cancels AI requests already in flight

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/ai-budget.ts`
- `packages/core/tests/ai-budget-stop.test.ts` (new)

**Do not build in parallel with:** T-331 (edits `ai-budget.ts`).

## Problem

When the person presses Stop, `PacedAI` refuses new requests, but a request already sent keeps running until the AI service answers or the 120 s deadline passes. `completeHolding` calls the provider without any abort signal (`packages/core/src/plan/ai-budget.ts:251`). The planner and the journey planner pass no signal either (`ai-planner.ts` and `journeys.ts` call `completeWith(ai, ...)` on the `PacedAI`, so one fix in `PacedAI` covers them). The provider code does accept a signal (`requestSignal` in `packages/core/src/ai/timeout.ts` combines the caller's `signal` with the deadline).

Up to four requests can be in flight at once (`MAX_CONCURRENCY`, `ai-budget.ts`). So Stop holds the single run slot for up to 120 s while the tool waits for answers it will throw away, and the AI key keeps spending.

## Current code

Branch from `main`.

`packages/core/src/plan/ai-budget.ts` (`grep -n "completeWith(this.inner" packages/core/src/plan/ai-budget.ts`):

```ts
      const model = options.model ?? this.model;
      let result: AICompletion;
      try {
        result = await completeWith(this.inner, messages, model ? { ...options, model } : options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/\b429\b|rate.?limit/i.test(message)) {
          this.outcome(model, 'failed');
          throw err;
        }
```

`AICompletionOptions.signal` already exists (`packages/types/src/ai.ts:79`).

## Change

1. In `completeHolding`, build one signal from the two stop signals and pass it to the provider:

```ts
const stops = [this.signal, this.finishSignal].filter((s): s is AbortSignal => !!s);
const sent: AICompletionOptions = {
  ...options,
  ...(model ? { model } : {}),
  ...(stops.length > 0 ? { signal: options.signal ? AbortSignal.any([options.signal, ...stops]) : AbortSignal.any(stops) } : {}),
};
result = await completeWith(this.inner, messages, sent);
```

2. In the `catch`, before the 429 test: if a stop signal is aborted, give the request back and throw the stop error, so an abort is not counted as a failed model and is not retried:

```ts
if (this.signal?.aborted) { this.used--; stopIfAborted(this.signal); }
if (this.finishSignal?.aborted) { this.used--; throw new StoppedEarlyError(); }
```

3. Import `AICompletionOptions` from `@qa/types` if the file does not already.
4. Run `pnpm exec prettier --write` on the two files, then `pnpm build`.

## Tests

New `packages/core/tests/ai-budget-stop.test.ts` (unit, fake provider; model it on `ai-budget-pacing.test.ts`):

- A fake provider whose `complete` waits for `options.signal` to abort and then rejects. Start a request, abort the `signal` given to `PacedAI`, and expect the call to reject at once (inside 100 ms) with the abort error, and `paced.used` back at 0.
- The same with `finishSignal`: the call rejects with `StoppedEarlyError`.
- With no stop signals the provider gets no `signal` (an unchanged call still works).
- A caller's own `options.signal` is still honoured next to the stop signals.

Run: `pnpm exec vitest run packages/core/tests/ai-budget-stop.test.ts packages/core/tests/ai-budget-pacing.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "AbortSignal.any" packages/core/src/plan/ai-budget.ts` finds the signal passed to `completeWith`.
- [ ] The new test fails on the old code and passes on the new.
- [ ] `pnpm build` passes.

## Notes

- Audit finding M29 (audit of 11 Nov 2026 on `d225418`).
- `AbortSignal.any` is available on Node 22, which the tool requires.
- Related open ticket: T-331 also edits `ai-budget.ts` and builds after this one.
