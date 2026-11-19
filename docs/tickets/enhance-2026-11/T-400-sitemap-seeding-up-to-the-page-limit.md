# T-400: Sitemap seeding up to the page limit

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | limits | todo |

**Files you may edit (no others):** `packages/core/src/discovery/deterministic-spider.ts` (the sitemap block only), `packages/core/tests/sitemap-seed.test.ts` (new).

**Do not build in parallel with:** T-401, T-403, T-404, T-405, T-407 (crawl chain; this is its first ticket).

## Problem

The sitemap seed stops at 200 addresses, whatever `maxPages` is set to:
- `deterministic-spider.ts:640`: `if (locCount >= 200 || timeLeft() <= 0 …) break;`
- `:663`: `if (locCount >= 200) break;`

It also follows at most 25 sitemap files (`:657`) and fetches them one at a time (`for … await outboundFetch`). Addresses past 200 are never queued, so they don't show up even as Skipped Pages.

## Change

- Seed up to `maxPages`.
- Fetch sitemap files 4 at a time through the same `outboundFetch`, keeping the 10 MB body limit (`SITEMAP_MAX_BYTES`).
- Raise the cap on sitemap files to 100.
- Every sitemap address past the limit becomes a Skipped Page with reason `page-limit`, so `recorded + skipped == unique sitemap addresses`.

## Tests

A routed sitemap index with 3 files and 1,200 addresses, and `maxPages` 1000: 1,000 are queued and 200 are skipped as `page-limit`.

## Done when

The test passes. On the large benchmark site (T-411), coverage reports every sitemap address.
