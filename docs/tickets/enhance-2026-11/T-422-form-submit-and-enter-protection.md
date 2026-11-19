# T-422: `form.submit`, `requestSubmit` and Enter protection in Test runs

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | security | todo |

**Files you may edit (no others):**
- `packages/core/src/orchestrator.ts` (the page set-up and the `press` and `fill` steps only)
- `packages/core/src/discovery/submit-guard.ts` (new; shares the init script with `competitive/safe-crawler.ts:116-119`)
- `packages/core/src/competitive/safe-crawler.ts` (move the init script out, same behaviour)
- `packages/core/tests/safety-submit-guard.test.ts` (new)

**Do not build in parallel with:** T-421, T-424 (orchestrator chain).

## Problem

`form.submit` and `requestSubmit` are neutralised only in `competitive/safe-crawler.ts:116-119`. In a Test run, JavaScript on the page or a key press can submit a form that holds a Sensitive Action, with no check. `blockChanges` (`live-site.ts:95`) applies only to read-only runs (`orchestrator.ts:774`). Review A2 and A3.

## Change

- Move the init script that replaces `HTMLFormElement.prototype.submit` and `requestSubmit` into `submit-guard.ts`, and install it on the browser context of every run that is not allowed to send forms (any App that is not a Test Copy).
- On a Test Copy, the guard checks the form: when its submit control or action is a Sensitive Action (`isSensitive`), the submit is cancelled and the step is skipped with the reason "Sensitive Action: paused by the Safety Filter". Other forms submit as the Plan says.
- Enter pressed in a field is a submit. The `press` step runs the same check on the focused field's form before the key goes down.

## Tests (write the failing test first)

- On a read-only run, `form.submit()` and `form.requestSubmit()` called from page script send no request.
- On a Test Copy, a form whose button says "Delete" is not submitted by Enter.
- A sign-in form on a Test Copy still submits.

## Done when

The tests pass, and no run reaches a form submit it should not, by click, script or key.
