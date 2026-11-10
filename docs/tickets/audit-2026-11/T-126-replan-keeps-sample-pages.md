# T-126: "Re-plan everything" keeps the same Sample Pages

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | inconsistency | todo |

**Files you may edit (no others):**
- `packages/core/src/plan/replan.ts`
- `packages/core/tests/replan-coverage.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

The scan picks a Layout Group's Sample Pages as it goes: the **first three** pages of the group (`GroupTracker`).
Re-planning calls `currentCoverage`, which re-samples with `sampleLayoutGroups`: the **first, middle and last**
pages. So after "Re-plan everything" the Sample Pages of a group change, and pages the person already reviewed
as "tested" become "covered" (and the other way round) for no reason they can see.

## Current code

`packages/core/src/plan/replan.ts:31-39` (branch `worktree-audit-cleanup`)

```ts
/** How each page is covered now, keeping pages the person promoted or added. */
function currentCoverage(draft: DiscoveryDraft): Map<string, PageCoverageInfo> {
  const coverage = sampleLayoutGroups(draft.pages).coverage;
  for (const page of draft.plan?.pages || []) {
    if (page.coverage === 'promoted' || page.added)
      coverage.set(page.urlPath, { coverage: 'promoted', layoutGroup: page.layoutGroup });
  }
  return coverage;
}
```

`PageCoverageInfo` is exported from `packages/core/src/plan/sampling.ts`. Open that file and read the interface
before editing: it has `coverage`, and optional `layoutGroup` and `coveredBy`.

## Change

Replace the function with one that lets the existing Plan win for every page it already has:

```ts
/**
 * How each page is covered now. The Plan's own choice wins for every page it already holds (so the Sample
 * Pages of a Layout Group stay the same across a re-plan); only pages the Plan has not seen are sampled afresh.
 */
export function currentCoverage(draft: DiscoveryDraft): Map<string, PageCoverageInfo> {
  const coverage = sampleLayoutGroups(draft.pages).coverage;
  for (const page of draft.plan?.pages || []) {
    if (page.coverage === 'promoted' || page.added) {
      coverage.set(page.urlPath, { coverage: 'promoted', layoutGroup: page.layoutGroup });
    } else if (page.coverage) {
      coverage.set(page.urlPath, {
        coverage: page.coverage,
        ...(page.layoutGroup ? { layoutGroup: page.layoutGroup } : {}),
        ...(page.coveredBy?.length ? { coveredBy: page.coveredBy } : {}),
      });
    }
  }
  return coverage;
}
```

Note the added `export` (needed by the test). If `PageCoverageInfo` has no `coveredBy` field, leave that line
out. If `PlanPage` has no `coveredBy`, leave that line out too.

## Tests

Add `packages/core/tests/replan-coverage.test.ts`:

- Build a draft with seven pages of one shape: `/products/item-1` ... `/products/item-7` (objects cast with
  `as unknown as PageInventoryItem`, each `{ urlPath, title: 'P', links: [], interactiveElementsCount: 1, formsCount: 0, layoutGroup: 'layout-abc' }`).
- `draft.plan.pages`: items 1, 2, 3 with `coverage: 'sample'`; items 4-7 with `coverage: 'covered'`,
  `coveredBy: ['/products/item-1', '/products/item-2', '/products/item-3']`; all with `layoutGroup: 'layout-abc'`.
- Call `currentCoverage(draft as unknown as DiscoveryDraft)`.
- Expect `coverage.get('/products/item-1')?.coverage`, `item-2` and `item-3` to be `'sample'`, and
  `item-4` and `item-7` to be `'covered'`.
- Second case: a page in `draft.pages` that is **not** in `draft.plan.pages` (`/about`) still gets an entry
  (`coverage.has('/about')` is true).
- Third case: a page with `added: true` gets `'promoted'`.

Command: `pnpm exec vitest run packages/core/tests/replan-coverage.test.ts`, then `pnpm build`.

## Done when

- [ ] The three cases pass
- [ ] `pnpm build` passes

## Notes

Out of scope, recorded for the owner: "Re-plan everything" also drops the items that came from documents
(`docSource`, Denial Plan Items), because the parsed requirements and the crawls are not kept after the scan.
That needs a decision on where to keep them and has no ticket yet.
