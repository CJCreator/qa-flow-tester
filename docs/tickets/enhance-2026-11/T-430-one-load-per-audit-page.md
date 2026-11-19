# T-430: One load per audit page

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | speed | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/pipeline/page-recorder.ts`
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/core/src/audit/speed/browser-timing.ts`
- `packages/core/src/audit/phone-layout.ts`
- tests

**Do not build in parallel with:** T-407 (it also edits `crawl.ts`).

## Problem

After T-404 and T-405, every page that PageSpeed Insights does not measure is loaded through the pacer three times: once by the crawl, once by the lab queue (axe and the phone screenshot), and once for timing.

At the polite maximum of 2 starts a second (ADR 0046), 5,000 pages need at least 125 minutes. The owner's target is 2 hours (L1 report, 2026-11-19).

## Change

- **Lab reuses the crawl's page:** the lab queue runs axe and the phone screenshot on the page the crawl already opened. The crawl worker hands the open page to the lab queue and opens a new one for itself. This removes one load.
- **Timing load as the only lab load:** browser timing stays a separate, throttled load, because it must start from a cold cache. The lab work then runs on that timing load where possible.
- **Target:** at most 2 pacer starts per page, and 1 for pages PSI measures.
- **Keep:** the pacer's back-off, and any page that answers 429 or 503 is still not scanned.

## Tests

- A 20-page routed site causes at most 40 page starts, and every page still gets its axe, phone and timing results.

## Done when

The test passes. On the large benchmark site, 5,000 pages finish within the 2-hour budget (benchmark pending until T-411 has a baseline).
