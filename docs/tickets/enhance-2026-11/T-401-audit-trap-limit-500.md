# T-401: Audit trap limit of 500 per address shape

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | limits | todo |

**Files you may edit (no others):** `packages/core/src/audit/crawl/crawl.ts` (the spider options only), `packages/core/tests/audit-crawl-limits.test.ts`.

**Depends on:** T-400 (crawl chain).

## Problem

`CrawlFrontier` keeps at most 25 addresses per shape: `maxPerShape ?? 25` (`frontier.ts:109`; spider `:428`). A shape replaces only digit runs, UUIDs and hex tokens of 6 or more characters (`frontier.ts:83-89`). As a result, a shop with `/p/12345` addresses stops at 25 products. The audit passes no override (`crawl.ts:407-427`).

## Change

The Website Audit passes `maxPerShape: 500`. Calendar-style traps such as `/2026/11/19` still stop at 500. The Check-up stays at 25.

## Tests

- 600 routed `/p/<n>` addresses with `maxPages` 1000: 500 are recorded and 100 are skipped as `trap-limit`.
- The Check-up still stops at 25.

## Done when

Both tests pass.
