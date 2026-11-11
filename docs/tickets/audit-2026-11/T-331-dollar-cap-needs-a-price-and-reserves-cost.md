# T-331: A dollar cap is refused when no price is known, and cost is reserved before sending

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/ai-budget.ts`
- `packages/core/src/ai/model-prices.ts` (new)
- `packages/runner/src/run-inputs.ts`
- `packages/runner/src/session/checkup-run.ts`
- `packages/runner/src/server.ts`
- `packages/core/tests/ai-budget-dollar-cap.test.ts` (new)
- `packages/runner/tests/run-inputs-dollar-cap.test.ts` (new)

**Do not build in parallel with:** T-330 (edits `ai-budget.ts`); T-296, T-308, T-312, T-313, T-355, T-358, T-360 (all edit `checkup-run.ts`); T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-300, T-301, T-302, T-303, T-308, T-313, T-329, T-357 (all edit `server.ts`).

## Problem

The person can set a cap on a Check-up in dollars. The cap works only when the tool knows the model's price. `PacedAI.checkAllowed` tests `dollars !== undefined && this.price && this.spentUsd >= dollars` (`packages/core/src/plan/ai-budget.ts:189`): with no price, the dollar cap does nothing and the person is not told. The runner looks up a price only for OpenRouter (`packages/runner/src/server.ts:3414`), and `checkAiCap` accepts a dollar cap for any provider (`packages/runner/src/run-inputs.ts:86-90`). So a person who sets "$2" with an Anthropic, OpenAI or Gemini key has no limit at all.

Even with a price, the cap is checked only before a request starts and the cost is added after the answer (`ai-budget.ts` `tally`). With four requests in flight, all four start under the cap, so the spend can overshoot it.

## Owner decision (open)

What should happen when a dollar cap is set and no price is known for the model?

- **A. Refuse the dollar cap, and keep a small static price table for the paid providers' default models (recommended default).** The run is refused with a plain message ("Pick a request cap instead, or a model with a known price"). A person with a known model gets a working cap.
- **B. Accept it and show a warning in the wizard.** The cap still does nothing, but the person is told. Simpler, no table to keep current.
- **C. Offer a request cap only.** Remove the dollar field. Smallest code, loses a feature.

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`.

`packages/core/src/plan/ai-budget.ts` (`grep -n "spentUsd\|this.price" packages/core/src/plan/ai-budget.ts`): the check at line 189, the tally at ~308-311, `estimateUsd` at 77 (3000 prompt + 1500 completion tokens per request).

`packages/runner/src/server.ts` (`grep -n "modelPrice" packages/runner/src/server.ts`):

```ts
        // The price matters only for a dollar cap.
        if (cap?.dollars !== undefined && settings?.model) price = await this.openRouter.modelPrice(settings.model);
```

`packages/runner/src/session/checkup-run.ts:699` `const aiCap = checkAiCap(body.aiCap);` (T-360 makes a failed check throw).

## Change

1. New `packages/core/src/ai/model-prices.ts`: `export function knownPrice(provider: AIProviderType, model: string | undefined): { prompt: number; completion: number } | undefined`. A `Record` of US dollars per million tokens for the model ids in `DEFAULT_MODELS` (`packages/core/src/ai/default-models.ts`) for `anthropic`, `openai` and `gemini`, with a comment naming the date the prices were read from each provider's price page. `mock` returns `{ prompt: 0, completion: 0 }`. OpenRouter is not in the table (the runner asks OpenRouter). Unknown model: `undefined`. Do not guess a number: take each from the provider's published price page and cite the page in the comment.
2. `run-inputs.ts`: add `checkDollarCapPrice(cap: RunCap | undefined, provider: AIProviderType, price: unknown): Checked<RunCap | undefined>`. When `cap?.dollars !== undefined` and there is no price, return `bad('ERR_CAP_NO_PRICE', 'The dollar cap needs a known price for this model. Set a request cap instead, or choose a model with a known price.')`.
3. `server.ts` `aiBudgetFor`: for a non-OpenRouter provider, `price = knownPrice(settings.provider, settings.model) ?? null`. Return the price as before.
4. `checkup-run.ts` (where `aiCap` is checked, ~699): after `checkAiCap`, resolve the price (OpenRouter lookup or `knownPrice`) and refuse with `checkDollarCapPrice` before the run starts. Keep it in the same style as the other input refusals there.
5. `ai-budget.ts`: reserve cost before sending. Add `private reservedUsd = 0`. In `completeHolding`, when `this.price` and a dollar cap exist: before the request, `const reserve = estimateUsd(1, this.price)`; if `this.spentUsd + this.reservedUsd + reserve > dollars` throw `CapSpentError('dollars')`; add `reserve` to `reservedUsd`; subtract it in a `finally` after the request ends (answer or error). Keep the existing `spentUsd >= dollars` test too.
6. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- New `packages/core/tests/ai-budget-dollar-cap.test.ts` (unit, fake provider): with price and `cap.dollars` small, four parallel requests (concurrency 4) do not all start: the cap throws `CapSpentError('dollars')` for the ones that would overshoot, and `spentUsd` stays at or under the cap plus one request's real cost; the reservation is released after an error (a failed request does not lock the cap); with no dollar cap nothing changes.
- New `packages/runner/tests/run-inputs-dollar-cap.test.ts`: `checkDollarCapPrice` refuses a dollar cap with no price, accepts it with a price, accepts a request-only cap with no price; `knownPrice('anthropic', DEFAULT_MODELS.anthropic)` is defined and `knownPrice('openai', 'no-such-model')` is `undefined`.

Run: `pnpm exec vitest run packages/core/tests/ai-budget-dollar-cap.test.ts packages/runner/tests/run-inputs-dollar-cap.test.ts`, then the core and runner unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "ERR_CAP_NO_PRICE" packages/runner/src` finds the refusal and the check-up start uses it.
- [ ] `grep -n "reservedUsd" packages/core/src/plan/ai-budget.ts` finds the reservation.
- [ ] The new tests pass; `pnpm build` passes.

## Notes

- Audit finding M30 (audit of 11 Nov 2026 on `d225418`).
- `CONTEXT.md` (AI Request Budget) says the person can set a cap in requests or dollars; the wording stays true.
- Wizard text for the refusal is shown from the runner's message; no wizard file is edited.
- Related open tickets: T-330 (same file, builds first), T-360 (`checkup-run.ts` throws on a refused input), T-265 (OpenRouter price asked once).
