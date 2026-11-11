# T-251: Delete six unused members in core and types

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | core | dead-code | todo |

**Files you may edit (no others):**

- `packages/core/src/findings-contract.ts`
- `packages/core/tests/findings-contract.test.ts`
- `packages/core/src/send-guard.ts`
- `packages/core/tests/send-guard.test.ts`
- `packages/core/src/browser.ts`
- `packages/core/tests/multi-browser-network.test.ts`
- `packages/core/src/plan/build.ts`
- `packages/types/src/review-plan.ts`
- `packages/types/src/run-report.ts`
- `packages/core/src/navigate.ts`
- `packages/core/src/ai/visual-review.ts`

**Do not build in parallel with:** T-249 (edits `findings-contract.ts` and its test).

## Problem

Left over from T-135, which listed these as "used only by tests, or never read". Owner's standing decision for unused code: delete.

| Member | What uses it today |
|---|---|
| `parseKnownFindings` (`findings-contract.ts`) | Its own tests only. `buildKnownFindings` writes `known-findings.json`; nothing reads it back. |
| `SendGuard.sentBySteps` | One test only. |
| `browserEngineLabel` (`browser.ts`) | One test only (a browser-tier test). |
| `usedFallbackDiscovery` on `ReviewPlan` and `ReleaseReport` | `build.ts` sets the `ReviewPlan` one. Nothing reads either. The report one is never set. |
| `NavigateResult.settled` | Set by `navigateWithRetry`, read by nobody. (The separate `settlePage` return value is used by its own test and stays.) |
| `VisualReviewResult.aiModel` | Never set, never read. |

Not here: `RunOptions.updateBaselines` (T-252, it needs an owner decision).

## Current code

Branch from `main`. First verify, each grep must show only the lines named in the Change below:

```
grep -rn "parseKnownFindings\|sentBySteps\|browserEngineLabel\|usedFallbackDiscovery" packages --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist
grep -rn "\.settled\b" packages --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist
grep -rn "aiModel\b" packages/core --include=*.ts --exclude-dir=node_modules --exclude-dir=dist
```

(`aiModel` also appears as `body.aiModel` in the runner and `aiModels` elsewhere; only `visual-review.ts:32` is this member.)

Shapes, found with `grep -n` on the names:

`send-guard.ts`:

```ts
  sentBySteps(): number[] {
    return [...this.steps].sort((a, b) => a - b);
  }
```

`browser.ts`: `export function browserEngineLabel(engine: BrowserEngine): string { switch (engine) { ... } }` with a doc comment `/** PRD FR-1.4 multi-browser engine display label. */`. The `BrowserEngine` type above it stays.

`plan/build.ts`: the line `usedFallbackDiscovery: draft.usedFallbackSynthesis,` in the object `buildReviewPlan` returns.

`types/src/review-plan.ts`:

```ts
  /** True if the generic template fallback was used because AI discovery failed. */
  usedFallbackDiscovery?: boolean;
```

`types/src/run-report.ts`:

```ts
  /** True when this run's test cases came from the generic template fallback, not real AI-driven discovery. */
  usedFallbackDiscovery?: boolean;
```

`navigate.ts`: `NavigateResult` has `/** Idle/links condition met before the cap */ settled: boolean;`. `navigateWithRetry` has `const { settled, linkCount } = await settlePage(...)`, and sets `settled,` in the success result, and `settled: false,` in two failure results.

`ai/visual-review.ts`: `VisualReviewResult` has the line `aiModel?: string;`.

## Change

1. `findings-contract.ts`: delete `parseKnownFindings` and its doc comment (from `/** Reads known-findings.json text back...` to the closing `}` of the function). Keep `KnownFinding` and `KnownFindings` (they type `buildKnownFindings`). In `findings-contract.test.ts` remove `parseKnownFindings` from the import, delete the test `'parseKnownFindings returns null on garbage'`, and in `'parseKnownFindings reads back what buildKnownFindings wrote; fingerprints unique and sorted'` delete the last line (`expect(parseKnownFindings(...)).toEqual(known);`) and rename the test to `'buildKnownFindings lists active findings once, sorted by fingerprint'`.
2. `send-guard.ts`: delete `sentBySteps`. In `send-guard.test.ts` delete the test `'send guard: records which click step sent'`. If `clickStarted` is then only used by `noteRequest`'s own state, leave it (it is used by the orchestrator).
3. `browser.ts`: delete `browserEngineLabel` with its comment. In `multi-browser-network.test.ts` remove it from the import and delete the test `'formats PRD-compliant labels for multi-browser engines (FR-1.4)'`.
4. `plan/build.ts`: delete the `usedFallbackDiscovery:` line. `types/src/review-plan.ts` and `types/src/run-report.ts`: delete the field and its doc comment.
5. `navigate.ts`: delete the `settled` field of `NavigateResult` with its comment. In `navigateWithRetry` change `const { settled, linkCount } = await settlePage(` to `const { linkCount } = await settlePage(`, delete `settled,` from the success result and `settled: false,` from the two failure results. `settlePage` itself is not changed.
6. `ai/visual-review.ts`: delete `aiModel?: string;`.
7. Run `pnpm exec prettier --write` on the edited files, then `pnpm build`.

## Tests

No new test. The build and type-check prove nothing else used them:

- `pnpm build` (types first, then the rest)
- `pnpm typecheck`
- `pnpm exec vitest run packages/core/tests/findings-contract.test.ts packages/core/tests/send-guard.test.ts packages/core/tests/navigate-settle.test.ts`
- `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests packages/types/tests` (all four packages have a `tests` folder)

`multi-browser-network.test.ts` is browser-tier (Chromium). Do not run it here; edit it by reading and let the nightly run it.

## Done when

- [ ] `grep -rn "parseKnownFindings\|sentBySteps\|browserEngineLabel\|usedFallbackDiscovery" packages --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist` prints nothing.
- [ ] `grep -n "settled" packages/core/src/navigate.ts` shows only the `settlePage` function and its caller's destructuring is gone (no `settled,` property line in any `NavigateResult`).
- [ ] `pnpm build`, `pnpm typecheck` and the unit tests pass.

## Notes

- `draft.usedFallbackSynthesis` (`types/src/discovery.ts`, set in `discovery-agent.ts` and `replan.ts`) was only read by the `build.ts` line removed here, so it is now write-only. It is not deleted here: `replan.ts` belongs to T-245. A later ticket can remove it.
- A stored report or Plan file that still has `usedFallbackDiscovery` in its JSON loads fine: the field was optional and nothing validates unknown keys.
- If `pnpm typecheck` finds a use this ticket missed (a wizard fixture, for example), delete that use and list it in the PR.
