# T-414: Variant quality gate

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | quality | todo |

**Files you may edit (no others):** `packages/core/src/audit/improve/quality-gate.ts` (new), `packages/core/src/audit/improve/variants.ts`, `packages/wizard/src/screens/audit/improved/ImprovedVersionScreen.tsx`, tests.

**Depends on:** T-413.

## Change

The gate is automatic only; the owner chose this on 2026-11-19. A variant is shown only when all of the following pass:

1. **Sanitizer:** `sanitizePreviewHtml` reports nothing removed that would break the page (script, form or off-site frame).
2. **Menu links:** every menu link of the original page is present and stays on the same site.
3. **Claim words:** `findClaimWords` finds none.
4. **Accessibility:** an axe scan of the variant, rendered through `setContent` in the lab browser, finds no Blocker.
5. **Citations:** every `data-finding` and `data-section` marker resolves to an id in this audit version.

A variant that fails is not shown. The screen says which check failed and offers **Try again**, which makes a single new AI call.

## Tests

One fixture variant per check, each made to fail that check.

## Done when

All five checks are tested. On the benchmark sites, the share of variants that pass is reported.
