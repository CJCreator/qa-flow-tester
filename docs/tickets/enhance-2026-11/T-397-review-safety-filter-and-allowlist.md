# T-397: Review Safety Filter and Domain Allowlist enforcement

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | security review | todo |

**Files you may edit (no others):** `docs/reviews/2026-11-19-product-review.md` (one new section), `docs/tickets/INDEX.md` (follow-up rows), new tests `packages/core/tests/safety-filter-*.test.ts`.

## Problem

The 19 November review did not read `packages/core/src/discovery/safety-filter.ts`, `discovery/guard.ts` or the Domain Allowlist path.

## Change

Read those files and record, with file and line, what they enforce:
- Does every Sensitive Action pause before the browser acts? Include keyboard submits and clicks driven by JavaScript.
- Does every navigation, redirect and new tab stay inside the Domain Allowlist? Check the crawl, Tests and the Benchmark.

For each gap, write a failing test and add one follow-up ticket row to `INDEX.md`.

## Done when

The review has a "Safety Filter and Domain Allowlist" section. Either every gap found has a test and a ticket, or the section says "none found" and lists what was checked.
