# T-333: Visual review validates the AI's answer, and a failed journeys repair keeps the first answer

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/ai/visual-review.ts`
- `packages/core/src/plan/journeys.ts`
- `packages/core/tests/visual-review.test.ts`
- `packages/core/tests/journeys-repair.test.ts` (new)

**Do not build in parallel with:** T-251 (edits `visual-review.ts`); T-334 (edits `journeys.ts`).

## Problem

**Visual review.** `reviewSingleScreen` reads the AI's answer with `JSON.parse` and returns `[]` for anything it cannot read (`packages/core/src/ai/visual-review.ts:176-186`). A cut-off answer (`finishReason: 'length'`) or a broken one is then counted as "reviewed, nothing found", so the report says the AI looked at the screen when it did not. The prompt asks for at most 3 issues but the code keeps every one. The fields of an issue are used as they are: a missing `what` makes the finding title `[AI Review] undefined`, a wrong `breakpoint` ties the finding to no screenshot.

**Journeys.** `planJourneys` already keeps the first answer when the repair answer cannot be parsed (`journeys.ts:300-306`). But the repair request itself is not guarded: if it throws (a network error, a 503) the outer `catch` at ~line 310 sends every journey to fixed rules and drops a first answer that was usable apart from some bad steps.

## Current code

Branch from `main`.

`grep -n "return Array.isArray(parsed" -B8 -A4 packages/core/src/ai/visual-review.ts`:

```ts
      return Array.isArray(parsed?.issues) ? parsed.issues : [];
    } catch {
      return [];
    }
```

`grep -n "const repair = await completeWith" -A22 packages/core/src/plan/journeys.ts`: the repair call, then `if (repair.finishReason === 'length' && !firstParse) throw new AITruncatedError(...)`, then the inner `try { flows = parseFlows(repairText) } catch ... flows = firstParse`.

`parseJsonAnswer` (`packages/core/src/plan/ai-planner.ts:229`) already strips fences and trailing commas.

## Change

1. `visual-review.ts`: `reviewSingleScreen` uses `completeWith(...)` result as `answer`. If `answer.finishReason === 'length'`, or `parseJsonAnswer(answer.text)` throws, or the parsed value has no `issues` array, return the marker `'unusable'` (change the return type to `VisualReviewIssue[] | null | 'unusable'`).
2. Validate each issue: keep it only when `what`, `why` and `suggestedImprovement` are non-empty strings and `breakpoint` is one of `'375px' | '768px' | '1440px'`; `selector` only when a string; `severity` is clamped as today. Keep the first 3 valid issues.
3. In the screen loop, an `'unusable'` answer is handled like a failed request: set `stoppedBy = new Error('The AI's answer for this screen could not be read.')` and `break`, so the screen stays in `remainingScreens` and is not counted in `reviewedCount`. (An empty `issues` array from a valid answer still counts as reviewed.)
4. `journeys.ts`: wrap the repair `completeWith` call and the cut-off check in `try`. On a thrown error: `if (firstParse) { return finish(firstParse (with the empty-fill backfill below it), false, false); } throw repairErr;`. To avoid copying the backfill loop, move it into a local `function backfill(flows)` used by both exits.
5. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- `packages/core/tests/visual-review.test.ts` (existing mock provider style): (a) an answer with `finishReason: 'length'` is not counted as reviewed and the screen is in `remainingScreens`; (b) text that is not JSON gives the same; (c) five issues in the answer give three findings; (d) an issue with no `what` or a `breakpoint` of `"2000px"` is dropped; (e) `{"issues": []}` is still counted as reviewed.
- New `packages/core/tests/journeys-repair.test.ts` (fake provider): first answer parses but has a bad step, the repair call throws; `planJourneys` returns the first answer's journeys with `usedFallback` false. When the first answer cannot be parsed and the repair throws, the fixed-rule fallback still runs.

Run: `pnpm exec vitest run packages/core/tests/visual-review.test.ts packages/core/tests/journeys-repair.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "unusable" packages/core/src/ai/visual-review.ts` finds the marker and the loop handling.
- [ ] `grep -n "catch (repairErr\|backfill" packages/core/src/plan/journeys.ts` finds the guarded repair.
- [ ] The tests pass; `pnpm build` passes.

## Notes

- Audit finding M32 (audit of 11 Nov 2026 on `d225418`).
- Related open tickets: T-251 (deletes unused members in `visual-review.ts`; different lines), T-334 (one `guessFillValue`, same `journeys.ts`).
- The `ai-planner.ts` import of `parseJsonAnswer` into `visual-review.ts` stays inside `core`; it adds no Node code to the wizard bundle.
