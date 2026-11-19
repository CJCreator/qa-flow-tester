# T-410: One shared Chromium for PDF exports

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core, runner | speed | todo |

**Files you may edit (no others):** `packages/core/src/audit/documents/render-pdf.ts`, `packages/core/src/audit/documents/bundle.ts`, `packages/runner/src/routes/audit-export.ts`, `packages/core/tests/audit-doc-pdf.test.ts`.

## Problem

Every PDF export launches its own Chromium (`render-pdf.ts:34`, closed at `:76`), and `bundle.ts:37` notes "Each call starts its own browser". There are at most 2 PDF exports at once (`audit-export.ts:56`).

## Change

- One lazily launched browser for PDF rendering, with a new context per PDF.
- The browser closes after 5 idle minutes.
- The limit of 2 concurrent PDFs stays.

## Tests

A bundle of 6 PDFs launches the browser once.

## Done when

The test passes, and the bundle export time drops on the 300-page benchmark audit.
