# T-227: Give the CI quality gate a workable timeout

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | ci | broken | todo |

**Files you may edit (no others):**
- `.github/workflows/ci.yml`

**Do not build in parallel with:** T-225, T-226, T-228 (all edit `ci.yml`).

## Problem

The `quality-gate` job has `timeout-minutes: 5`. In that time it installs every dependency, lints the whole repository, checks formatting and type-checks all packages with an 8 GB heap. With a cold pnpm cache the job is cancelled before it finishes, which shows as a failed check with no error. The comment above it ("in ~30-45 seconds") is also wrong.

## Current code

Branch from `main`. `.github/workflows/ci.yml`:

```yaml
jobs:
  # Fast Quality Gate: Surfaces lint, formatting, and typecheck errors in ~30-45 seconds
  quality-gate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
```

## Change

Replace those lines with:

```yaml
jobs:
  # Quality gate: lint, formatting and typecheck. Runs beside the tests so these errors show first.
  quality-gate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
```

Change nothing else in the job.

## Tests

None. Run `pnpm exec prettier --check .github/workflows/ci.yml`.

## Done when

- [ ] `grep -n -A3 "quality-gate:" .github/workflows/ci.yml` shows `timeout-minutes: 15`.
- [ ] `grep -n "30-45 seconds" .github/workflows/ci.yml` prints nothing.

## Notes

- 15 matches the scale of the other jobs (`tests.yml` shards have 12, `build-secret-scan` has 30).
