# T-225: Pin every GitHub Action to a commit SHA

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | ci | security | todo |

**Files you may edit (no others):**
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/tests.yml`
- `.github/workflows/release.yml`
- `.github/workflows/qa-check.yml`
- `.github/workflows/e2e-nightly.yml`

**Do not build in parallel with:** T-226, T-227, T-228 (all edit `ci.yml`). Build this one last of the four.

## Problem

Only `pnpm/action-setup` is pinned to a commit SHA. Every other action is pinned to a moving tag (`@v4`, `@v2`). A moving tag can be repointed by whoever controls that repository, and the deploy workflow holds Google Cloud credentials.

## Current code

Branch from `main`. List every use: `grep -n "uses:" .github/workflows/*.yml`.

Already pinned (leave as is):

```yaml
- uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0
```

Not pinned (every occurrence, in all six files):

| Action | Tag today |
|---|---|
| `actions/checkout` | `v4` |
| `actions/setup-node` | `v4` |
| `actions/cache` | `v4` |
| `actions/upload-artifact` | `v4` |
| `actions/download-artifact` | `v4` |
| `google-github-actions/auth` | `v2` |
| `google-github-actions/setup-gcloud` | `v2` |

Lines of the form `uses: ./.github/workflows/tests.yml` are local reusable workflows. Do not touch them.

## Change

1. For each action in the table, find the newest release inside the same major version and its commit SHA. Do not guess a SHA and do not copy one from memory. Use:

```sh
gh api repos/actions/checkout/releases --jq '[.[] | select(.tag_name | startswith("v4."))][0].tag_name'
gh api repos/actions/checkout/commits/<that tag> --jq .sha
```

   Repeat with the other six repositories (`actions/setup-node`, `actions/cache`, `actions/upload-artifact`, `actions/download-artifact`, `google-github-actions/auth`, `google-github-actions/setup-gcloud`; for the last two use `startswith("v2.")`). The SHA must be 40 hex characters. If `gh` is not signed in or a call fails, set this ticket to `blocked` with the error and stop.

2. Replace every `@v4` / `@v2` of those seven actions with `@<sha> # <full tag>`, the same style as the `pnpm/action-setup` line. Example shape only (the SHA here is a placeholder, not a real one):

```yaml
- uses: actions/checkout@<40-hex-sha> # v4.x.y
```

3. Use the same SHA for an action everywhere it appears. Keep each step's `with:` block unchanged.

4. Run `pnpm exec prettier --check .github/workflows`.

## Tests

No new test. Three unit tests read workflow files; run them to confirm nothing they assert on changed:

`pnpm exec vitest run packages/runner/tests/release-workflow.test.ts packages/runner/tests/deploy-audit-store.test.ts packages/runner/tests/deploy-scheduler.test.ts`

## Done when

- [ ] `grep -n "uses:" .github/workflows/*.yml | grep -v "\./\.github" | grep -vE "@[0-9a-f]{40} # v"` prints nothing.
- [ ] Each of the seven actions uses one SHA across all files, with the tag in a trailing comment.
- [ ] The three tests above pass.

## Notes

- Dependabot keeps SHA pins current when `.github/dependabot.yml` has a `github-actions` entry. Check with `grep -n "github-actions" .github/dependabot.yml`. If it is missing, say so in your notes; adding it is not part of this ticket.
- Do not change action major versions here.
