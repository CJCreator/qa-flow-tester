# T-411: Benchmark harness and baseline

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | scripts, docs | measurement | todo |

**Files you may edit (no others):**
- `scripts/benchmark-audit.mjs` (new), `scripts/benchmark-checkup.mjs` (new)
- the root `package.json` (`bench:audit`, `bench:checkup`)
- `packages/core/src/audit/pipeline/pipeline.ts` (stage start and end times in `stages`, if missing)
- `docs/TESTING.md` (a "Benchmarks" section)
- `.benchmark/` stays git-ignored (generated output)

**Do not build in parallel with:** T-390 (`pipeline.ts`).

## Problem

There is no measured baseline, so the review's speed figures are estimates.

## Change

- **Sites:**
  - techgramam.com (about 19 sitemap addresses)
  - arocord.com (its sitemap answers 403 to plain clients, which makes it the blocked-visitor case)
  - mghealthtech.com (about 30 addresses)
  - one large public documentation site whose robots.txt allows crawling, local runs only

  Pick the large site in this ticket and record why its robots.txt allows the crawl.
- **Runs:** 3 per site, on the local runner. Report the median.
- **Metrics:**
  - wall time per stage
  - pages recorded and skipped, by reason
  - AI calls and tokens
  - 429 count
  - peak RSS
  - for a Check-up: run time, Test points, Flaky Passed
- **Accuracy:** the set of `(rule, urlPath)` findings, compared with Jaccard overlap.
- **Output:** `.benchmark/<date>-<commit>.json`, plus a Markdown table appended to `docs/TESTING.md`.
- **Baseline:** commit `b23682c`.

## Done when

The baseline table for all four sites is in `docs/TESTING.md`. Every speed ticket (T-403, T-404, T-406, T-408, T-409, T-410) reports its change against it.
