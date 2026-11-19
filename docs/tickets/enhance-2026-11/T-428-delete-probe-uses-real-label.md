# T-428: The delete probe uses the real element label and `forbiddenActions`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | security | todo |

**Files you may edit (no others):**
- `packages/core/src/discovery/deterministic-spider.ts` (the delete probe at lines 1446-1452 only)
- `packages/core/tests/safety-delete-probe.test.ts` (new)

**Do not build in parallel with:** T-423, T-424, T-426 (Spider chain). Build last in that chain.

## Problem

The delete probe tests the constant `isSensitive('Delete', '')` (`deterministic-spider.ts:1446-1452`). The answer never depends on the element, so the probe cannot tell a Delete button for a draft from one for an account. It also ignores `forbiddenActions` (`packages/types/src/evidence-finding.ts:153`), the profile's own restrictions. Review A3.

## Change

- Call `isSensitive` with the element's real label and its `aria-label`.
- Check the label against the profile's `forbiddenActions`. A match is not probed.
- A probe that is skipped is recorded with the reason, as a fact the Plan can use.

## Tests (write the failing test first)

- A "Delete account" control is not probed, and a profile `forbiddenActions` entry of "Remove draft" stops that probe.
- A control labelled "Delete row" on a Test Copy is probed as before.

## Done when

The tests pass, and the probe's decision changes with the element and the profile.
