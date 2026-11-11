# T-351: `@qa/types` gets an exports map with a browser entry, and the verdict input is narrowed

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | types | maintainability | todo |

**Files you may edit (no others):**

- `packages/types/package.json`
- `packages/types/src/problems.ts`
- `packages/types/src/verdict.ts`
- `packages/types/tests/browser-entry.test.ts`
- `packages/types/tests/verdict-gate.test.ts`

**Do not build in parallel with:** T-384 (edits `package.json`); T-232 (edits `problems.ts`); and any ticket that runs `pnpm install` or edits a `package.json`.

## Problem

Two loose ends in `@qa/types`.

First, `packages/types/package.json` has only `main` and `types`. It has no `exports` map, so the browser-safe entry is not a named part of the package: the wizard reaches it by a file path, `@qa/types/src/browser.js` (91 imports, resolved by an alias in `vitest.config.ts:24` and by Vite). The package also says nothing about `sideEffects`, so a bundler cannot drop unused modules. The audit also feared that browser safety rests on a test that covers only `browser.ts`. That part is already handled: `packages/types/tests/browser-entry.test.ts` (T-211) walks the whole closure of `src/browser.ts` for Node built-ins, and a second case fails when any file under `packages/wizard` imports any `@qa/types/src/...` path other than `browser.js`. A grep confirms the wizard has only `@qa/types/src/browser.js` and type-only `@qa/types` imports today. So no new guard is needed; only the map.

Second, `releaseVerdict` builds a full `Finding` out of a partial one with a cast (`packages/types/src/verdict.ts:119-123`): `({ checker: 'bug-detection', id: '', where: {...}, ...f }) as Finding`. The cast hides which fields `groupIntoProblems` really reads. A caller that passes fewer fields type-checks, and a future read of a new field would silently get `undefined`.

## Current code

Branch from `main`.

`packages/types/package.json`:

```json
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
```

`packages/types/src/verdict.ts` (`grep -n "as Finding" packages/types/src/verdict.ts`):

```ts
  const problems = groupIntoProblems(
    safeFindings.map(
      (f) =>
        ({ checker: 'bug-detection', id: '', where: { urlPath: '', role: '', breakpoint: '1440px' }, ...f }) as Finding
    )
  );
```

`packages/types/src/problems.ts` (`grep -n "export function groupIntoProblems" -A4 packages/types/src/problems.ts`): `groupIntoProblems(findings?: Finding[] | null): Problem[]`. It reads `triageStatus`, `needsConfirmation`, `issueKey`, `title`, `severity`, `where.urlPath`, `seenAt`, and the aspect (`aspectOfFinding`).

## Change

1. `problems.ts`: make `Problem` generic with a default, `Problem<F = Finding>` (its `findings: F[]`), and make `groupIntoProblems<F extends ProblemInput = Finding>(findings?: F[] | null): Problem<F>[]`. Define `ProblemInput` as `Pick<Finding, 'title' | 'severity' | 'checker' | 'where'> & Partial<Pick<Finding, 'triageStatus' | 'needsConfirmation' | 'issueKey' | 'seenAt' | 'aspect' | 'categoryTag'>>`; take the exact key list from what `aspectOfFinding` reads (`grep -n "export function aspectOfFinding" -A8 packages/types/src/aspects.ts`). Existing callers with `Finding[]` infer `F = Finding` and compile unchanged.
2. `verdict.ts`: delete the `as Finding` map. Pass `safeFindings` to `groupIntoProblems` with the defaults filled by a function that returns a `ProblemInput`-typed object (no cast): `(f) => ({ checker: 'bug-detection', where: { urlPath: '', role: '', breakpoint: '1440px' }, ...f })`.
3. `package.json`: add `"sideEffects": false` and an `exports` map:
   `".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }`, `"./browser": "./src/browser.ts"`, `"./src/*": "./src/*"`, `"./package.json": "./package.json"`. The `./src/*` entry keeps the 91 existing `@qa/types/src/browser.js` imports working. Do not change any wizard import (that is outside the file list).
4. After editing, run `pnpm build` (the build type-checks) and the wizard build `pnpm --filter @qa/wizard build`. If the wizard build cannot resolve `@qa/types/src/browser.js` with the map in place, remove the `exports` map, keep `sideEffects` and the verdict change, and say so in the pull request. Do not rewrite the wizard imports in this ticket.
5. Run `pnpm exec prettier --write` on the touched files.

## Tests

- `packages/types/tests/browser-entry.test.ts`: add a case that reads `packages/types/package.json` and expects `exports['./browser']` to exist and `sideEffects` to be `false`. (Skip this case if step 4 removed the map.)
- `packages/types/tests/verdict-gate.test.ts`: add a case that calls `releaseVerdict` with findings holding only `severity`, `title`, `triageStatus` and `needsConfirmation` (as it does today) and expects the same verdict as before; the change must not alter any result. The existing cases must pass unchanged.

Run: `pnpm exec vitest run packages/types/tests`, then the unit tests of `packages/wizard`, then `pnpm build`.

## Done when

- [ ] `grep -n "as Finding" packages/types/src/verdict.ts` finds nothing.
- [ ] `grep -n "\"exports\"\|sideEffects" packages/types/package.json` finds both (or the PR says why the map was dropped).
- [ ] `pnpm build` and the wizard build pass; `pnpm exec vitest run packages/types/tests` passes.

## Notes

- Audit finding L9 (audit of 11 Nov 2026 on `d225418`). Size lowered from M to S: the "extend the guard test to every path" half is already done by T-211 (`browser-entry.test.ts`, last case).
- The licence field is left to T-384.
- Moving the wizard from `@qa/types/src/browser.js` to `@qa/types/browser` (91 imports, the alias in `vitest.config.ts`, `tsconfig.test.json`) is a separate, mechanical change and is not part of this ticket.
