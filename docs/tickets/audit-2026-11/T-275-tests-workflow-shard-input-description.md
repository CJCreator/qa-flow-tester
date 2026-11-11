# T-275: `tests.yml` shard input describes both shard counts

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | ci | wrong-text | todo |

**Files you may edit (no others):**

- `.github/workflows/tests.yml`

**Do not build in parallel with:** T-225 (also edits `tests.yml`: it changes the `uses:` lines). Either order works if you only touch the lines named here, but do not build them at the same time.

## Problem

The `shard` input says "as N/4 (for example 2/4)". The unit project runs 2 shards (`ci.yml` and `deploy.yml` pass `1/2` and `2/2`) and the browser project runs 4 (`e2e-nightly.yml` passes `1/4` to `4/4`). A reader would think the count is always 4.

## Current code

Branch from `main`. `grep -n "description" .github/workflows/tests.yml`.

`.github/workflows/tests.yml` lines 7-11:

```yaml
inputs:
  shard:
    description: 'Which part of the suite to run, as N/4 (for example 2/4).'
    required: true
    type: string
```

## Change

Replace the description line with:

```yaml
description: 'Which part of the suite to run, as N/M, passed to vitest --shard. Unit runs 1/2 and 2/2; browser runs 1/4 to 4/4.'
```

Change nothing else.

## Tests

`pnpm exec prettier --check .github/workflows/tests.yml`, then `pnpm exec vitest run packages/runner/tests/release-workflow.test.ts` (it does not read `tests.yml`, but it is the quick check that workflow text still parses for the neighbouring tests).

## Done when

- [ ] `grep -c "N/4" .github/workflows/tests.yml` prints 0.
- [ ] `grep -c "N/M" .github/workflows/tests.yml` prints 1.
- [ ] Prettier check passes.

## Notes

- Finding dropped on purpose: a shared build artifact for the four nightly browser shards. The shards run in parallel, so the nightly wall time does not change; the only saving would be a few runner minutes on a job that runs once a night, and the artifact upload and download costs part of that back. Do not add one.
