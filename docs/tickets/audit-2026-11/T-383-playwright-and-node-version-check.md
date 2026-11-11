# T-383: Playwright 1.65, and a Node major check

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | M | config | dependencies | todo |

**Files you may edit (no others):**

- `packages/checkers/package.json`
- `packages/core/package.json`
- `packages/wizard/package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml` (only through `pnpm install`)
- `packages/runner/Dockerfile`
- `scripts/check-playwright-version.mjs`
- `scripts/start.mjs`
- `packages/runner/tests/playwright-version-check.test.ts`
- `docs/DEPLOYMENT.md`

**Do not build in parallel with:** T-384 (edits `package.json`); T-271, T-384 (all edit `package.json`); T-278, T-384 (all edit `package.json`); T-229, T-268, T-271, T-278, T-380 (all edit `pnpm-lock.yaml`); T-277, T-373, T-376, T-377 (all edit `Dockerfile`); T-373, T-376 (all edit `DEPLOYMENT.md`); and any ticket that runs `pnpm install` or edits a `package.json`.

## Problem

Two separate things, both about versions.

1. Playwright is pinned to 1.63.0 in five places: `packages/checkers/package.json:16`, `packages/core/package.json:17`, `packages/wizard/package.json:28`, the `overrides` in `pnpm-workspace.yaml:9-10`, and the runner image tag `FROM mcr.microsoft.com/playwright:v1.63.0-noble` (`packages/runner/Dockerfile:3`). `scripts/check-playwright-version.mjs` keeps them equal and CI runs it. The 11 Nov audit saw 1.65.0 as the latest release. Playwright ships browser fixes often and the tool drives real pages, so staying two minors behind is a (small) risk. Dependabot is told to ignore Playwright because the five places must move together (`.github/dependabot.yml`), so this is a hand bump.
2. `.nvmrc` says `22` and CI uses it (T-381), but `engines` is `>=22.9.0` (`package.json:33`), so Node 24 installs without a warning. A developer on Node 24 (the audit machine may be on 24) can see test or build results that CI, on Node 22, never produces, with nothing telling them the versions differ. Nothing checks the Node major at all.

## Current code

Branch from `main`. `grep -rn "1\.63\.0" --include=package.json --include=*.yaml --include=Dockerfile . | grep -v node_modules`.

```
packages/checkers/package.json:16:    "playwright": "1.63.0",
packages/core/package.json:17:    "playwright": "1.63.0",
packages/wizard/package.json:28:    "playwright": "1.63.0",
pnpm-workspace.yaml:9:  playwright: '1.63.0'
pnpm-workspace.yaml:10:  playwright-core: '1.63.0'
packages/runner/Dockerfile:3:FROM mcr.microsoft.com/playwright:v1.63.0-noble
```

`scripts/check-playwright-version.mjs` exports pure helpers (`parseDockerfileVersion`, `checkVersions`, `main`) and runs `main()` only when started directly. `scripts/start.mjs` is `pnpm start`.

## Change

Part A, Node check (do this first; it is small and independent):

1. `scripts/check-playwright-version.mjs`: add and export a pure function

```js
/** A warning when the running Node major differs from the one in .nvmrc, else null. `running` is process.versions.node. */
export function nodeMajorWarning(running, nvmrcText) {
  const want = /^v?(\d+)/.exec(String(nvmrcText).trim());
  const have = /^(\d+)/.exec(String(running));
  if (!want || !have || want[1] === have[1]) return null;
  return `Node ${have[1]} is running; this repository is built and tested on Node ${want[1]} (.nvmrc). Use Node ${want[1]} to match CI.`;
}
```

   In `main()`, read `.nvmrc` (skip quietly if missing) and print the warning with `console.warn` when it is not null. It must not change the exit code: a different Node major is a warning only, so `check-playwright-version.mjs` still exits 0 when the Playwright versions match.
2. `scripts/start.mjs`: import `nodeMajorWarning` from `./check-playwright-version.mjs` (safe: it does not run `main()` on import) and print the warning at start, before the build step. Warning only; never `fail()`.

Part B, Playwright bump:

3. Find the newest release: `npm view playwright version`, and check the Docker tag exists: `docker manifest inspect mcr.microsoft.com/playwright:v<version>-noble` (or open the Playwright release notes). If the image tag does not exist yet, set this ticket to `blocked` with that fact; never bump the package without the image.
4. Change all five places to the same version, with the same quoting style as today. In the Dockerfile, if T-377 has pinned the base image by digest, update the digest with the tag (`docker buildx imagetools inspect mcr.microsoft.com/playwright:v<version>-noble`).
5. Run `pnpm install` (never edit the lockfile by hand). `git diff --stat pnpm-lock.yaml` must show only `playwright`, `playwright-core` and their direct dependencies. If other packages change, stop and set `blocked`.
6. `node scripts/check-playwright-version.mjs` must print "matches". Then run `pnpm --filter @qa/core exec playwright install chromium` locally if you can (Chromium for the new version).
7. `docs/DEPLOYMENT.md:52`: change `v1.63.0-noble` to the new tag.
8. Run `pnpm exec prettier --write` on the changed files.

## Tests

`packages/runner/tests/playwright-version-check.test.ts` (unit tier): add cases for `nodeMajorWarning`:

- `('22.9.0', '22\n')` returns `null`; `('22.9.0', 'v22.11.0')` returns `null`.
- `('24.1.0', '22\n')` returns a string that contains both `24` and `22`.
- `('22.9.0', '')` and `('22.9.0', 'lts/*')` return `null` (an unreadable `.nvmrc` never warns).
- `main()` still returns `0` for matching versions when the Node major differs (call it against the real repository root; do not assert the warning text).

Run: `pnpm exec vitest run packages/runner/tests/playwright-version-check.test.ts`, then `pnpm exec vitest run --project unit`, then `pnpm build`. After the bump, run the browser tier once for the files you can: `pnpm exec vitest run --project browser --no-file-parallelism packages/core/tests/browser-guard.test.ts packages/core/tests/visual-capture.test.ts` (the Playwright minor may change screenshots or timing; report anything that fails and was green before).

## Done when

- [ ] `grep -rn "1\.63\.0" --include=package.json --include=*.yaml --include=Dockerfile . | grep -v node_modules | grep -v "pnpm-lock"` prints nothing, and the new version appears in all five places.
- [ ] `node scripts/check-playwright-version.mjs` prints that the versions match and exits 0.
- [ ] Starting `pnpm start` or the check script under a different Node major prints the warning (try with `volta`/`nvm` if you have it, or trust the unit test).
- [ ] The version-check test, the unit tier and `pnpm build` pass.

## Notes

- Audit finding L19 (audit of 11 Nov 2026 on `d225418`). The 1.65.0 figure is from that audit; check it again, a newer release may exist.
- Do not bump Playwright to fix a browser error (`docs/TESTING.md:72`); this ticket is a planned upgrade, and any browser-tier failure it causes goes in the report.
- Touches the lockfile: build it alone with respect to T-229, T-380 (vitest 4) and any other ticket that runs `pnpm install`. T-377 edits the Dockerfile `FROM` line (digest): build this after T-377.
- The Playwright image carries its own Node version; check that it is still 22.x after the bump (`docker run --rm mcr.microsoft.com/playwright:v<version>-noble node --version`) and note the answer in the report. A different Node major in the image than in `.nvmrc` would be a finding of its own.
