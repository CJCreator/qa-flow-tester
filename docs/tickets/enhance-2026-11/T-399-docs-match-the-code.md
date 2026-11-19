# T-399: Docs match the code

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | drift | todo |

**Files you may edit (no others):** `docs/PRODUCT_GUIDE.md`, `docs/CONFIGURATION.md`, `SECURITY.md`, `CONTEXT.md`.

**Do not build in parallel with:** T-396 (the guide's "Disabled actions" section).

## Change

Each item comes from the review (`docs/reviews/2026-11-19-product-review.md`, sections 3 and 4).

- **Guide line 27:** "retried once" and "Workers" describe ADR 0048. Until T-408 and T-409 are built, say "up to 3 retries, one Test at a time".
- **Guide, Website Audit section:**
  - Name the improved-homepage preview, the Section rewrite and the per-page recommendation.
  - Say that `search-ranking` and `marketing` both grade as Findable (`grades.ts:30-31`).
  - Say that exports in other languages translate only labels, until T-420.
- **Guide line 116:** Save key already has a reason line (`KeyField.tsx:154-160`).
- **`CONFIGURATION.md:87`:** remove `TEST_MOCK_AI`, which nothing reads.
- **`SECURITY.md`:**
  - Chromium on a local run is unguarded by design (ADR 0045:22).
  - With the `local` key source, the AES key sits beside the encrypted keys (`key-resolver.ts`). That stops a casual read, not a leaked folder.

## Done when

Every item above is fixed, and `pnpm format:check` passes.
