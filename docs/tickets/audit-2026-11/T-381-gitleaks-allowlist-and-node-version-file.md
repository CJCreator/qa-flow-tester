# T-381: Gitleaks allowlists only the test files that hold fake keys, and workflows read Node from `.nvmrc`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | ci | gap | todo |

**Files you may edit (no others):**

- `.gitleaks.toml`
- `packages/runner/tests/scan-commit-secrets.test.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/tests.yml`
- `.github/workflows/release.yml`
- `.github/workflows/qa-check.yml`

**Do not build in parallel with:** T-225, T-226, T-227, T-228 (all edit `ci.yml`); T-225, T-226, T-374, T-375, T-376 (all edit `deploy.yml`); T-225, T-275 (all edit `tests.yml`); T-225, T-279 (all edit `release.yml`); T-225 (edits `qa-check.yml`).

## Problem

Two small things in the CI setup.

1. `.gitleaks.toml` skips every file under `packages/*/tests/` (`paths = ['''^packages/[^/]+/tests/''']`). Tests do hold fake AI keys on purpose, so some skip is needed. But a skip for all of `tests/` means a real key pasted into any test file, old or new, is never found by the secret scan in CI (`ci.yml` and `deploy.yml`, "Scan history"). A new test file is the most likely place for a developer to paste a real key to try something.
2. Every workflow hard-codes `node-version: 22` (`ci.yml:30`, `ci.yml:72`, `ci.yml:112`, `deploy.yml:59`, `deploy.yml:117`, `tests.yml:30`, `release.yml:21`, `.github/workflows/qa-check.yml:58`). `.nvmrc` already says `22`. When the Node version moves, eight places have to change and one will be forgotten.

## Current code

Branch from `main`.

`.gitleaks.toml` (the whole file is 7 lines):

```toml
[extend]
useDefault = true

[allowlist]
description = "Fake keys in tests"
paths = ['''^packages/[^/]+/tests/''']
```

`scripts/scan-commit-secrets.mjs` (the pre-commit scan) reads the `paths` list of this file and leaves those files out of its own scan (`parseGitleaksAllowlistPaths`, `scripts/scan-commit-secrets.mjs:31-53`). So the allowlist must stay a `paths` list, or that script starts scanning test files and reporting the fake keys. A `regexes` allowlist would be stricter for gitleaks, but it would need a change in that script too; that is out of scope here.

`packages/runner/tests/scan-commit-secrets.test.ts:113-121` asserts the allowlist covers `packages/core/tests/ai-provider.test.ts` and nothing in `src/`.

## Change

1. Find which test files really hold keys gitleaks flags. Run gitleaks (version `8.30.1`, as in the workflows) over the working tree with the allowlist turned off: copy `.gitleaks.toml` to your scratch folder without the `[allowlist]` section and run `gitleaks dir --config <that file> --redact --no-banner --report-format json --report-path <scratch>/leaks.json packages`. Read only the `File` and `RuleID` fields. If gitleaks is not installed, use this starting list (files that match the AI key shapes in `scripts/scan-build-secrets.mjs`) and say in the report that the list was not confirmed:
   - `packages/core/tests/`: `ai-provider`, `audit-assessment`, `audit-doc-settings`, `audit-pagespeed`, `audit-store`, `gemini-models`, `key-resolver-encryption`, `openrouter-cache`, `openrouter-limits`, `openrouter`
   - `packages/runner/tests/`: `ai-estimate-cap`, `ai-gemini-models`, `audit-settings-routes`, `beta`, `scan-build-secrets`, `scan-commit-secrets`
   - `packages/wizard/tests/`: `audit-document-settings.test.tsx`
   (all `.test.ts` unless named otherwise). Never print or copy a matched value.
2. `.gitleaks.toml`: replace the one broad path with a list of those exact files, one anchored regex per line, and a comment saying why:

```toml
[allowlist]
description = "Test files that hold fake keys on purpose. A new test file is scanned."
paths = [
  '''^packages/core/tests/ai-provider\.test\.ts$''',
  '''^packages/core/tests/openrouter\.test\.ts$''',
  # ... one line per file from step 1
]
```

   Keep `useDefault = true`. The `paths` key must stay (see Current code).
3. `scan-commit-secrets.test.ts` (`:113-121`): keep the assertion for `ai-provider.test.ts`, and add `expect(allowed('packages/core/tests/brand-new.test.ts')).toBe(false)` and `expect(allowed('packages/runner/tests/helpers/anything.ts')).toBe(false)`. Rename the test to "reads the project's .gitleaks.toml allowlist: named test files only".
4. Workflows: replace each `node-version: 22` with `node-version-file: .nvmrc` in `ci.yml`, `deploy.yml`, `tests.yml` and `release.yml`. In `.github/workflows/qa-check.yml` the repository is checked out into `.qa-tool`, so use `node-version-file: .qa-tool/.nvmrc`. Keep the `cache: pnpm` lines as they are. Do not touch `templates/qa-check.yml` (the file people copy; T-376 owns it and its Node line is for their repository).
5. Run `pnpm exec prettier --write` on the changed files.

## Tests

`pnpm exec vitest run packages/runner/tests/scan-commit-secrets.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`. If gitleaks is installed, run `gitleaks git --config .gitleaks.toml --redact --no-banner --exit-code 1 .` from the repository root: it must exit 0. That run is also the check that the named list is complete: a missing file shows as a finding (file and rule only; never paste the value).

## Done when

- [ ] `grep -c "tests/" .gitleaks.toml` is greater than 1 and no line allows the whole `tests/` folder (`grep -n "tests/'''" .gitleaks.toml` finds only anchored single-file lines).
- [ ] `grep -rn "node-version: 22" .github/workflows` prints nothing; `grep -rn "node-version-file" .github/workflows` finds every `setup-node` step.
- [ ] The scan-commit-secrets test passes; the gitleaks run (CI's `secret-scan`) passes.

## Notes

- Audit finding L5, remainder (audit of 11 Nov 2026 on `d225418`). The brief said to allowlist named fake-key regexes. This ticket allowlists named files instead, because `scripts/scan-commit-secrets.mjs` only understands `paths`. Switching to value regexes in gitleaks needs that script to learn them: a follow-up, not here.
- Not repeated here: the duplicated audit and secret-scan jobs (T-226), the Dependabot entry for the site image (T-274), the repeated build in `release.yml` (T-279).
- T-225 pins the actions and T-226 moves the audit and secret-scan jobs in the same files: build this after both, or merge by hand.
- `.nvmrc` is the single place for the Node major. `engines` (`>=22.9.0`) and the Dockerfile base are separate (see T-383).
