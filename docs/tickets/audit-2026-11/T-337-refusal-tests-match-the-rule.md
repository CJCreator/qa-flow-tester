# T-337: The refusal browser tests set the page up the way the rule now reads it, and the evaluate results are checked

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | broken | todo |

**Files you may edit (no others):**

- `packages/checkers/tests/refusal-rule.test.ts`
- `packages/checkers/src/refusal-rule.ts`
- `packages/checkers/tests/refusal-guards.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

Two browser-tier tests fail on `main` and in the nightly run: `refusal rule in a page > a visible role=alert is a signal` (expected `[]` to include `'alert'`) and `SpecConformanceChecker refusal block > a different message is Major only when a message was stated` (expected `'Minor'` to be `'Major'`). The nightly run is red until this is fixed.

The rule is not broken. Commit `27acd13` (5 Nov, "refusal accuracy") changed the alert signal in `packages/checkers/src/refusal-rule.ts:86-89` so an alert counts only when its text is new since the baseline (a permanent banner is not a refusal). That is right, and the real callers do it that way: the orchestrator takes the baseline before the submit click (`packages/core/src/orchestrator.ts:872`). The two tests were written on 13 Oct and never updated. They load a page that already has the alert, take the baseline from that same page, and so the alert is "already there" and gives no signal (`refusal-rule.test.ts:56-60` through the `run()` helper at line 44-48, and `:180-193`). The second test then sees no refusal, so the accepted-form finding is Minor instead of the different-wording Major.

Separate and small: `captureRefusalBaseline` and `readRefusal` (`refusal-rule.ts:145`, `:150`) cast the `page.evaluate` result with `as`. A page that replaces `JSON` or throws in a getter can hand back anything. `readRefusal` is already wrapped in `.catch(() => null)` in `spec-conformance.ts:149-153`, so a guard that throws is handled there.

## Current code

Branch from `main`.

`packages/checkers/src/refusal-rule.ts` (`grep -n "baseline.errorTexts.includes\|as Promise<Refusal" packages/checkers/src/refusal-rule.ts`):

```ts
      return visible(el) && !!t && !baseline.errorTexts.includes(t);
...
  return page.evaluate(`(${CAPTURE_BASELINE_SOURCE})()`) as Promise<RefusalBaseline>;
...
  return page.evaluate(`(${REFUSAL_RULE_SOURCE})(${JSON.stringify(input)})`) as Promise<RefusalResult>;
```

`packages/checkers/tests/refusal-rule.test.ts` (`grep -n "const run = \|Something else" packages/checkers/tests/refusal-rule.test.ts`): the `run()` helper does `page.setContent(html)` then `captureRefusalBaseline(page)`, so everything in `html` is baseline.

## Change

1. `refusal-rule.ts`: add two exported guards above `captureRefusalBaseline`:
   - `isRefusalBaseline(v: unknown): v is RefusalBaseline` (object; `path` string; `records` finite number; `errorTexts` array of strings).
   - `isRefusalResult(v: unknown): v is RefusalResult` (object; `moved`, `newRecord`, `crashed` booleans; `signals` array whose items are all in `'invalid' | 'aria-invalid' | 'alert' | 'error-text'`; `errorText` absent or a string).
2. In `captureRefusalBaseline` and `readRefusal`, keep the evaluate result in a `const raw: unknown`, `if (!isRefusalBaseline(raw)) throw new Error('refusal baseline: the page returned an unexpected value')` (and the same for the result), then return it. Do not change `CAPTURE_BASELINE_SOURCE` or `REFUSAL_RULE_SOURCE`: the Playwright export embeds them (`core/src/plan/playwright-export.ts`) and `core/tests/refusal-parity.test.ts` guards that.
3. `refusal-rule.test.ts`: change the helper to `run(html, message?, probeOnly?, after?: (p: Page) => Promise<void>)`: set the content, take the baseline, run `after` if given, then read. Rewrite the alert case: set `<html><body><h1>Hi</h1><p>x</p></body></html>`, take the baseline, then `page.evaluate` to append `<div role="alert">Email is wrong</div>`, then read. Keep the assertions (`signals` contains `'alert'`, `errorText` is `'Email is wrong'`). Add a case that an alert present in the baseline gives no `'alert'` signal (this documents the rule).
4. Same file, `a different message is Major only when a message was stated`: set the page without the alert, take the baseline, append `<div role="alert">Something else</div>`, then run both checks as the test does now.
5. Check the other cases in the file that put an alert in the page before the baseline (`a new record means accepted`, `moving to another path means accepted`, `probeOnly looks only at ...`). Leave those that still assert what they mean (they assert "not refused", which the baseline-present alert also gives); say in the commit message which ones you changed and why.
6. Run `pnpm exec prettier --write` on the touched files.

## Tests

- `packages/checkers/tests/refusal-guards.test.ts` (new, unit tier, no browser): `isRefusalBaseline` accepts `{ path: '/a', records: 2, errorTexts: ['x'] }` and rejects `null`, `{}`, `records: NaN`, `errorTexts: [1]`. `isRefusalResult` accepts a full result with and without `errorText`, and rejects an unknown signal name, `signals: 'alert'`, and `moved: 'yes'`.
- `packages/checkers/tests/refusal-rule.test.ts` (browser tier, already listed in `BROWSER_TESTS` in `vitest.workspace.ts` as `refusal-rule`, so that file is not edited): the two repaired cases pass, plus the new "alert in baseline is not new" case.

Run: `pnpm exec vitest run packages/checkers/tests/refusal-guards.test.ts`, then `pnpm test:browser` filtered to `packages/checkers/tests/refusal-rule.test.ts` (it launches Chromium), then `pnpm exec vitest run --project unit packages/checkers/tests` and `packages/core/tests/refusal-parity.test.ts`, then `pnpm build`.

## Done when

- [ ] The two named browser tests pass; the nightly browser tier is green for `refusal-rule`.
- [ ] `grep -n "isRefusalResult\|isRefusalBaseline" packages/checkers/src/refusal-rule.ts` finds the guards and both `evaluate` calls use them; no `as Promise<Refusal` is left.
- [ ] `REFUSAL_RULE_SOURCE` and `CAPTURE_BASELINE_SOURCE` are unchanged (`git diff` shows no edit inside the template strings); `refusal-parity.test.ts` passes.
- [ ] `pnpm build` passes.

## Notes

- Audit finding H12 (part) and L9 (part) (audit of 11 Nov 2026 on `d225418`). The audit expected a rule regression; the history shows a deliberate rule change and tests that were not updated. The title of this ticket was changed to match.
- `packages/checkers/tests/refusal-baseline-unit.test.ts` (added with `27acd13`) already covers the baseline rule without a browser.
- The wizard landing-page browser failures are T-361, not this ticket.
