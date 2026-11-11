# T-250: Delete the account pool, the Figma sync and two unused `EntityNamespacer` methods

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | dead-code | todo |

**Files you may edit (no others):**

- `packages/core/src/account-pool.ts` (delete)
- `packages/core/src/figma-sync.ts` (delete)
- `packages/core/src/entity-namespacing.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/figma-sync.test.ts` (delete)
- `packages/core/tests/parallel-retry.test.ts`
- `packages/core/tests/entity-namespacing.test.ts`
- `docs/adr/0006-two-tier-decoupled-design-checker.md`

**Do not build in parallel with:** nothing. Other batches may edit `packages/core/src/index.ts`; rebase first if it changed.

## Problem

Left over from T-135, which listed them as "used only by tests". Owner's standing decision for unused code: delete.

| Item | Non-test users |
|---|---|
| `account-pool.ts` (`AccountPoolManager`) | 0 (exported from the core barrel only) |
| `figma-sync.ts` (`syncFigma`, `figmaVariablesToTokens`) | 0 (exported from the core barrel only; the `qa-test figma sync` command ADR 0006 names does not exist) |
| `EntityNamespacer.generateName` | 0 |
| `EntityNamespacer.injectStepValues` | 0 (`orchestrator.ts` uses `runToken` and `namespaceFillValue`) |

## Current code

Branch from `main`. Verify nothing else uses them; this must print only lines in the files listed above:

```
grep -rn "account-pool\|AccountPoolManager\|figma-sync\|syncFigma\|figmaVariablesToTokens\|generateName\|injectStepValues" packages scripts --include=*.ts --include=*.tsx --include=*.mjs --exclude-dir=node_modules --exclude-dir=dist
```

`packages/core/src/index.ts`:

```ts
export * from './account-pool.js';
...
export * from './figma-sync.js';
```

`packages/core/src/entity-namespacing.ts`, class `EntityNamespacer` has four static methods: `generateName`, `runToken`, `namespaceFillValue`, `injectStepValues`.

`packages/core/tests/parallel-retry.test.ts` has `describe('Parallelism, Account Pooling & Retry Hardening', ...)` holding three inner blocks: `describe('AccountPoolManager')` (starts line 7), `describe('EntityNamespacer')` (line 39), `describe('RetryRunner Clean Retry')` (line 60), and imports for all three modules in lines 2 to 4.

`packages/core/tests/entity-namespacing.test.ts` has, inside `describe('namespacing: run token')`, the tests `'namespacing: injectStepValues with a run token is the same on every call'` and `'namespacing: legacy injectStepValues without token still random-unique'`.

## Change

1. Run the grep above. If it prints any line outside the listed files, stop and say so in the PR.
2. Delete `account-pool.ts`, `figma-sync.ts` and `tests/figma-sync.test.ts`.
3. `index.ts`: delete the two `export *` lines.
4. `entity-namespacing.ts`: delete the methods `generateName` and `injectStepValues` with their doc comments. `runToken` and `namespaceFillValue` stay. If `TestCaseStep` is still used by `namespaceFillValue` (it is), keep the type import.
5. `tests/parallel-retry.test.ts`: delete the imports of `AccountPoolManager` and `EntityNamespacer`, and the `describe('AccountPoolManager')` and `describe('EntityNamespacer')` blocks. Rename the outer describe to `'Retry hardening'`. The `RetryRunner` block stays unchanged.
6. `tests/entity-namespacing.test.ts`: delete the two `injectStepValues` tests. Keep the two `runToken` tests and the `namespacing: fill values` block.
7. `docs/adr/0006-two-tier-decoupled-design-checker.md`: at the end of item 3 ("Decoupled Synchronization ...") add one sentence: `The sync command was never built, and its draft module was deleted (T-250); tokens are kept by hand in the product profile.`
8. Run `pnpm exec prettier --write` on the edited TypeScript and ADR files, then `pnpm build`.

## Tests

No new test. Deleting something that is used fails the build; the build is the check:

- `pnpm build`
- `pnpm typecheck` (includes the test files)
- `pnpm exec vitest run packages/core/tests/entity-namespacing.test.ts packages/core/tests/parallel-retry.test.ts`
- `pnpm exec vitest run --project unit packages/core/tests`

## Done when

- [ ] `ls packages/core/src/account-pool.ts packages/core/src/figma-sync.ts packages/core/tests/figma-sync.test.ts` reports all three missing.
- [ ] `grep -rn "generateName\|injectStepValues\|AccountPoolManager\|syncFigma" packages --include=*.ts --exclude-dir=node_modules --exclude-dir=dist` prints nothing.
- [ ] `pnpm build`, `pnpm typecheck` and the core unit tests pass.

## Notes

- `CONTEXT.md` has a "Design Tokens" entry that mentions Figma only as "without requiring live Figma API access". It stays correct.
- Not in this ticket: other unused members (`parseKnownFindings`, `sentBySteps` and the rest). They are in T-251.
