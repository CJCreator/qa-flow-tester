# T-421: A click-time Sensitive Action gate

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | security | todo |

**Files you may edit (no others):**
- `packages/core/src/orchestrator.ts` (the click step only, near lines 920-928)
- `packages/core/src/discovery/click-gate.ts` (new)
- `packages/core/tests/safety-click-gate.test.ts` (new)

**Do not build in parallel with:** T-408, T-422, T-424 (orchestrator chain). Build after T-408.

## Problem

The Safety Filter is a text match made while the Plan is built (`discovery/safety-filter.ts:12`). The Check-up run never calls it: `orchestrator.ts:920-928` runs `locator.click()` straight from the Plan. `sendGuard` (`send-guard.ts:46`) is passive. On a Test Copy nothing blocks a click, so a Plan Item whose target is a Sensitive Action runs. See the review section "Safety Filter and Domain Allowlist", A1 and A2.

## Change

- Add `clickGate(locator, planItem)`. Before every `click` step it reads the element's accessible name, visible text, `value` and `aria-label`, and calls `isSensitive` with them.
- A Sensitive Action is not clicked. The step ends as skipped with the reason "Sensitive Action: paused by the Safety Filter", and the Plan Item is not a pass and not a failure.
- A Plan Item the person approved in Plan Review as a Sensitive Action on a Test Copy still runs. The approval is the pause the glossary describes.
- The gate also runs for Roles' steps and for retries.

## Tests (write the failing test first)

- A Plan with a "Delete account" button click does not call `locator.click()`; the step is skipped with the reason.
- The same item, approved in Plan Review on a Test Copy, is clicked.
- A "Save" button is clicked as before.

## Done when

The tests pass, and a Check-up of a page with a "Delete" button leaves the button unclicked.
