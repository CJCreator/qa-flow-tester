# T-137: Exports serve stored document copies that ignore later edits and settings

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core/audit | bug | built |

**Files you may edit (no others):**
- `packages/runner/src/routes/audit-export.ts`
- `packages/runner/tests/audit-export-routes.test.ts`

**Do not build in parallel with:** none.

## Problem

When a Website Audit ends, `write-all.ts` stores one Markdown and one HTML copy of every document. Nothing rewrites those copies later. Three export routes send the stored copy when one exists, so:

- A Section edit or an accepted rewrite made after the audit never reaches a single-document `md`/`html` export or the Owner Audit export.
- The stored Proposal was written with empty settings (no company details, default template).
- The stored Pitch Glimpse was written with no screenshots and no saved opt-out text, so every finding shows "No screenshot".

Scenario: the owner edits a Section, then downloads `?format=md&documents=content`. The file still has the old text. The zip bundle of the same version has the new text.

## Current code

`packages/runner/src/routes/audit-export.ts` (branch `worktree-audit-cleanup`), three places.

1. The documents export (about line 282):

```ts
      if (
        (format === 'md' || format === 'html') &&
        documents?.length === 1 &&
        (!common.language || common.language === loaded.result.language)
      ) {
        const kind = documents[0]!;
        const docFormat = format === 'md' ? 'markdown' : 'html';
        const stored = await store.readAuditDocument(
          loaded.auditId,
          loaded.version,
          kind as StoredDocumentKind,
          docFormat
        );
        if (stored !== null) {
```

2. The Pitch Glimpse export (about line 336):

```ts
      if (format === 'html' && (!common.language || common.language === loaded.result.language)) {
        const stored = await store.readAuditDocument(loaded.auditId, loaded.version, 'pitch-glimpse', 'html');
        if (stored !== null) {
          const name = `${exportBaseName(loaded.result.url, loaded.result.version)}-pitch-glimpse.html`;
          sendFile(c.res, {
            fileName: name,
            contentType: 'text/html; charset=utf-8',
            body: Buffer.from(stored, 'utf8'),
          });
          return;
        }
      }
```

3. The Owner Audit export (about line 379):

```ts
      if ((format === 'md' || format === 'html') && (!common.language || common.language === loaded.result.language)) {
```

`loaded` comes from `load()` in the same file and already carries `edits: EditOverlay`. An overlay that was never changed has `updatedAt: null`.

## Change

1. Documents export: add two conditions to the `if`, so the stored copy is used only when nothing was edited and the document does not depend on settings:

```ts
      if (
        (format === 'md' || format === 'html') &&
        documents?.length === 1 &&
        documents[0] !== 'proposal' &&
        loaded.edits.updatedAt === null &&
        (!common.language || common.language === loaded.result.language)
      ) {
```

2. Pitch Glimpse export: delete the whole `if (format === 'html' && ...) { ... }` block shown above. The code after it (`const { optOutText } = await loadSettings(settings);` then `exportPitchGlimpse(...)`) already builds the page with settings and screenshots.

3. Owner Audit export: add the edits condition:

```ts
      if (
        (format === 'md' || format === 'html') &&
        loaded.edits.updatedAt === null &&
        (!common.language || common.language === loaded.result.language)
      ) {
```

4. If `StoredDocumentKind` or another import becomes unused after step 2, remove it from the import list. Do not change anything else.

## Tests

Edit `packages/runner/tests/audit-export-routes.test.ts`. Copy the setup of the existing test `'carries saved edits in every format'` (about line 175).

Add:

- `'a single document export ignores the stored copy once the version has edits'`: save a stored `content` Markdown copy with the text `STALE COPY` (`store.saveAuditDocument(auditId, version, 'content', 'markdown', 'STALE COPY')`), save an edit as that existing test does, request `?format=md&documents=content`. Expect the body not to contain `STALE COPY` and to contain the edited text.
- `'the Proposal is never served from the stored copy'`: stored `proposal` Markdown copy `STALE COPY`, no edits, request `?format=md&documents=proposal`. Expect the body not to contain `STALE COPY`.
- `'the Pitch Glimpse html is always built on request'`: stored `pitch-glimpse` HTML copy `STALE COPY`, request the pitch export with `format=html`. Expect the body not to contain `STALE COPY`.

Run: `pnpm exec vitest run packages/runner/tests/audit-export-routes.test.ts`, then `pnpm build`.

## Done when

- [x] The three new tests pass and the existing tests in the file still pass.
- [x] The Pitch Glimpse route no longer calls `store.readAuditDocument`.
- [x] `pnpm build` passes.

## Notes

- Decision made: stored copies stay as a fast path only for an unedited version and only for documents that do not depend on settings. Rewriting stored copies on every edit is out of scope.
- Do not touch `packages/core/src/audit/documents/write-all.ts` here.
