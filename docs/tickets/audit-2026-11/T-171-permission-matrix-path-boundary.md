# T-171: a permission rule answers for a different path that only starts with the same letters

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | built |

**Files you may edit (no others):**
- `packages/checkers/src/permission-matrix.ts`
- `packages/checkers/tests/permission-matrix.test.ts`

**Do not build in parallel with:** none.

## Problem
`PermissionMatrixChecker.checkAccess` finds the rule for a path by exact match, then by longest prefix. The prefix test is a plain `startsWith`, so the rule for `/admin` also answers for `/administrator` and `/admin-help`. A Role allowed on `/admin-help` but denied on `/admin` gets a false Blocker, and the reverse hides a real leak.

The same file also holds `checkDirectUrlExposure`, which nothing calls except its own test (owner decision: unused code is deleted).

## Current code
`packages/checkers/src/permission-matrix.ts:72-77` (branch `worktree-audit-cleanup`)
```ts
    // Find rule for this target: an exact match first, then the longest prefix (so "/invoices/new"
    // is not answered by the "/invoices" rule when it has a rule of its own).
    const rule =
      this.matrix.find((r) => r.target === target) ??
      this.matrix.filter((r) => target.startsWith(r.target)).sort((a, b) => b.target.length - a.target.length)[0];
    if (!rule) return undefined;
```
`packages/checkers/src/permission-matrix.ts:142-186`: the whole method
```ts
  /**
   * Check direct URL access where a link is hidden in UI navigation but accessible via direct URL navigation
   */
  public checkDirectUrlExposure(params: {
    ...
  }): Finding | undefined {
    ...
  }
```

## Change
1. Add this function at module level, above `export class PermissionMatrixChecker`:
```ts
/** True when `target` is the rule's path or sits under it: "/admin" covers "/admin/users" and "/admin?tab=1", not "/administrator". */
function ruleCovers(ruleTarget: string, target: string): boolean {
  if (target === ruleTarget) return true;
  const base = ruleTarget.endsWith('/') ? ruleTarget : `${ruleTarget}/`;
  return target.startsWith(base) || target.startsWith(`${ruleTarget}?`) || target.startsWith(`${ruleTarget}#`);
}
```
2. Replace the rule lookup with:
```ts
    // Find rule for this target: an exact match first, then the longest rule whose path it sits under
    // (so "/invoices/new" is not answered by the "/invoices" rule when it has a rule of its own, and
    // "/administrator" is not answered by the "/admin" rule).
    const rule =
      this.matrix.find((r) => r.target === target) ??
      this.matrix.filter((r) => ruleCovers(r.target, target)).sort((a, b) => b.target.length - a.target.length)[0];
    if (!rule) return undefined;
```
3. Delete the whole `checkDirectUrlExposure` method with its doc comment. The class then ends after `checkAccess`.

## Tests
Edit `packages/checkers/tests/permission-matrix.test.ts`. The file builds `const checker = new PermissionMatrixChecker(csvMatrix)` from a CSV with the rows `/invoices`, `/invoices/new`, `/settings/billing`.

1. Delete the test `detects direct URL exposure when forbidden route is hidden from UI but reachable` (it tests the deleted method).
2. Add a test with its own matrix:
```ts
  it('a rule covers its own path and what sits under it, not a path that only shares its first letters', () => {
    const m = new PermissionMatrixChecker(`
target,admin,member
/admin,allow,deny
`);
    // Under the rule: member is denied, so a 200 is a leak.
    expect(m.checkAccess({ target: '/admin/users', role: 'member', statusCode: 200 })).toBeDefined();
    expect(m.checkAccess({ target: '/admin?tab=1', role: 'member', statusCode: 200 })).toBeDefined();
    // Not under the rule: no rule applies, so nothing is reported.
    expect(m.checkAccess({ target: '/administrator', role: 'member', statusCode: 200 })).toBeUndefined();
    expect(m.checkAccess({ target: '/admin-help', role: 'member', statusCode: 200 })).toBeUndefined();
  });

  it('the longer rule wins over the shorter one', () => {
    // /invoices allows member, /invoices/new denies member (see csvMatrix above).
    expect(checker.checkAccess({ target: '/invoices/new', role: 'member', statusCode: 200 })).toBeDefined();
    expect(checker.checkAccess({ target: '/invoices/new/step-2', role: 'member', statusCode: 200 })).toBeDefined();
    expect(checker.checkAccess({ target: '/invoices/42', role: 'member', statusCode: 200 })).toBeUndefined();
  });
```
3. Run: `pnpm exec vitest run packages/checkers/tests/permission-matrix.test.ts packages/checkers/tests/spec-denial.test.ts`

## Done when
- [x] `checkDirectUrlExposure` no longer exists anywhere under `packages/` (check with Grep).
- [x] New tests pass; the remaining existing tests pass unchanged.
- [x] `pnpm build` passes.

## Notes
- If the matrix parser in this file writes the CSV header differently from the test above, copy the header format from the file's existing `csvMatrix`.
- Out of scope: wildcard or regular-expression rule paths.
