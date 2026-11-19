# T-425: Popups covered by context-level routes

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | security | todo |

**Files you may edit (no others):**
- `packages/core/src/competitive/safe-crawler.ts` (lines 187-223: `page.route` becomes `context.route`)
- `packages/core/src/discovery/guard.ts` (the page-level guard at line 31 becomes context-level)
- `packages/core/src/browser.ts` (context set-up only)
- `packages/core/tests/safety-popups.test.ts` (new)

**Do not build in parallel with:** T-424 (same context set-up). Build after it.

## Problem

`competitive/safe-crawler.ts:187-223` is the strongest guard: it aborts changing requests and off-host navigation. It uses `page.route`, so a popup (`window.open`, `target="_blank"`) opens a page with no guard. `guardPage` (`discovery/guard.ts:31`) is also page-level. Review A3 and B.

## Change

- Install the guards with `context.route`, so every page of the context, popups included, is covered.
- Listen to `context.on('page')`. A popup to a host outside the Domain Allowlist is closed at once and recorded; an allowed popup is guarded like its opener.
- Keep the page-level helper as a thin wrapper, so callers do not change.

## Tests (write the failing test first)

- A click that opens a popup which sends a POST: the POST is aborted.
- A popup to another host is closed and recorded.
- A popup to an allowed host opens and is guarded.

## Done when

The tests pass, and no popup can send a changing request or stay open on an off-site page.
