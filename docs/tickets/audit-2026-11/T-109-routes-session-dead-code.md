# T-109: Delete dead exports and unreachable branches in runner routes and session

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | runner | dead-code | built |

**Files you may edit (no others):**
- `packages/runner/src/routes/audit-share.ts`
- `packages/runner/src/routes/plan.ts`
- `packages/runner/src/routes/audit-helpers.ts`
- `packages/runner/src/routes/audit-crawl.ts`
- `packages/runner/src/helpers/audit-limit.ts`
- `packages/runner/src/session/report-store.ts`
- `packages/runner/src/session/checkup-run.ts`

**Do not build in parallel with:** T-95, T-98, T-102, T-103, T-104, T-111, T-112 (they edit the same files). Build after them.

## Problem

Seven small leftovers that nothing uses. Each was checked with a repo-wide search on branch `worktree-audit-cleanup`.

## Current code and change

Do the items in order. Run `pnpm build` after each.

### 1. `routes/audit-share.ts:73`: duplicate constant

```ts
export const PREVIEW_FILE_NAME = 'preview.html';
```

`@qa/core` exports the same constant and `routes/audit-preview.ts` already imports it from there. Nothing imports the runner's copy.

Change: delete the line. Add `PREVIEW_FILE_NAME` to the existing `import { ... } from '@qa/core';` in `audit-share.ts` (add that import if the file has none). The use at line 333 stays.

### 2. `routes/plan.ts:163-173`: re-exports nobody imports

```ts
export {
  emptyPlan,
  buildPlan,
  testsFor,
  screenSizesOf,
  gradedChecksFor,
  siteMapOf,
  handCheckNotes,
  defaultTestCase,
  type PlanBuildContext,
};
```

Check first: `grep -rnE "(emptyPlan|buildPlan|testsFor|screenSizesOf|gradedChecksFor|siteMapOf|handCheckNotes|defaultTestCase|PlanBuildContext)" packages/runner/src packages/runner/tests --include=*.ts | grep "routes/plan"` must show only lines inside `routes/plan.ts` itself. If another file imports one of them from `routes/plan`, keep that name in the block.

Change: delete the block (or the unused names). Then remove from the imports of `plan.ts` every name ESLint reports as unused: `pnpm exec eslint packages/runner/src/routes/plan.ts 2>&1 | grep "never used"`.

### 3. `routes/audit-helpers.ts:222`: alias with no user

```ts
export const createAuditHelperRoutes = auditHelperRoutes;
```

Change: delete the line.

### 4. `helpers/audit-limit.ts`: unused constant and method

Line 12:

```ts
export const AUDIT_DAILY_LIMIT_ERROR = 'Daily limit of audit starts reached for today.';
```

Line 49: the method `reset(): void { ... }` of `AuditDailyLimiter`.

Check: `grep -rn "AUDIT_DAILY_LIMIT_ERROR\|\.reset()" packages/runner/src packages/runner/tests | grep -v "helpers/audit-limit.ts"`. For `AUDIT_DAILY_LIMIT_ERROR` zero hits are expected. For `.reset()` ignore hits on other objects (`vi.fn().mockReset`, fake timers); a hit counts only on an `AuditDailyLimiter`.

Change: delete the constant if it is not used inside `audit-limit.ts` itself (if the class uses it, keep it and remove only the `export` keyword). Delete `reset()` on zero hits.

### 5. `session/report-store.ts:26` and `:82-84`: `siteDirFor`

```ts
  /** Today's `siteDir`: the per-site memory/history folder. */
  siteDirFor(): string;
```

```ts
  siteDirFor(): string {
    return path.join(this.paths.dataDir, 'sites');
  }
```

No caller. It also returns the shared folder, not the per-visitor one, so it would be wrong on a beta copy.

Change: delete the interface member with its comment, and the method. If a test double implements `ReportStore` and the build complains, remove it there too (add that file to your notes).

### 6. `routes/audit-crawl.ts:167-172`: unreachable branch in `getRunningInfo`

```ts
  if (slot.running) {
    return slot.running;
  }
  if (slot.kind === 'audit') {
    return {
      kind: 'audit',
      href: '/audits',
    };
  }
```

`RunSlot.running` is non-null whenever `RunSlot.kind` is `'audit'`, so the second `if` can never be true.

Change: delete the second `if` block (six lines). Keep the first `if` and the final `return`.

### 7. `session/checkup-run.ts:672`: unused variable

```ts
      const { readOnly, signInConsent: consent, testCopy: testHost, owner } = authorization;
```

ESLint: `'owner' is assigned a value but never used`.

Change: remove `, owner` from the destructuring.

## Tests

No new test. Run: `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build` and `pnpm typecheck`.

## Done when

- [x] All seven items are done, or listed in your notes with the hit that kept them.
- [x] `pnpm exec eslint packages/runner/src 2>&1 | grep -c "never used"` is lower than before and has no entry for the names above.
- [x] Runner unit tests, `pnpm build` and `pnpm typecheck` pass.

## Notes

- Not in this ticket (needs an owner decision): the `GET /s` prefix row at `routes/audit-share.ts:420` is built but never registered. `docs/API.md` is corrected in T-107 instead.
- Not in this ticket: the `toPlanContext` fallback in `routes/plan.ts` (it is unreachable today, but removing it changes a signature used by tests).
- Delete only. Do not refactor.
