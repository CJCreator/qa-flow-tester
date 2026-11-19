# T-423: The Spider's exploring click runs under `guardPage`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | security | todo |

**Files you may edit (no others):**
- `packages/core/src/discovery/deterministic-spider.ts` (the exploring click near line 1385 only)
- `packages/core/tests/safety-spider-click.test.ts` (new)

**Do not build in parallel with:** T-424, T-426, T-428 (Spider chain). Build first in that chain.

## Problem

The Spider's exploring click (`deterministic-spider.ts:1385`) is not under `guardPage` (`discovery/guard.ts:31`). `guardPage` is used only in `interactive-states.ts:60` and `crud-facts.ts:102`. A click that the Spider chose for exploring can fire a changing request. Review A3.

## Change

- Wrap the exploring click in `guardPage`, so changing requests (POST, PUT, PATCH, DELETE) are aborted for the duration of the click and the page's `form.submit` is neutralised.
- An aborted request is counted and kept as a fact ("blocked a changing request"), not an error.
- Do not change which elements the Spider clicks.

## Tests (write the failing test first)

- A page whose clickable element fires `fetch(url, { method: 'POST' })` records no request to the server during the Spider's click.
- The Spider still follows a plain link click as before.

## Done when

The tests pass, and a Spider run against a page with a POST-on-click button changes nothing on the server.
