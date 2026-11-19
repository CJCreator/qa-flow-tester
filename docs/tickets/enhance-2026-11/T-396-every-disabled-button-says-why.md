# T-396: Every disabled button says why (W20)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | wizard | ux, a11y | todo |

**Files you may edit (no others):**
- `packages/wizard/src/components/DisabledReason.tsx` (new)
- every wizard file with a `disabled=` button that lacks a reason
- `packages/wizard/tests/disabled-reasons.test.tsx` (new)
- `docs/PRODUCT_GUIDE.md` (the "Disabled actions" section only)

**Build last (wave 10, after T-415 and T-420)**, so it covers every new screen, the Improved version screens included. It does not run beside any other wizard ticket.

## Problem (verify first)

The guide promises a reason line beside every disabled button (`PRODUCT_GUIDE.md:112`). The review found about 90 `disabled=` sites, and only about 9 have `aria-describedby`. Recount before starting. Examples:
- `components/plan/PlanDocument.tsx:629,973`
- `screens/audit/documents/ExportDocumentsScreen.tsx:278,308,337`
- `screens/audit/saved/HelpersScreen.tsx:136`

## Change

- Add a `DisabledReason` component. It renders the reason line and returns its id for `aria-describedby`.
- Use it on every disabled button.
- A busy state uses one shared line ("Working…") in a live region.

## Tests

A test renders each screen. It fails when a disabled `button` has no `aria-describedby` pointing at visible text.

## Done when

The test passes on every screen, and the W20 note is removed from the guide.
