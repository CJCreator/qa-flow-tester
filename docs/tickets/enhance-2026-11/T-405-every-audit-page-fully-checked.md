# T-405: Every audit page fully checked (ADR 0047)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core, docs | coverage | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/pipeline/page-recorder.ts`, `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/src/audit/analysis/analyse-site.ts` (if sample-only checks live there)
- `docs/PRODUCT_GUIDE.md` (the Website Audit "Crawl" bullet)
- `docs/adr/0047-every-audit-page-fully-checked.md` (set the status to Accepted)
- tests

**Depends on:** T-404.

## Problem

Only Sample Pages get the browser checks (3 per Layout Group, `plan/sampling.ts:5`). The owner wants every page checked.

## Change

- Every recorded page goes to the T-404 lab queue: axe, phone layout, and timing (PSI for up to 20 pages, the browser for the rest).
- Sample Pages stay for the Improved version (ADR 0049) and for AI recommendations.
- Update the guide's "Crawl" bullet to match.

## Tests

A 30-page routed site has axe and phone results for all 30 pages.

## Done when

The test passes. On the large benchmark site (local), every recorded page has accessibility and phone-layout results, and the run takes under 2 hours for 5,000 pages, or the ticket reports the measured time.
