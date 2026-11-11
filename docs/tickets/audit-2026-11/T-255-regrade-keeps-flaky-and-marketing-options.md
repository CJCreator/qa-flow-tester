# T-255: Re-grading a report keeps the flaky count and the marketing flag

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/regrade.ts` (new)
- `packages/runner/src/server.ts`
- `packages/runner/tests/regrade.test.ts` (new)

**Do not build in parallel with:** T-258, T-259, T-260, T-261, T-265, T-267 (all edit `server.ts`, about 3,900 lines). Also any older or newer ticket that edits `server.ts`.

## Problem

The first grading of a Check-up passes three inputs to `calculateSiteAspectGrades`: the checks that ran, whether the marketing basics were checked (`marketingChecked`), and how many tests were flaky (`flakyCount`). Three later re-grades in `server.ts` pass only the checks that ran. So after a person marks a problem "Intended" or "False Positive", accepts a "Needs your judgement" item, or runs the AI visual review:

- the Works grade loses the flaky-test penalty (3 points per flaky test), so it can go up;
- the Findable "marketing" part loses its "Not checked" flag and shows as a pass.

The grades then differ from the first report for a reason the person did not cause.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "calculateSiteAspectGrades" packages/runner/src/server.ts`.

First grading, `packages/core/src/orchestrator.ts` (about line 1588):

```ts
const grades = calculateSiteAspectGrades(uniqueFindings, {
  checkersRun: results.flatMap((r) => (r.checks || []).map((c) => c.checker)),
  marketingChecked: marketingLog.homeRead,
  flakyCount: coverage.flakyFlows,
});
```

`flakyFlows` is kept in the report as `report.coverage.flakyFlows`. `marketingChecked` is not kept, but when it is false the scoring writes `checked: false` into `report.grades.aspects.Findable.subBreakdown.marketing` (see `packages/core/src/scoring.ts`, the `marketing: { ...calcSub(...), ...(options.marketingChecked === false ? { checked: false } : {}) }` line). So the first grading's answer can be read back from the saved grades.

`packages/runner/src/server.ts`, triage handler and accept-judgement handler (two places, same lines):

```ts
const ran = report.results.flatMap((r) => (r.checks || []).map((c) => c.checker));
report.grades = calculateSiteAspectGrades(report.findings, { checkersRun: ran });
report.recommendations = generateRankedRecommendations(report.findings);
```

`packages/runner/src/server.ts`, the visual review method (find with `grep -n "'ai-review'" packages/runner/src/server.ts`):

```ts
if (result.reviewedCount > 0) {
  const ran = report.results.flatMap((r) => (r.checks || []).map((c) => c.checker));
  report.grades = calculateSiteAspectGrades(report.findings, { checkersRun: [...ran, 'ai-review'] });
  report.recommendations = generateRankedRecommendations(report.findings);
}
```

## Change

1. Create `packages/runner/src/regrade.ts`:

```ts
import { calculateSiteAspectGrades, generateRankedRecommendations } from '@qa/core';
import type { CheckerType, ReleaseReport } from '@qa/types';

/**
 * Grades and recommendations again after the findings changed (triage, a judged item, the AI visual review).
 * Uses the same inputs as the first grading: the checks that ran, the flaky count, and whether the marketing
 * basics were checked (read back from the saved grades, which record `checked: false` for them).
 * `alsoRan` adds checks that ran after the report was made, such as 'ai-review'.
 */
export function regradeReport(report: ReleaseReport, alsoRan: CheckerType[] = []): void {
  const ran = report.results.flatMap((r) => (r.checks || []).map((c) => c.checker));
  report.grades = calculateSiteAspectGrades(report.findings, {
    checkersRun: [...ran, ...alsoRan],
    marketingChecked: report.grades?.aspects.Findable?.subBreakdown?.marketing?.checked !== false,
    flakyCount: report.coverage?.flakyFlows,
  });
  report.recommendations = generateRankedRecommendations(report.findings);
}
```

2. In `server.ts`, in the triage handler and the accept-judgement handler, replace the three lines shown above with:

```ts
regradeReport(report);
```

3. In `server.ts`, in the visual review method, replace the body of `if (result.reviewedCount > 0) { ... }` with:

```ts
regradeReport(report, ['ai-review']);
```

4. In `server.ts` add `import { regradeReport } from './regrade.js';` with the other relative imports. Then check whether `calculateSiteAspectGrades` and `generateRankedRecommendations` are still used in `server.ts`: `grep -n "calculateSiteAspectGrades\|generateRankedRecommendations" packages/runner/src/server.ts`. Remove from the `@qa/core` import list each name that now has no other use (expected: both).

5. Run `pnpm exec prettier --write packages/runner/src/regrade.ts packages/runner/src/server.ts packages/runner/tests/regrade.test.ts` and `pnpm build`.

## Tests

Add `packages/runner/tests/regrade.test.ts` (a unit test: no server, no browser):

```ts
import { describe, it, expect } from 'vitest';
import { calculateSiteAspectGrades } from '@qa/core';
import type { Finding, ReleaseReport } from '@qa/types';
import { regradeReport } from '../src/regrade.js';

const findings: Finding[] = [];
const results = [
  { testCaseId: 't1', checks: [{ checker: 'bug-detection', name: 'x', outcome: 'passed' }] },
] as unknown as ReleaseReport['results'];

function firstReport(): ReleaseReport {
  const grades = calculateSiteAspectGrades(findings, {
    checkersRun: ['bug-detection'],
    marketingChecked: false,
    flakyCount: 2,
  });
  return { findings, results, coverage: { flakyFlows: 2 }, grades } as unknown as ReleaseReport;
}
```

Tests (name: what to assert):

- `'regradeReport keeps the flaky-test penalty'`: `report = firstReport()`; `const before = report.grades!.aspects.Works.score`; `regradeReport(report)`; expect `report.grades!.aspects.Works.score` toBe `before`, and `before` toBeLessThan 100.
- `'regradeReport keeps the marketing part marked not checked'`: after `regradeReport(report)`, expect `report.grades!.aspects.Findable.subBreakdown?.marketing?.checked` toBe `false`.
- `'regradeReport treats a report with no recorded flag as checked'`: report with `grades: undefined`; after `regradeReport`, `grades.aspects.Findable.subBreakdown?.marketing?.checked` is `undefined`.
- `'regradeReport counts checks that ran later'`: `regradeReport(report, ['ai-review'])`; expect `report.grades!.aspects['Looks and reads well'].checked` toBe `true`.
- `'regradeReport rewrites the recommendations'`: set `report.recommendations = []` first; after the call expect it to be an array (`Array.isArray`).

Run: `pnpm exec vitest run packages/runner/tests/regrade.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -c "calculateSiteAspectGrades" packages/runner/src/server.ts` shows 0.
- [ ] `grep -c "regradeReport" packages/runner/src/server.ts` shows 4 (one import, three calls).
- [ ] The new test passes and `pnpm build` passes.

## Notes

- Not in this ticket: persisting `marketingChecked` as its own report field. Reading it back from the grades is enough and needs no type change.
- `regradeReport` mutates the report, like the code it replaces. Do not return a copy.
- If a test in `packages/runner/tests` fails because it expected the old grades after a triage, stop and set the ticket to `blocked` with the test name.
