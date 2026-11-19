# T-415: Before/after, HTML download, exports, Pitch thumbnail

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core, runner, wizard | feature | todo |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/improved/ImprovedVersionScreen.tsx`, `packages/wizard/src/screens/audit/improved/BeforeAfter.tsx` (new)
- `packages/core/src/audit/documents/bundle.ts`, `pitch.ts`, `render-html.ts`, `render-markdown.ts`, `render-pdf.ts`, `render-docx.ts`
- `packages/runner/src/routes/audit-export.ts`
- `packages/types/src/website-audit.ts`
- tests

**Depends on:** T-414 and T-410 (`render-pdf.ts`).

## Change

- **Before/after:**
  - The stored 1440 px screenshot and the phone screenshot sit beside the variant, rendered in a frame at 1440 and 375 px.
  - Each change marker links to its finding.
  - The view is labelled "Suggestion, not the live site".
- **HTML download:** one variant, or all of them as a zip of self-contained HTML files with a README that names the source findings.
- **Exports:**
  - The md, html, pdf and docx exports gain an "Improved version" section: before/after images and the list of changes with finding ids.
  - The bundle includes the HTML files.
- **Pitch Glimpse:** the user stars one variant as the best. The default is the first variant to pass the gate. The Pitch Glimpse shows its before/after thumbnail, with the A4 single-page limit kept.
- **Shared Links:** a link can include the Improved version (the existing snapshot rules apply).

## Tests

- The before/after view renders with markers.
- The zip contains every passing variant.
- Every export format contains the section.
- The Pitch Glimpse still fits on one A4 page.

## Done when

The tests pass, and the four output forms come from one audit of mghealthtech.com.
