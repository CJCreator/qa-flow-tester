# T-379: Loopback runner tests run on every PR, and browser tests run on PRs that touch browser code

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | ci | gap | todo |

**Files you may edit (no others):**

- `vitest.workspace.ts`
- `.github/workflows/browser-pr.yml` (new)
- `docs/TESTING.md`

**Do not build in parallel with:** T-308, T-336, T-341, T-349, T-380 (all edit `vitest.workspace.ts`); T-228, T-380 (all edit `TESTING.md`).

## Problem

The test suite has two tiers. `unit` runs on every pull request. `browser` runs only at night (`.github/workflows/e2e-nightly.yml`). A test file is in `browser` only if `vitest.workspace.ts` names it in `BROWSER_TESTS`.

That list is long for the runner package: 24 files (`vitest.workspace.ts:29-55`). Many of them probably start a `RunnerServer` on a loopback port and never launch Chromium (the header comment says a loopback server is allowed in `unit`, `vitest.workspace.ts:5-6`, and `docs/TESTING.md:14` says the same). Examples that look loopback-only: `access-token`, `beta`, `beta-privacy`, `route-access-server`, `remembered-signins`, `scheduler`, `helper-access`, `audit-helpers-routes`, `single-server`. Their names suggest access control and routing checks, which are exactly what a pull request can break. Today a change to those routes is only tested the next night, and a break stays on `main` until then. The same night run already fails on `main` for other reasons (T-337, T-361).

The other side: a pull request that changes the browser code (`packages/core/src/browser*`, discovery, the orchestrator, the checkers) runs no Chromium test at all before merge.

## Current code

Branch from `main`. `grep -n "runner: \[" -A28 vitest.workspace.ts`.

`vitest.workspace.ts` (the `runner` entry; 24 names: `access-token`, `ai-estimate-cap`, `baseline-accept`, `beta`, `beta-privacy`, `cli-bind-host`, `context-docx-route`, `domain-proof`, `error-redaction`, `issues-download`, `reapproval-roles`, `remembered-signins`, `route-inventory`, `scheduler`, `single-server`, `spec-override-endpoint`, `audit-documents-flow`, `audit-flow-browser`, `audit-helpers-routes`, `audit-persistence-integration`, `audit-preview-browser`, `helper-access`, `route-access-server`, `server-audit-wiring`).

A first read of the files (`grep -ci "chromium\|\.launch(\|BrowserManager\|Spider\|newPage" packages/runner/tests/<name>.test.ts`) found a Chromium launch in only `audit-documents-flow`, `audit-flow-browser` and `audit-preview-browser`, plus a mention of Chromium in a comment in `error-redaction.test.ts:106` (a run that fails to connect). That is a hint, not proof: a test can also start a run through a route (`/api/run`, a Plan approval) and the runner then launches Chromium by itself.

`.github/workflows/tests.yml` already takes `project` and `shard` inputs and installs Chromium and builds when `project != 'unit'`.

## Change

1. Decide which runner tests are loopback-only, by running them, not by reading. Use the method the header comment of `vitest.workspace.ts` describes: run the file with `PLAYWRIGHT_BROWSERS_PATH` set to an empty folder so no Chromium can start, for example (bash) `PLAYWRIGHT_BROWSERS_PATH=$(mktemp -d) pnpm exec vitest run --project browser packages/runner/tests/<name>.test.ts`, one file at a time (the browser project includes it today). A file that passes with no Chromium is loopback-only. A file that fails with `Executable doesn't exist` launches Chromium. Do this for all 24 runner names; also run the 4 non-runner names that start a runner, if any (`grep -l RunnerServer packages/*/tests/*.test.ts`).
2. Remove the loopback-only names from `BROWSER_TESTS.runner` (they fall to `unit` by default). Keep a name in the list only if it needs Chromium. Add one line to the comment above the list: "Checked on <date> with an empty PLAYWRIGHT_BROWSERS_PATH". Use today's date from `date`.
3. Check the moved files run in under 12 minutes together on a 2-shard unit job: run `pnpm exec vitest run --project unit packages/runner/tests` once and note the time. If it is much slower than the current unit run, say so in the report and raise the shard count in `ci.yml`/`deploy.yml` (a separate change; do not edit them here).
4. New workflow `.github/workflows/browser-pr.yml`: run the `browser` project on a pull request that touches browser code. Use a `paths:` filter on the trigger (no third-party path-filter action):

```yaml
# The browser tier on pull requests that touch code it covers. Everything else waits for the nightly run (e2e-nightly.yml).
name: Browser tests (pull requests)

on:
  pull_request:
    paths:
      - 'packages/core/src/browser*.ts'
      - 'packages/core/src/discovery/**'
      - 'packages/core/src/orchestrator.ts'
      - 'packages/checkers/src/**'
      - 'packages/wizard/tests/**'
      - 'vitest.workspace.ts'
      - '.github/workflows/browser-pr.yml'
      - '.github/workflows/tests.yml'

concurrency:
  group: browser-pr-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  browser:
    strategy:
      fail-fast: false
      matrix:
        shard: ['1/4', '2/4', '3/4', '4/4']
    uses: ./.github/workflows/tests.yml
    with:
      project: browser
      shard: ${{ matrix.shard }}
```

   Check the real paths before writing: `grep -rn "browser" packages/core/src --include=*.ts -l` and `ls packages/core/src` (the brief named `browser`, `discovery`, `orchestrator`: use the actual file and folder names; a `browser.ts` file and a `browser/` folder both need a pattern). The workflow only calls `tests.yml`, so it adds no new action to pin.
5. `docs/TESTING.md` (`:12-14`, `:18`): the `browser` row says "Nightly"; change it to "Nightly (`e2e-nightly.yml`, 4 shards) and on pull requests that touch browser code (`browser-pr.yml`)". Update the list sentence at `:14` if the moved files change what it says.
6. Run `pnpm exec prettier --write` on the three files.

## Tests

No new test file. The check is the run itself:

- `pnpm exec vitest run --project unit packages/runner/tests` passes with the moved files, with Chromium unavailable (empty `PLAYWRIGHT_BROWSERS_PATH`).
- `pnpm exec vitest run --project browser --list` (or the same run) still names every file that needs Chromium, and no moved file appears twice.
- `pnpm test` passes.
- `pnpm exec prettier --check .github/workflows/browser-pr.yml vitest.workspace.ts docs/TESTING.md`.

## Done when

- [ ] Every name left in `BROWSER_TESTS.runner` has a Chromium launch you can point to (`grep` or a failing empty-`PLAYWRIGHT_BROWSERS_PATH` run).
- [ ] `PLAYWRIGHT_BROWSERS_PATH=<empty folder> pnpm exec vitest run --project unit` passes.
- [ ] `.github/workflows/browser-pr.yml` exists and calls `tests.yml` with `project: browser`.
- [ ] `docs/TESTING.md` says when the browser tier runs.

## Notes

- Audit finding M17 (audit of 11 Nov 2026 on `d225418`).
- A workflow with a `paths:` filter is skipped, not green, when no path matches. Do not make `Browser tests (pull requests)` a required check in branch protection: a skipped required check blocks the merge. This is a repository setting for the owner (see T-374 Notes).
- The browser tier already fails on `main` (T-337, T-361). A path-filtered job will show those failures on the first pull request that touches those paths. Build this after those two tickets, or expect red.
- The checker/core browser tests are slow (4 shards of up to 12 minutes). That is acceptable only because the job is path-filtered.
- T-336 adds browser-tier tests and extends `BROWSER_TESTS`; build after it or merge the list by hand.
