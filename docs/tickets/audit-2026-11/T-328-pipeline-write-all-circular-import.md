# T-328: Move `pageContentName` out of the pipeline to end a circular import

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | core | maintainability | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/store/keys.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/src/audit/pipeline/index.ts`
- `packages/core/src/audit/documents/write-all.ts`
- `packages/core/tests/audit-pipeline.test.ts`
- `packages/core/tests/audit-store.test.ts`

**Do not build in parallel with:** T-295, T-321, T-322, T-326 (all edit `pipeline.ts`, `audit-pipeline.test.ts`); T-321, T-325 (all edit `audit-store.test.ts`).

## Problem

`write-all.ts` imports `pageContentName` from the pipeline (`packages/core/src/audit/documents/write-all.ts:37`), and the pipeline imports `writeAllDocuments` from `write-all.ts` (`packages/core/src/audit/pipeline/pipeline.ts:69-74`). The two modules import each other. It works today only because `pageContentName` is a function declaration used at call time, not at load time. Any top-level use of either side during loading (a constant built from the other module, a reordered import) would read `undefined` and fail in a way that is hard to trace.

`pageContentName` is a store key name, not pipeline logic: it is one line on top of `pageSlug`, which already lives in the key layout module (`packages/core/src/audit/store/keys.ts:20-29`). The runner reads it from `@qa/core` in six route files, through the pipeline barrel.

## Current code

Branch from `main`.

`packages/core/src/audit/pipeline/pipeline.ts` (`grep -n "pageContentName\|pageSlug" packages/core/src/audit/pipeline/pipeline.ts`):

```ts
import { pageSlug } from '../store/keys.js';
...
/** The per-version Page Content object name of a page: `pages/<slug>-<sha256-8>`. */
export function pageContentName(urlPath: string): string {
  return `pages/${pageSlug(urlPath)}`;
}
```

and it is used at the two Page Content writes in the save step.

`packages/core/src/audit/documents/write-all.ts:35-37`:

```ts
import { STORED_DOCUMENT_KINDS } from '../store/keys.js';
import type { AuditVersionUpdate } from '../store/audit-store.js';
import { pageContentName } from '../pipeline/pipeline.js';
```

`packages/core/src/audit/pipeline/index.ts` re-exports it: `export { runAuditPipeline, pageContentName, AuditPipelineError, ... } from './pipeline.js';`. `packages/core/src/audit/store/index.ts` has `export * from './keys.js';`, and both barrels are re-exported by `packages/core/src/audit/index.ts`.

Tests import it from the pipeline: `packages/core/tests/audit-pipeline.test.ts` (from `../src/audit/pipeline/index.js`) and `packages/core/tests/audit-store.test.ts:25` (from `../src/audit/pipeline/pipeline.js`).

## Change

1. `keys.ts`: add below `pageSlug`:

```ts
/** The per-version Page Content object name of a page: `pages/<slug>-<sha256-8>` (stored as `<name>.json`). */
export function pageContentName(urlPath: string): string {
  return `pages/${pageSlug(urlPath)}`;
}
```

2. `pipeline.ts`: delete `pageContentName` and change the import to `import { pageContentName } from '../store/keys.js';` (drop `pageSlug` from it when nothing else in the file uses it: `grep -n "pageSlug" packages/core/src/audit/pipeline/pipeline.ts`).

3. `pipeline/index.ts`: remove `pageContentName` from the named export list. `@qa/core` still exports it once, through `store/index.ts` (`export * from './keys.js'`), so the runner's `import { pageContentName } from '@qa/core'` keeps working. Leaving it in both barrels would export the name twice from `audit/index.ts`.

4. `write-all.ts`: merge the import into the existing keys import: `import { pageContentName, STORED_DOCUMENT_KINDS } from '../store/keys.js';` and delete the `../pipeline/pipeline.js` import.

5. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

- `packages/core/tests/audit-pipeline.test.ts`: remove `pageContentName` from the `../src/audit/pipeline/index.js` import and add `import { pageContentName } from '../src/audit/store/keys.js';`. The tests that use it (Page Content saved under its name, a failed Page Content write) are unchanged.
- `packages/core/tests/audit-store.test.ts`: change line 25 to `import { pageContentName } from '../src/audit/store/keys.js';` (or add it to the existing `../src/audit/store/index.js` import). The existing `expect(pageContentName('/pricing')).toBe(\`pages/${pageSlug('/pricing')}\`)` keeps passing.
- `packages/core/tests/audit-exports.test.ts` and the runner tests that import `pageContentName` from `@qa/core` must keep passing unchanged: they prove the public name did not move for callers.

Run: `pnpm exec vitest run packages/core/tests/audit-pipeline.test.ts packages/core/tests/audit-store.test.ts packages/core/tests/audit-doc-write-all.test.ts packages/core/tests/audit-exports.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build` and `pnpm typecheck`.

## Done when

- [ ] `grep -rn "pipeline/pipeline.js" packages/core/src/audit/documents` finds nothing.
- [ ] `grep -n "export function pageContentName" -r packages/core/src` finds only `audit/store/keys.ts`.
- [ ] `grep -n "pageContentName" packages/core/src/audit/pipeline/index.ts` finds nothing.
- [ ] The tests above pass, the core and runner unit tests pass, and `pnpm build` and `pnpm typecheck` pass.

## Notes

- Audit finding L13, circular import part (audit of 11 Nov 2026 on `d225418`).
- T-321, T-322, T-326 and T-295 also edit `pipeline.ts`; T-321 and T-325 also edit `audit-store.test.ts`. This change is two import lines and one moved function in each, so it merges easily, but the index pass decides the order.
