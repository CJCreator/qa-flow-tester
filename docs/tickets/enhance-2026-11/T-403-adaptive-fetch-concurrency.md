# T-403: Adaptive fetch concurrency (ADR 0046)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core, types | speed | todo |

**Files you may edit (no others):**
- `packages/core/src/host-pacer.ts`
- `packages/core/src/discovery/deterministic-spider.ts` (the worker clamp only)
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/types/src/website-audit.ts` (`AUDIT_LIMIT_DEFAULTS`)
- `packages/core/tests/host-pacer.test.ts`, `packages/core/tests/audit-crawl-browser.test.ts`
- `docs/adr/0046-adaptive-fetch-concurrency-in-the-website-audit.md` (set the status to Accepted)

**Depends on:** T-401 and T-411 (the baseline).

## Problem

- The audit fetches at most 3 pages at once, with 500 ms between page starts (`crawl.ts:52,69`).
- The spider clamps its workers to 5 (`deterministic-spider.ts:411`).
- That is too slow for the 5,000-page target.

## Change

- **`HostPacer` options:** `maxInFlight`, `ceiling` and `climbEvery` (default 25).
- **Climb:** add 1 after every `climbEvery` answers with no 429, 503 or Retry-After.
- **Ceilings:** 8 local and 3 hosted (`fetchInFlightLocal`, `fetchInFlightHosted` in `AUDIT_LIMIT_DEFAULTS`).
- **Rate:** the 500 ms gap stays, which caps it at 2 starts per second.
- **Back-off:** follows ADR 0043. A 429 or 503 stops the climb for the rest of the audit.
- **Spider:** the worker clamp becomes an option equal to the pacer's ceiling.

## Tests

- **Pacer unit:** it climbs from 3 to 8 over 125 healthy answers, never starts 2 pages within 500 ms, and falls to 1 after a 429 and stays there.
- **Browser tier:** a robots Crawl-delay keeps 1 page in flight.

## Done when

The tests pass. On the large benchmark site, crawl time drops at least 30% against the T-411 baseline, with no 429 answers.
