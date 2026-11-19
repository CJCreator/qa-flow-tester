# T-412: The Improved version tab (ADR 0049)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard, docs | feature | todo |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/AuditTabs.tsx`
- `packages/wizard/src/lib/router.ts`, `packages/wizard/src/App.tsx`
- `packages/wizard/src/screens/audit/improved/ImprovedVersionScreen.tsx` (new)
- `packages/wizard/src/screens/audit/saved/PreviewShareScreen.tsx`
- `packages/wizard/src/screens/audit/documents/ReviewDocumentsScreen.tsx`, `packages/wizard/src/screens/audit/documents/ExportDocumentsScreen.tsx` (the `hide` lists only)
- `packages/wizard/src/screens/audit/BetaAuditNotice.tsx` (route list)
- `CONTEXT.md`, `docs/adr/0049-improved-version.md` (set the status to Accepted), `docs/adr/README.md`
- `packages/wizard/tests/audit-tabs.test.tsx`

**Do not build in parallel with:** T-396 (wizard).

## Problem

- The improved homepage exists (`audit/preview/generate.ts`, REQ-024), but it sits under the **Share** tab (`AuditTabs.tsx:37`).
- The Documents and Download screens hide that tab (`ReviewDocumentsScreen.tsx:753`, `ExportDocumentsScreen.tsx:432`: `hide={['share', 'helpers']}`).
- The owner reported the feature as "completely missing".

## Change

- **New tab:** **Improved version**, route `/audits/:id/improved`, on every audit screen, in the order Results · Documents · **Improved version** · Download · Share.
- **Move the preview:** the "make the improved homepage" panel moves from `PreviewShareScreen` to the new screen. Share keeps only Shared Links.
- **Disabled button:** without a working AI key, the button carries a reason line (W20).
- **Glossary:** add **Improved version** to CONTEXT.md, with its "_Avoid_" list (redesign, makeover, mockup).

## Tests

- The tab appears on every audit screen.
- Share no longer shows the preview.
- The disabled button has a reason line.

## Done when

The tests pass, and on a finished audit the Improved version is one click from Results.
