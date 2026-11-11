# T-285: Wizard: delete four unused Plan translation functions and their tests

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | wizard | dead-code | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/plan-translate.ts`
- `packages/wizard/tests/translate.test.ts`
- `packages/wizard/tests/plan-sources-view.test.ts`

**Do not build in parallel with:** T-164 and T-198 (they only run `translate.test.ts` and `plan-sources-view.test.ts`; build this one first). T-203 is already built and left these functions in place on purpose.

## Problem

Four exported functions in `lib/plan-translate.ts` are called by nothing except each other and two tests: `flowToJourney`, `defaultSiteWideChecks`, `groupPagesBySectionAndLayout` and `translateReviewPlan`. A private helper `defaultReasonForFlow` is used only by `flowToJourney`. The owner's standing rule for unused code is "delete everything", including its tests.

Checked with grep over `packages/` (no matches in any `src` file outside `plan-translate.ts`; `lib/translate.ts` only re-exports the whole module with `export *`, so no name is listed there):

- `flowToJourney`, `defaultSiteWideChecks`, `groupPagesBySectionAndLayout`: only in `plan-translate.ts`.
- `translateReviewPlan`: `plan-translate.ts`, `tests/translate.test.ts`, `tests/plan-sources-view.test.ts`.

## Current code

Find with `grep -n "flowToJourney\|defaultSiteWideChecks\|groupPagesBySectionAndLayout\|translateReviewPlan\|defaultReasonForFlow" packages/wizard/src/lib/plan-translate.ts`.

`packages/wizard/src/lib/plan-translate.ts`: the file ends with `expectationsToChecks`, then (from the blank line after its closing brace, about line 227, to the end of the file at line 347) these five items: `function defaultReasonForFlow`, `export function flowToJourney`, `export function defaultSiteWideChecks`, `export function groupPagesBySectionAndLayout`, `export function translateReviewPlan`, each with its doc comment.

The top of the file:

```ts
import type {
  DiscoveredFlow,
  PageInventoryItem,
  PlanCheck,
  PlanJourney,
  PlanPageGroup,
  PlanSiteWideCheck,
  ReviewPlan,
  TestCaseExpectations,
  TestCaseStep,
  ValidationRule,
} from '@qa/types';
import { looksTechnical } from './translate.js';
```

`packages/wizard/tests/translate.test.ts`: import list has `translateReviewPlan,` (line 10) and a block `describe('translateReviewPlan (Task 1.3)', () => { ... });` (lines 174 to 259), followed by `describe('plainTitle (M6 gap fixes)'`.

`packages/wizard/tests/plan-sources-view.test.ts`: line 18 `import { translateReviewPlan } from '../src/lib/translate';` and this test inside `describe('plan Source view helpers'`:

```ts
  it('keeps the new plan fields through the translation helper', () => {
    const plan = translateReviewPlan({
      flows: [],
      ...
    expect(plan.plannedWhileCrawling).toBe(true);
  });
```

## Change

1. `plan-translate.ts`: delete everything from the blank line after the `expectationsToChecks` function's closing `}` to the end of the file (the five items above and their doc comments). The file must end with the `}` of `expectationsToChecks` and one newline.
2. `plan-translate.ts`: replace the type import with only what is still used (`PlanCheck`, `TestCaseExpectations`, `TestCaseStep`, `ValidationRule`):

```ts
import type { PlanCheck, TestCaseExpectations, TestCaseStep, ValidationRule } from '@qa/types';
import { looksTechnical } from './translate.js';
```

Keep the `looksTechnical` import: it is used elsewhere in the file. Do not touch `packages/types`: the types `PlanJourney`, `PlanPageGroup` and `PlanSiteWideCheck` stay. 3. `translate.test.ts`: delete the line `  translateReviewPlan,` from the import list, and delete the whole `describe('translateReviewPlan (Task 1.3)', ...)` block with the blank line after it. 4. `plan-sources-view.test.ts`: delete the import on line 18 and the `it('keeps the new plan fields through the translation helper', ...)` test. Leave the other tests and the `nf` helper. 5. Run `pnpm exec prettier --write packages/wizard/src/lib/plan-translate.ts packages/wizard/tests/translate.test.ts packages/wizard/tests/plan-sources-view.test.ts`.

## Tests

No new test. The deleted tests covered only the deleted code. Run:

`pnpm exec vitest run packages/wizard/tests/translate.test.ts packages/wizard/tests/plan-sources-view.test.ts packages/wizard/tests/plan-translate.test.ts`

(If `plan-translate.test.ts` does not exist, drop it from the command; `ls packages/wizard/tests | grep plan-translate`.) Then `pnpm build`.

## Done when

- [ ] `grep -rn "flowToJourney\|defaultSiteWideChecks\|groupPagesBySectionAndLayout\|translateReviewPlan\|defaultReasonForFlow" packages --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist` prints nothing.
- [ ] `stepToSentence`, `expectationsToChecks` and `cleanSelectorWords` are still exported from `plan-translate.ts` (`PlanDocument.tsx` and `intent-view.ts` import them).
- [ ] The tests above and `pnpm build` pass.

## Notes

- Out of scope: `buildProductContext` and `hasNonDefaultOptions` (T-286).
- If the build says a name is "declared but never used" in `plan-translate.ts`, remove that name from the type import. Do not add `_` prefixes.
