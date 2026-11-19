# T-426: An off-site click navigation is undone and recorded

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | security, crawl | todo |

**Files you may edit (no others):**
- `packages/core/src/discovery/deterministic-spider.ts` (the exploring click's after-navigation handling near line 1392 only)
- `packages/core/tests/safety-offsite-click.test.ts` (new)

**Do not build in parallel with:** T-423, T-424, T-428 (Spider chain). Build after T-423.

## Problem

After an exploring click, an off-site page is only not enqueued (`deterministic-spider.ts:1392`). The page has already navigated away, and the Spider goes on from there: the next steps run on another host. Review B.

## Change

- After a click, when the page's address is outside the Domain Allowlist, go back (`goBack`; when that fails, reopen the page the click started from).
- Record it as a Skipped Page with reason `off-site-redirect`, with the clicked element's label.
- The Spider continues from the page it started on.

## Tests (write the failing test first)

- A click on a button that sets `location` to another host: the Spider returns to the start page, and the Skipped Page is recorded.
- A click that stays on the host is unchanged.

## Done when

The tests pass, and the Spider never runs a step on a host outside the Domain Allowlist.
