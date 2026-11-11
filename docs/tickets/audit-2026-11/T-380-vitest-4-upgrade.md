# T-380: Upgrade vitest to 4.x and move the workspace to `test.projects`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | config | dependencies | todo |

**Files you may edit (no others):**

- `package.json`
- `pnpm-lock.yaml` (only through `pnpm install`)
- `vitest.config.ts`
- `vitest.workspace.ts`
- `vitest.shared.ts` (new)
- `docs/TESTING.md`
- Any `packages/*/tests/**/*.test.ts(x)` file that fails only because of a documented vitest 4 behaviour change. List each one in the Notes of this ticket when you edit it. Do not change what a test asserts.

**Do not build in parallel with:** T-229, T-270, T-378 (all edit `package.json`); T-229, T-268, T-271, T-278, T-383 (all edit `pnpm-lock.yaml`); T-229 (edits `vitest.config.ts`); T-308, T-336, T-341, T-349, T-379 (all edit `vitest.workspace.ts`); T-228, T-379 (all edit `TESTING.md`); and any ticket that runs `pnpm install` or edits a `package.json`.

## Problem

The repository uses vitest 2.1.9 (`package.json:45`, `"vitest": "^2.1.8"`). The dependency audit of 11 Nov 2026 found 19 advisories in the lockfile and all 19 come through vitest 2.1.9: 3 are critical (the vitest UI server, and `tinypool`, twice), the rest high and moderate. They are all dev-only, so the production audit that CI runs (`pnpm audit --prod --audit-level high`) is green and the hosted copy is not affected. But every contributor and the CI runner run this code, and the advisories will not go away without moving off 2.x.

`defineWorkspace` and the `vitest.workspace.ts` file are removed in vitest 4: projects are listed in the config as `test.projects`. So the upgrade is more than a version bump. The unit/browser split (`vitest.workspace.ts`, ADR 0040) and the `@qa/*` alias setup (`vitest.config.ts:21-32`) must keep working exactly as they do now.

## Current code

Branch from `main`.

`package.json` (devDependencies, `grep -n vitest package.json`):

```json
    "@vitest/coverage-v8": "^2.1.8",
    ...
    "vitest": "^2.1.8"
```

`vitest.workspace.ts` (`grep -n "defineWorkspace" vitest.workspace.ts`) imports `sharedTest` and `sharedResolve` from `./vitest.config`, builds `BROWSER_TESTS`, and ends with `export default defineWorkspace([{ resolve: sharedResolve, test: { ...sharedTest, name: 'unit', include: [...], exclude: [...] } }, { ... name: 'browser', include: browserFiles } ]);`.

`vitest.config.ts` exports `sharedTest`, `sharedResolve` and `defineConfig({ test: { ...sharedTest, minWorkers: 1, maxWorkers: workers, include: [...], coverage: {...} } })`.

Commands that must keep working: `vitest run --project unit` (`pnpm test`), `--project browser`, `--shard=N/M` (`tests.yml:61`), and a single file by path.

## Change

1. Check what exists first. `npm view vitest version` (use the newest 4.x), `npm view vitest@4 peerDependencies engines`, and read the official vitest 4 migration guide. The Node range must include 22.9 (`engines` in `package.json`), and the vite range must include `^6.0.7` (the wizard's `vite`). If either does not hold, set this ticket to `blocked` with the facts.
2. `package.json`: bump `vitest` to the 4.x you found, with a caret range. Bump `@vitest/coverage-v8` to the same version only if it is still there. T-229 deletes it; if T-229 has been built, nothing to do; if not, either build T-229 first (preferred) or bump both. Run `pnpm install` (never edit the lockfile by hand) and check `git diff --stat pnpm-lock.yaml` shows only vitest-related packages changing; if unrelated packages change version, stop and set `blocked`.
3. New `vitest.shared.ts`: move `sharedTest` and `sharedResolve` here unchanged (with their comments). This breaks the cycle that appears once the config imports the projects.
4. `vitest.workspace.ts`: keep `BROWSER_TESTS` and `browserFiles` here (T-379 edits this list; docs point at this file). Remove `defineWorkspace`. Export the two projects as a plain array (`export const projects = [ { resolve: sharedResolve, test: { ...sharedTest, name: 'unit', include: [...], exclude: [...] } }, { resolve: sharedResolve, test: { ...sharedTest, name: 'browser', include: browserFiles } } ];`). Import `configDefaults` from `vitest/config`. Do not use `extends` on the projects: they must not inherit the root `include`, or each project would run every file (the existing comment at `vitest.config.ts:12-13` explains why).
5. `vitest.config.ts`: import `sharedTest`/`sharedResolve` from `./vitest.shared`, re-export them if any file imports them from here (`grep -rn "from './vitest.config'\|vitest.config" --include=*.ts . | grep -v node_modules`), and set `test: { projects, maxWorkers: workers }` in the default export. Check the vitest 4 migration guide for `minWorkers` and `poolOptions`: drop any option that no longer exists, and keep the memory-based worker count (`workers`, `vitest.config.ts:10`) working through whatever option replaces it. Update the two comments that say "vitest.workspace.ts" / "projects in vitest.workspace.ts" to match.
6. `docs/TESTING.md:7`: say the projects are set in `vitest.config.ts` and the browser list lives in `vitest.workspace.ts`.
7. Run the unit tier. For each failing file, read the vitest 4 migration notes before changing anything. Do not weaken an assertion. Typical v4 changes: mock call/spy behaviour, `vi.fn` implementation resets, default pool options, reporter names, snapshot handling, and the `--project` flag matching exact names.
8. `pnpm exec prettier --write` on the changed files.

## Tests

No new test file. The suite is the test.

- `pnpm exec vitest run --project unit --shard=1/2` and `--shard=2/2` pass (the CI shape), and `pnpm test` passes.
- `pnpm exec vitest run --project browser --list` names the same files as before (run it before you change anything and save the list in your scratch folder, then compare).
- `pnpm exec vitest run packages/types/tests/<any test>.test.ts` (a single file by path) still works.
- `pnpm typecheck` (the config files are type-checked) and `pnpm build`.
- `pnpm audit` (all dependencies, not only `--prod`) no longer lists vitest or tinypool; note the new count in the report.

## Done when

- [ ] `grep -n '"vitest"' package.json` shows a 4.x range; `grep -rn "defineWorkspace" . --include=*.ts` (outside `node_modules`) prints nothing.
- [ ] `grep -n "projects" vitest.config.ts` finds `test.projects`, and `pnpm exec vitest run --project browser --list` and `--project unit --list` partition the test files exactly as before (same total count).
- [ ] `pnpm test` passes; `pnpm typecheck` and `pnpm build` pass.
- [ ] `pnpm audit` shows none of the 19 vitest-linked advisories.

## Notes

- Audit finding M18 (audit of 11 Nov 2026 on `d225418`). The advisory counts are from that audit; re-run `pnpm audit` to see the live numbers.
- T-229 removes `@vitest/coverage-v8` and the `coverage` block in `vitest.config.ts`: build it first. T-379 edits `vitest.workspace.ts` (the `BROWSER_TESTS` list): build it before or after, but not at the same time. Both edit the lockfile with T-383 (Playwright bump): this is the "dependencies chain": one `pnpm install` change at a time.
- `vitest.workspace.ts` stays as a module name so the docs and the test-file header comments (`BROWSER_TESTS.runner (vitest.workspace.ts)`) stay true. Vitest 4 ignores a workspace file by that name, so it must not call `defineWorkspace`.
- If the unit tier is much slower or flakier on vitest 4 (pool defaults changed), say so in the report; do not tune `maxWorkers` further here.
