# T-420: Full AI translation of exports

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core, runner | feature | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/documents/translate.ts` (new)
- `packages/core/src/audit/documents/write-all.ts`, `packages/core/src/audit/documents/bundle.ts`
- `packages/runner/src/routes/audit-export.ts`
- `packages/wizard/src/screens/audit/documents/ExportDocumentsScreen.tsx`
- `docs/PRODUCT_GUIDE.md` (the Languages bullet)
- tests

**Depends on:** T-419 and T-415 (export files).

## Problem (verify first)

- Exports in another language change only the fixed labels (`documents/labels/*.ts`, `labelsFor`).
- Findings, notes and Page Content stay in the language they were written in.
- The export route reuses a stored document only when the language matches (`audit-export.ts:216-222`).
- Read the rest of `audit-export.ts` to confirm there is no content translation.

## Change

- **Translation:** on export to another language, an AI pass with the user's key translates the finding text, notes, roadmap and proposal body. Batches of up to 40 strings, with ids kept.
- **Kept as is:** the site's own quoted Page Content stays in its original language, marked "original wording".
- **Cache:** results are cached per version, language and string hash, so a second export of the same version makes no new calls.
- **Labels:** the beta label stays for every language except English and Tamil.
- **Cost:** shown before the export starts.
- **No AI key:** the export says "Labels only: findings stay in <language>".

## Tests

- With the mock AI, a Hindi export has every finding translated and every id kept.
- A second Hindi export makes 0 calls.
- Without a key, the export shows the labels-only notice.

## Done when

The tests pass, and a Tamil export of techgramam.com reads fully in Tamil apart from the quoted site text.
