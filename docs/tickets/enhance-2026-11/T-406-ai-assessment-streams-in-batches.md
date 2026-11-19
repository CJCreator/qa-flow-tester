# T-406: AI assessment streams with the crawl, in batches

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | speed, AI | todo |

**Files you may edit (no others):** `packages/core/src/audit/ai/assessment.ts`, `packages/core/src/audit/ai/page-recommendation.ts`, `packages/core/src/audit/pipeline/pipeline.ts`, tests.

**Depends on:** T-405 and T-398 (budget).

## Problem

These stages wait for the whole crawl, then run one after another:
1. `assessPages` (`pipeline.ts:636`)
2. `assessSite` (`:679`)
3. `recommendPages` (`:720`)

`assessPages` makes one AI call per recorded page, 4 at a time (`AUDIT_AI_IN_FLIGHT = 4`, `assessment.ts:101`). One call may take up to 120 s (`ai/timeout.ts:7`).

## Change

- **Stream:** a page is queued for assessment as soon as it is recorded.
- **Batch:** pages under 1,500 words of Page Content go up to 4 per call. Each answer names its `urlPath`. An answer that cites a page not in its batch is dropped and that page is asked again alone.
- **Concurrency:** use the provider's reported limit when there is one (`ai-budget.ts`), up to 8. Otherwise keep 4.
- **Order:** `recommendPages` starts as soon as its Sample Pages are assessed. `assessSite` still waits for every page.

## Tests

- A batch of 4 pages gives 4 assessments, each citing its own page.
- A wrong citation causes a single re-ask.
- AI work starts before the crawl ends.

## Done when

The tests pass. On the 300-page benchmark run, the time from the end of the crawl to the documents falls by at least 50%, and no finding cites the wrong page.
