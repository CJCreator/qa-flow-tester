# T-279: Release workflow drops the repeated `Build` step

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | ci | duplication | todo |

**Files you may edit (no others):**

- `.github/workflows/release.yml`
- `packages/runner/tests/release-workflow.test.ts`

**Do not build in parallel with:** T-225 (also edits `release.yml`: it changes the `uses:` lines; build T-225 after this one).

## Problem

`release.yml` builds three times: `pnpm run site-build` (types, wizard), `pnpm --filter "@qa/runner..." run build` (types, checkers, core, runner), then a last step `pnpm build`, which is `pnpm -r run build` over the same five packages. The last step repeats work already done. T-214 left it in because `release-workflow.test.ts` requires the text `pnpm build` in the file.

The five packages are `packages/types`, `checkers`, `core`, `runner`, `wizard` (`pnpm-workspace.yaml` is `packages/*`, and `ls packages` shows only those five). The first two builds cover all five, so nothing is lost.

## Current code

Branch from `main`. `grep -n "pnpm build\|run build" .github/workflows/release.yml packages/runner/tests/release-workflow.test.ts`.

`.github/workflows/release.yml` end of file:

```yaml
# Unit tier only: no Chromium. The browser tier runs every night (e2e-nightly.yml).
- name: Tests
  run: pnpm exec vitest run --project unit

- name: Build
  run: pnpm build
```

`packages/runner/tests/release-workflow.test.ts` lines 19-22:

```ts
  it('builds and does not publish', () => {
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('pnpm build');
    expect(yml).toContain('contents: read');
```

Other text that contains `pnpm build`: nothing else in `release.yml` (the other build steps read `pnpm run site-build` and `pnpm --filter "@qa/runner..." run build`).

## Change

1. `release.yml`: delete the last step, the blank line before it and its two lines (`- name: Build` and `run: pnpm build`), so the file ends with the `Tests` step's `run: pnpm exec vitest run --project unit` line and one newline.
2. `release-workflow.test.ts`: replace the line `    expect(yml).toContain('pnpm build');` with these two lines, so the test still proves the workflow builds:

```ts
expect(yml).toContain('pnpm run site-build');
expect(yml).toContain('run build');
```

3. Run `pnpm exec prettier --write .github/workflows/release.yml packages/runner/tests/release-workflow.test.ts`.

## Tests

`pnpm exec vitest run packages/runner/tests/release-workflow.test.ts` (all 5 tests pass), then `pnpm format:check`.

Also check: `grep -n "name: Build$" .github/workflows/release.yml` prints nothing, and `grep -n "run build\|site-build" .github/workflows/release.yml` prints the two remaining build steps.

## Done when

- [ ] `release.yml` has no step named `Build` and no `pnpm build` text.
- [ ] `release.yml` still has `pnpm run site-build` and `pnpm --filter "@qa/runner..." run build`.
- [ ] `release-workflow.test.ts` passes with the new expectations.

## Notes

- The test's other rules still hold: no `schedule`, `branches`, `pull_request`, `workflow_dispatch`, `upload-artifact`, `secrets.` or `contents: write` anywhere in the file. Do not write the word `schedule` in a comment.
- `docs/DEPLOYMENT.md` line 39 says the workflow "builds"; that stays true.
