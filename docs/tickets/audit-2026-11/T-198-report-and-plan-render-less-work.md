# T-198: Report area grades and Plan search do less work on every render

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | wizard | speed | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/ReportScreen.tsx`
- `packages/wizard/src/components/plan/PlanDocument.tsx`

**Do not build in parallel with:** T-184, T-185, T-190, T-194, T-195, T-200, T-203 (same files).

## Problem

1. `AspectGrades` (report) recomputes, for each of the six areas and on every render, `report.findings.filter((f) => data.findings.includes(f.id))` followed by `groupProblems` and three `mergeSameProblem` calls. With F findings and M ids per area that is O(F×M)×6, and the report re-renders on every map click and toggle.
2. In the Plan, each keystroke in "Find in the plan" updates `view`, which re-renders every section at once. A non-empty query also turns off list chunking (`ChunkedList`, line 280), so thousands of rows render per keystroke and typing lags.

## Current code

`packages/wizard/src/screens/ReportScreen.tsx:795-809` (branch `worktree-audit-cleanup`)

```tsx
function AspectGrades({ report }: { report: ReleaseReport }) {
  if (!report.grades) return null;
  return (
    <Section id="aspects" title="How each area did">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {ASPECTS.map((aspect) => {
          const data = report.grades!.aspects[aspect];
          const checked = !!data && data.checked !== false && data.grade !== null;
          const sub = aspect === 'Findable' ? data?.subBreakdown : undefined;
          const problems = checked ? groupProblems(report.findings.filter((f) => data.findings.includes(f.id))) : null;
          const problemCount = problems
            ? mergeSameProblem(problems['must-fix']).length +
              mergeSameProblem(problems['should-fix']).length +
              mergeSameProblem(problems.suggestion).length
            : 0;
```

`problems` is used only to compute `problemCount`; `problemCount` is used once, at line 821. `useMemo` is already imported on line 1.

`packages/wizard/src/components/plan/PlanDocument.tsx:1` and `:2007-2008`, `:2045`

```tsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
```

```tsx
export function PlanDocument({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const [view, setView] = useState<View>({ query: '', needsMe: false });
```

```tsx
    <ViewContext.Provider value={view}>
```

and further down, unchanged by this ticket:

```tsx
          <PlanFinder plan={plan} view={view} setView={setView} />
```

## Change

1. `ReportScreen.tsx`: replace the first line of `AspectGrades` (`if (!report.grades) return null;`) with:

```tsx
  // Counted once per report, not on every render: a set of ids instead of includes() per finding.
  const problemCounts = useMemo(() => {
    const counts = new Map<AspectType, number>();
    if (!report.grades) return counts;
    for (const aspect of ASPECTS) {
      const data = report.grades.aspects[aspect];
      if (!data || data.checked === false || data.grade === null) continue;
      const ids = new Set(data.findings);
      const problems = groupProblems(report.findings.filter((f) => ids.has(f.id)));
      counts.set(
        aspect,
        mergeSameProblem(problems['must-fix']).length +
          mergeSameProblem(problems['should-fix']).length +
          mergeSameProblem(problems.suggestion).length
      );
    }
    return counts;
  }, [report]);
  if (!report.grades) return null;
```

2. In the `ASPECTS.map` body, delete the `const problems = …` statement and replace the `const problemCount = …` statement with:

```tsx
          const problemCount = problemCounts.get(aspect) ?? 0;
```

3. `PlanDocument.tsx` line 1: add `useDeferredValue` to the React import:

```tsx
import React, { createContext, useContext, useDeferredValue, useEffect, useRef, useState } from 'react';
```

4. In `PlanDocument`, directly after the `useState<View>` line, add:

```tsx
  // The search box updates at once; the sections follow when the browser has time, so typing never lags.
  const deferredView = useDeferredValue(view);
```

5. Change the provider to `<ViewContext.Provider value={deferredView}>`. Leave `<PlanFinder … view={view} setView={setView} />` as it is: the input must show each keystroke immediately.

## Tests

No behaviour changes; existing tests cover both.

Run: `pnpm exec vitest run packages/wizard/tests/coverage-view.test.tsx packages/wizard/tests/plan-sources-view.test.ts packages/wizard/tests/intent-view.test.ts` then `pnpm build`.

## Done when

- [x] `AspectGrades` has no `includes(` inside a `filter` and computes counts in one `useMemo`.
- [x] The Plan's sections read `deferredView`; the search input still reads `view`.
- [x] The area cards show the same problem counts as before (compare one report by eye, or rely on `coverage-view.test.tsx`).
- [x] Tests and `pnpm build` pass.

## Notes

- `AspectType` is already imported as a type in `ReportScreen.tsx` (line 3). If `ASPECTS` is typed as a wider string array, use `Map<string, number>`.
- The hook must stay above the early `return null` (rules of hooks).
- `useDeferredValue` exists in React 18, which this package uses (`react ^18.3.1`).
