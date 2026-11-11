# T-226: CI and Deploy share one audit job and one secret-scan job

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | ci | duplication | todo |

**Files you may edit (no others):**
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/audit.yml` (new)
- `.github/workflows/secret-scan.yml` (new)

**Do not build in parallel with:** T-225, T-227, T-228 (all edit `ci.yml`). Build before T-225.

## Problem

Two things:

1. The `audit` job (dependency audit) and the `secret-scan` job (gitleaks over the history) are written out twice, once in `ci.yml` and once in `deploy.yml`. The copies are identical today (same gitleaks version `8.30.1`, same commands) and can drift. `deploy.yml` even has a comment explaining why they were copied.
2. A push to `main` starts both workflows, so on the main repository both jobs run twice for the same commit. `ci.yml` already skips `build-and-test` on a push for this reason.

## Current code

Branch from `main`.

`ci.yml`, jobs `audit` and `secret-scan` (find with `grep -n "^  audit:\|^  secret-scan:" .github/workflows/ci.yml`):

```yaml
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Audit production dependencies
        run: pnpm audit --prod --audit-level high

  secret-scan:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Install gitleaks
        env:
          GITLEAKS_VERSION: 8.30.1
        run: |
          base="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}"
          tarball="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
          cd "$RUNNER_TEMP"
          curl -sSfL -O "${base}/${tarball}"
          curl -sSfL -O "${base}/gitleaks_${GITLEAKS_VERSION}_checksums.txt"
          sha256sum --ignore-missing -c "gitleaks_${GITLEAKS_VERSION}_checksums.txt"
          tar -xzf "$tarball" gitleaks
      - name: Scan history
        run: '"$RUNNER_TEMP/gitleaks" git --config .gitleaks.toml --redact --no-banner --exit-code 1 .'
```

`deploy.yml` has the same two jobs, each with `if: github.repository == 'CJCreator/qa-flow-tester'`. Its deploy jobs depend on them by job id:

```yaml
    needs: [build-and-smoke, test, audit, secret-scan]
    ...
      needs.audit.result == 'success' && needs.secret-scan.result == 'success' &&
```

The existing reusable workflow `.github/workflows/tests.yml` shows the `workflow_call` pattern used in this repository.

## Change

1. Create `.github/workflows/audit.yml`: `name: Dependency audit`, `on: workflow_call`, `permissions: contents: read`, and one job `audit` holding the `runs-on`, `timeout-minutes` and `steps` shown above, copied exactly. Start the file with a one-line comment saying CI and Deploy both call it.

2. Create `.github/workflows/secret-scan.yml` the same way: `name: Secret scan`, `on: workflow_call`, `permissions: contents: read`, one job `scan` with the `secret-scan` steps copied exactly. Keep the comment "Scans the full git history for secrets. Output is redacted; no report is uploaded."

3. In `ci.yml`, replace the bodies of the two jobs. Keep the job ids `audit` and `secret-scan`:

```yaml
  # On a push to main in the main repository, Deploy runs this same job before it publishes.
  audit:
    if: github.event_name != 'push' || github.repository != 'CJCreator/qa-flow-tester'
    uses: ./.github/workflows/audit.yml

  secret-scan:
    if: github.event_name != 'push' || github.repository != 'CJCreator/qa-flow-tester'
    uses: ./.github/workflows/secret-scan.yml
```

4. In `deploy.yml`, replace the bodies the same way. Keep the job ids and the existing `if:`:

```yaml
  audit:
    if: github.repository == 'CJCreator/qa-flow-tester'
    uses: ./.github/workflows/audit.yml

  secret-scan:
    if: github.repository == 'CJCreator/qa-flow-tester'
    uses: ./.github/workflows/secret-scan.yml
```

   Replace the two comments above those jobs ("Same as ci.yml's audit job, repeated here ..." and "Same as ci.yml's secret-scan job ...") with one line each saying the job blocks the deploy on a finding. Do not change any `needs:` list or `needs.*.result` expression: the job ids are unchanged, so they still resolve.

5. A job that calls a reusable workflow cannot have `runs-on`, `timeout-minutes` or `steps`. Make sure none is left on the four caller jobs.

6. Run `pnpm exec prettier --write .github/workflows/audit.yml .github/workflows/secret-scan.yml .github/workflows/ci.yml .github/workflows/deploy.yml`.

## Tests

No new test. Run the tests that read workflow files:

`pnpm exec vitest run packages/runner/tests/release-workflow.test.ts packages/runner/tests/deploy-audit-store.test.ts packages/runner/tests/deploy-scheduler.test.ts`

If `actionlint` is installed (`actionlint -version`), run `actionlint .github/workflows/*.yml` and fix what it reports in the four files. If it is not installed, say so in your notes.

## Done when

- [ ] `grep -c "GITLEAKS_VERSION: " .github/workflows/*.yml` shows 1 for `secret-scan.yml` and 0 for every other file.
- [ ] `grep -c "pnpm audit --prod" .github/workflows/ci.yml .github/workflows/deploy.yml` shows 0 for both (`release.yml` keeps its own audit step and is not edited).
- [ ] `ci.yml` and `deploy.yml` still have jobs named `audit` and `secret-scan`, and `deploy.yml`'s `needs:` lists are unchanged.
- [ ] The three tests pass.

## Notes

- Not in this ticket: the lint step repeated in `ci.yml`, `deploy.yml` and `release.yml`, and the install steps. Each belongs to a different job with a different purpose.
- The workflows can only be proven by a run on GitHub. After the pull request opens, check that the `audit` and `secret-scan` checks appear and pass, and note the result in the ticket.
