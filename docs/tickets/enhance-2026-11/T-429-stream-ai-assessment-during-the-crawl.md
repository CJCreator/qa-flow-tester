# T-429: AI assessment starts during the crawl (the rest of T-406)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | speed | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/ai/assessment.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/src/audit/analysis/analyse-site.ts`
- `packages/core/src/audit/ai/stage-ai.ts`
- tests

**Do not build in parallel with:** T-407 (it also edits `pipeline.ts`).

## Problem

T-406 (`e4f1f44`) built batching (4 pages a call, with a re-ask on a wrong citation), and recommendations now start beside the assessments. Two parts were left out:
- **Streaming:** the AI assessment still starts after the crawl. A page's findings exist only after the site analysis (`analyse-site.ts`), so the AI has nothing to read sooner.
- **Concurrency:** `auditAiInFlight` is not wired, so no provider's limit reaches the audit.

## Change

- **Split the analysis:** each page's checks run as soon as the page is recorded. The checks that need the whole site (broken links, hierarchy, duplicates) still run after the crawl.
- **Start early:** a page's AI assessment starts once its own checks are done. The AI notes for the whole site still wait for all pages.
- **Wire the limit:** pass the provider's reported limit (`plan/ai-budget.ts`) into `auditAiInFlight`, at most 8. Without a reported limit, keep 4.

## Tests

- AI requests start before the crawl ends.
- The site-wide checks still see every page.
- Page findings match a run where nothing streams.

## Done when

The tests pass. On the 300-page benchmark, the time from the crawl's end to the documents falls by half (benchmark pending until T-411 has a baseline).
