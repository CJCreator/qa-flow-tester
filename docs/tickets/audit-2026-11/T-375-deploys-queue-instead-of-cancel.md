# T-375: A new push queues behind a running deploy instead of cancelling it

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | ci | bug | todo |

**Files you may edit (no others):**

- `.github/workflows/deploy.yml`

**Do not build in parallel with:** T-225, T-226, T-374, T-376, T-381 (all edit `deploy.yml`).

## Problem

`deploy.yml` has `concurrency: group: deploy, cancel-in-progress: true` (`deploy.yml:28-30`). If a second push to `main` lands while a deploy is running, GitHub cancels the first run wherever it is. The cancel can fall between the two deploy jobs, or between `gcloud run deploy` and the check that follows it. The runner (hosted copy) and the static site can then end on different commits, and a half-finished rollout is never verified.

With `cancel-in-progress: false`, GitHub keeps the running deploy and holds one newer run in the queue. That newer run takes the latest commit when it starts. A run waiting in the queue is replaced by a still newer one, so an old commit is never deployed after a newer one.

## Current code

Branch from `main`. `grep -n -B3 -A3 "cancel-in-progress" .github/workflows/deploy.yml`.

```yaml
# One deploy at a time. If a new commit is pushed to main while a previous run is in progress,
# the older run is cancelled to immediately deploy the latest code without queuing delays.
concurrency:
  group: deploy
  cancel-in-progress: true
```

## Change

1. Replace those lines with:

```yaml
# One deploy at a time. A push while a deploy is running waits for it: cancelling mid-rollout could leave the runner
# and the site on different commits. GitHub keeps only the newest waiting run, so the latest commit still goes out.
concurrency:
  group: deploy
  cancel-in-progress: false
```

2. Change nothing else in the file.

## Tests

None. `pnpm exec prettier --check .github/workflows/deploy.yml`.

## Done when

- [ ] `grep -n "cancel-in-progress" .github/workflows/deploy.yml` prints `cancel-in-progress: false`.
- [ ] The stale comment is gone: `grep -n "cancelled to immediately" .github/workflows/deploy.yml` prints nothing.
- [ ] Prettier check passes.

## Notes

- Audit finding M12 (audit of 11 Nov 2026 on `d225418`).
- A deploy can take up to 30 minutes (`timeout-minutes: 30` on `cloud-run`), so a queued run can wait that long. That is the price of never publishing a mix.
- `ci.yml` keeps `cancel-in-progress: true` (`ci.yml:11-13`): CI runs are only checks, and a cancelled check is harmless.
- T-374 and T-225 also edit `deploy.yml`.
