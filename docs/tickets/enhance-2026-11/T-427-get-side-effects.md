# T-427: GET side effects

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | security | todo |

**Files you may edit (no others):**
- `packages/core/src/discovery/safety-filter.ts` (a new `isSideEffectAddress`)
- `packages/core/src/live-site.ts` (`blockChanges` at line 95 and the navigation check near line 130)
- `packages/core/src/discovery/deterministic-spider.ts` (the link-enqueue check only)
- `packages/core/tests/safety-get-side-effects.test.ts` (new)

**Do not build in parallel with:** T-423, T-424, T-426, T-428 (they edit `deterministic-spider.ts`; keep this change to the enqueue check).

## Problem

`blockChanges` (`live-site.ts:95`) aborts POST, PUT, PATCH and DELETE, so a changing GET goes through: `/logout?confirm`, `/delete?id=1`, `/unsubscribe?token=...`. `isSensitive` reads the element's text, not the address. A crawler that follows such a link signs the user out or deletes data. Review A2.

## Change

- Add `isSideEffectAddress(url)`. It matches path segments and query keys such as `logout`, `signout`, `delete`, `remove`, `unsubscribe`, `cancel`, `confirm`, `activate` and `reset`.
- The Spider does not enqueue such an address. It is recorded as a Skipped Page with reason `excluded` and the note "possible side effect".
- In a read-only run, `blockChanges` also aborts a navigation to such an address.
- An address on the person's include list, or one named in a Plan Item they approved, is allowed.

## Tests (write the failing test first)

- A page linking to `/logout?confirm=1` and `/delete?id=1`: neither is requested.
- `/products?id=1` is crawled.
- The include list allows `/delete?id=1`.

## Done when

The tests pass, and a crawl of a page that links to `/logout?confirm` does not sign the session out.
