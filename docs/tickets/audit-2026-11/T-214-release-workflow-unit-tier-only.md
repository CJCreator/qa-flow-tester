# T-214: Release workflow runs the unit tier only

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | ci | speed | todo |

**Files you may edit (no others):**
- `.github/workflows/release.yml`
- `docs/TESTING.md` (line 18 only)

**Do not build in parallel with:** T-205 (same workflow file; T-205 first), T-213 (also edits `docs/TESTING.md`).

## Problem
The release workflow runs `pnpm exec vitest run`: both tiers, unsharded, in a job with `timeout-minutes: 20`.
The `browser` tier alone runs nightly in 4 shards with 12 minutes each (`tests.yml`, `e2e-nightly.yml`). Run in
one job after a full install and three builds, it is likely to pass the 20 minutes, and a tag build fails for a
reason unrelated to the tag. The workflow's purpose is "it only proves the tag builds" (its line 1); the browser
tier already runs every night.

## Current code
`.github/workflows/release.yml:54-70` (branch `worktree-audit-cleanup`)
```yaml
      - name: Cache Playwright browser
        id: playwright-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ hashFiles('**/pnpm-lock.yaml') }}

      - name: Install Chromium (the browser tests drive it)
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: pnpm --filter @qa/core exec playwright install --with-deps chromium

      - name: Install Playwright system dependencies
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: pnpm --filter @qa/core exec playwright install-deps chromium

      - name: Tests
        run: pnpm exec vitest run
```

`docs/TESTING.md:18`
```markdown
`release.yml` runs `pnpm exec vitest run` (both tiers, after installing Chromium).
```

## Change
1. `.github/workflows/release.yml`: delete the three steps `Cache Playwright browser`,
   `Install Chromium (the browser tests drive it)` and `Install Playwright system dependencies`
   (the 14 lines from `- name: Cache Playwright browser` up to and including the blank line before
   `- name: Tests`).
2. Replace the `Tests` step with:
   ```yaml
         # Unit tier only: no Chromium. The browser tier runs every night (e2e-nightly.yml).
         - name: Tests
           run: pnpm exec vitest run --project unit
   ```
3. Keep every other step, in the same order: `Install`, `Tag matches the package version`,
   `Playwright version matches the Docker image tag`, `Lint`, `Check formatting`,
   `Audit production dependencies`, `Build the site`, `Build the runner and the packages it uses`, `Tests`,
   `Build`.
4. `docs/TESTING.md:18`: replace the line with:
   ```markdown
   `release.yml` runs `pnpm exec vitest run --project unit` (the unit tier; the browser tier runs nightly).
   ```

## Tests
```
pnpm exec vitest run packages/runner/tests/release-workflow.test.ts
pnpm format:check
```
This grep must print nothing:
```
grep -n "playwright install\|playwright-cache" .github/workflows/release.yml
```

## Done when
- [ ] The `Tests` step runs `--project unit`.
- [ ] No Chromium install or cache step is left in `release.yml`.
- [ ] `release-workflow.test.ts` passes.
- [ ] `docs/TESTING.md:18` matches the workflow.

## Notes
- Do not remove the last step, `Build` (`run: pnpm build`). It repeats earlier builds, but
  `release-workflow.test.ts` requires the text `pnpm build` in the file.
- The comment added in step 2 must not contain the word `schedule` (the test forbids it in this file).
  `e2e-nightly.yml` is fine.
- Keep `permissions: contents: read` from T-205.
