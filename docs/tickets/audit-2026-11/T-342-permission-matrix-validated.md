# T-342: The permission matrix is validated, and a load error is shown

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/permission-matrix.ts`
- `packages/core/src/orchestrator.ts`
- `packages/checkers/tests/permission-matrix.test.ts`

**Do not build in parallel with:** T-247, T-252, T-309, T-310, T-312, T-316, T-318, T-329, T-358 (all edit `orchestrator.ts`).

## Problem

A permission matrix written in a CSV or YAML file is read without checking it, and a mistake turns into a false Blocker or a crash.

- CSV cells (`packages/checkers/src/permission-matrix.ts:56`): `parts[r + 1]?.toLowerCase() === 'allow' ? 'allow' : 'deny'`. `yes`, `true`, `Allowed`, or an empty cell all become `deny`. A role that is allowed on a page then gets a Blocker "Permission Leak" when it opens that page. A person who wrote a correct matrix in their own words is told their app has a security hole.
- YAML (`:29-35`): `return parsed as PermissionMatrix` with no check. A rule with no `roles` makes `rule.roles[role]` throw a `TypeError` at `:87`, in the middle of a run. `YAML.parse` is not wrapped, so bad YAML throws a raw parser error.
- The choice between YAML and CSV is `trimmed.includes(':')` (`:29`), so a CSV with a colon in a path (`/search?q=a:b`) takes the YAML branch.
- The orchestrator (`packages/core/src/orchestrator.ts:536-538`) catches any load error and prints "Could not load permission matrix from <file>" with no cause, so the person cannot tell whether the file is missing or wrong. A matrix passed as an object (`:531`) is not inside the `try` at all.

## Current code

Branch from `main`.

`packages/checkers/src/permission-matrix.ts` (`grep -n "includes(':')\|as PermissionMatrix\|=== 'allow'" packages/checkers/src/permission-matrix.ts`):

```ts
    if (trimmed.startsWith('-') || trimmed.includes(':')) {
      const parsed = YAML.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed as PermissionMatrix;
...
        const val = parts[r + 1]?.toLowerCase() === 'allow' ? 'allow' : 'deny';
```

`packages/core/src/orchestrator.ts` (`grep -n "Could not load permission matrix" packages/core/src/orchestrator.ts`):

```ts
      } catch (err) {
        console.warn(`[QA Orchestrator] Could not load permission matrix from ${options.profile.permissionMatrixFile}`);
```

## Change

1. `permission-matrix.ts`: add `export class PermissionMatrixError extends Error {}` and `export function validatePermissionMatrix(value: unknown): PermissionMatrix`. It throws a `PermissionMatrixError` with a message naming the rule number when: the value is not an array; a rule is not an object; `target` is not a non-empty string; `roles` is not an object; a role value is not `'allow'` or `'deny'` after lower-casing and mapping `yes|true|y|1` to `allow` and `no|false|n|0` to `deny`. It returns normalised rules (lower-cased `allow`/`deny`).
2. CSV cells: map the same words. An empty cell means "no expectation for this role": leave the role out of `roles` (`checkAccess` already returns nothing for a role without an entry, `:88`). Any other word throws a `PermissionMatrixError` naming the line, the role column and the cell text. Reject a header with fewer than two columns, and a row with more cells than the header.
3. Format choice: treat the text as YAML only when the first non-blank line starts with `-`, `[`, or `---`. Everything else is CSV.
4. Wrap `YAML.parse` in `try/catch` and rethrow as `PermissionMatrixError('The permission matrix is not valid YAML: ' + message)`. Run the result through `validatePermissionMatrix`.
5. The constructor: when given an object matrix, run it through `validatePermissionMatrix` too. Errors propagate.
6. `orchestrator.ts:529-539`: put both the object and the file path in one `try`. In the `catch`, log `[QA Orchestrator] Could not load the permission matrix${file ? ' from ' + file : ''}: ${err instanceof Error ? err.message : String(err)}`. The run goes on without the permission checks, as today, but the cause is in the log. Use `console.warn` as now.
7. Run `pnpm exec prettier --write` on the three files.

## Tests

In `packages/checkers/tests/permission-matrix.test.ts` (unit tier, extend the existing file; keep the current cases):

- CSV `yes`/`no`/`True`/`Allowed`-style cells: `yes` and `true` give `allow`, `no` gives `deny`; `Allowed` (not in the list) throws `PermissionMatrixError` and the message contains the line number and the cell.
- An empty cell leaves the role out; `checkAccess` for that role returns `undefined` for a 200.
- A CSV whose first column has a colon (`/search?q=a:b,allow,deny`) parses as CSV.
- YAML: a rule without `roles` throws a `PermissionMatrixError` mentioning rule 1; YAML with a bad indent throws one starting `The permission matrix is not valid YAML`; a good YAML list still parses.
- An object matrix with `roles: { admin: 'maybe' }` throws from the constructor.

Run: `pnpm exec vitest run packages/checkers/tests/permission-matrix.test.ts`, then `pnpm exec vitest run --project unit packages/checkers/tests packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "'allow' : 'deny'" packages/checkers/src/permission-matrix.ts` finds nothing.
- [ ] `grep -n "as PermissionMatrix" packages/checkers/src/permission-matrix.ts` finds nothing.
- [ ] `grep -n "Could not load the permission matrix" packages/core/src/orchestrator.ts` finds the message with the cause.
- [ ] New and existing permission-matrix tests pass; `pnpm build` passes.

## Notes

- Audit finding M20 (audit of 11 Nov 2026 on `d225418`).
- Left out on purpose: reporting rules that no step ever exercised as "Could not verify" (the audit called it optional). Open a ticket if wanted.
- A matrix the runner loads from an uploaded file is not part of this ticket: the file path and object forms above are the two inputs that exist today.
