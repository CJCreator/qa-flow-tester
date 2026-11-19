# T-404: Lab work off the crawl workers

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | speed | todo |

**Files you may edit (no others):** `packages/core/src/audit/pipeline/page-recorder.ts`, `packages/core/src/audit/crawl/crawl.ts`, `packages/core/src/audit/pipeline/pipeline.ts` (lab queue wiring), `packages/core/src/audit/speed/browser-timing.ts`, `packages/core/src/audit/ai/pagespeed.ts`, tests.

**Depends on:** T-403.

## Problem

Each Sample Page's lab work runs inside the crawl worker, one step after another: read the page, run axe, do a throttled reload for timing, then take a phone screenshot (`page-recorder.ts`; awaited at `crawl.ts:478-483`). That slot and a pacer slot stay busy the whole time.

Pages that PageSpeed Insights also measures are timed twice: once by the browser reload (`page-recorder.ts:119-121`, `browser-timing.ts:292`) and once by PSI (`pipeline.ts:509-530`).

## Change

- The crawl worker only reads the page and records Page Content. Lab work (axe, timing, phone layout) moves to a lab queue with its own pages. It holds at most 2 pages at once on the hosted copy and 4 locally, and the reload still waits for the pacer.
- Pages chosen for PSI, the first 20 for which a PSI key is available, skip the browser timing reload. If PSI fails for a page, that page gets browser timing afterwards.

## Tests

- `audit-pipeline.test.ts`: lab work for 10 pages finishes after the crawl does, and the crawl never waits for lab work.
- A page measured by PSI gets no reload.

## Done when

The tests pass. On the 300-page benchmark run, total audit time drops at least 25% against the baseline, and findings overlap the baseline at Jaccard ≥ 0.95.
