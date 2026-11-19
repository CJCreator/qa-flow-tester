# T-431: Improved version gaps from L3

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core, runner, wizard | feature, bug | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/improve/variants.ts`
- `packages/core/src/audit/pipeline/page-recorder.ts` (the desktop screenshot only)
- `packages/core/src/audit/store/shares.ts`
- `packages/runner/src/routes/audit-share.ts`
- `packages/runner/src/routes/audit-improve.ts`
- the runner's AI settings route (grep `api/ai/settings`)
- `packages/wizard/src/screens/audit/improved/*`
- `packages/wizard/src/screens/audit/saved/PreviewShareScreen.tsx`
- tests

**Do not build in parallel with:** T-430 (it also edits `page-recorder.ts`).

## Problem

L3 reported four gaps after T-412 to T-415 (2026-11-19):
1. **Budget:** `makeVariants` has `TODO(T-398)`. Variant AI calls do not count toward the audit AI request counter, which is now merged in `audit/ai/stage-ai.ts`.
2. **Before picture:** no 1440 px screenshot is stored, so "before" shows the phone screenshot only. ADR 0049 asks for both widths.
3. **Shared Links:** a Shared Link cannot include the Improved version.
4. **Bug:** with Google sign-in (ADC) as the only AI access, `/api/ai/settings` reports `configured: false`, so the Improved version buttons stay off although the runner would accept the request.

## Change

1. Count every variant call through the T-398 counter. When the budget is reached, the variant is "not done" with the reason.
2. Store one 1440 px screenshot per Sample Page while the page is open, using no extra page load (keep T-430's limit of 2 starts per page). Before/after shows both widths.
3. A Shared Link can include the Improved version: it is snapshot with the link, and revoke and expiry apply.
4. `/api/ai/settings` reports ADC as configured when ADC works on a local runner, so the buttons turn on.

## Tests

- The counter stops variants at the budget.
- Before/after has both screenshots.
- A shared link shows the variants and is gone after revoke.
- The settings route reports configured with ADC only.

## Done when

All four tests pass.
