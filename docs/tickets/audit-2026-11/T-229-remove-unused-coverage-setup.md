# T-229: Remove the coverage setup nothing runs

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | config | dead | todo |

**Files you may edit (no others):**
- `package.json`
- `pnpm-lock.yaml` (only through `pnpm install`)
- `vitest.config.ts`

**Do not build in parallel with:** any ticket that runs `pnpm install` or edits `package.json`.

## Problem

`@vitest/coverage-v8` is a dev dependency and `vitest.config.ts` has a `coverage` block whose comment says "Only active with --coverage (CI)". No workflow, script or document passes `--coverage` (`grep -rn "coverage" .github/workflows package.json docs/TESTING.md CONTRIBUTING.md` finds only the dependency line). The owner's decision for unused items in this audit was to delete them.

## Current code

Branch from `main`.

`package.json` (devDependencies):

```json
"@vitest/coverage-v8": "^2.1.8",
```

`vitest.config.ts`:

```ts
// Global options (workers, coverage). The test files themselves come from the projects in vitest.workspace.ts.
export default defineConfig({
  test: {
    ...sharedTest,
    minWorkers: 1,
    maxWorkers: workers,
    include: ['packages/*/tests/**/*.test.{ts,tsx}'],
    // Only active with --coverage (CI). Prints a summary; no thresholds.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      ...
    },
```

## Change

1. Read the whole `coverage: { ... }` block in `vitest.config.ts` and delete it together with its comment line ("Only active with --coverage (CI). ..."). Keep every other option.
2. In the comment above `export default defineConfig`, change `(workers, coverage)` to `(workers)`.
3. In `package.json`, delete the `"@vitest/coverage-v8": "^2.1.8",` line.
4. Run `pnpm install` so `pnpm-lock.yaml` drops the package. Do not edit the lock file by hand. Check `git diff --stat pnpm-lock.yaml` shows only removals related to coverage packages; if other packages change version, stop and set `blocked`.
5. Leave any `coverage` line in `.gitignore`.

## Tests

`pnpm exec vitest run --project unit packages/types/tests` (a quick run that proves the config still loads), then `pnpm build`.

## Done when

- [ ] `grep -rn "coverage" package.json vitest.config.ts` prints nothing.
- [ ] `grep -c "coverage-v8" pnpm-lock.yaml` prints 0.
- [ ] The quick test run and `pnpm build` pass.

## Notes

- If the owner would rather keep coverage, the other route is a CI step `pnpm exec vitest run --project unit --coverage`. That is a different ticket; do not do both.
