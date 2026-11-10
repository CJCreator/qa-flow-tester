# T-150: Stored document entries are saved without checking kind, formats or reason

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core/audit | security | built |

**Files you may edit (no others):**
- `packages/core/src/audit/store/audit-store.ts`
- `packages/core/src/audit/documents/write-all.ts`
- `packages/core/tests/audit-store.test.ts`
- `packages/core/tests/audit-doc-write-all.test.ts`

**Do not build in parallel with:** T-153, T-156, T-157 (edit `audit-store.ts` or `write-all.ts`).

## Problem

A version record keeps a `documents` list (which Audit Documents were written). Every other field of the record is checked and uses fixed wording capped at 300 characters (`MAX_VERSION_ERROR_CHARS`). The `documents` entries are not:

- `kind` is copied without `isStoredDocumentKind`.
- `formats` is copied without checking the values.
- `reason` is the raw `err.message` from rendering or saving, with no cap. It is returned by the audit API, so internal error text (file paths, storage errors) can reach a Helper or a Shared Link viewer.

## Current code

`packages/core/src/audit/store/audit-store.ts:213` (branch `worktree-audit-cleanup`)

```ts
  if (update.documents !== undefined) {
    if (!Array.isArray(update.documents)) throw invalidInput('The documents list is not valid.');
    out.documents = update.documents.map((d) => {
      if (!d || typeof d !== 'object') throw invalidInput('The stored document is not valid.');
      const doc = d as Partial<StoredAuditDocument>;
      if (!doc.kind || !doc.title || !doc.status) throw invalidInput('The stored document is not valid.');
      if (doc.status === 'ready') {
        return {
          kind: doc.kind,
          status: 'ready' as const,
          title: String(doc.title),
          formats: Array.isArray(doc.formats) ? [...doc.formats] : ['markdown', 'html'],
          updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : new Date().toISOString(),
        };
      }
      if (doc.status === 'not-written') {
        return {
          kind: doc.kind,
          status: 'not-written' as const,
          title: String(doc.title),
          reason: typeof doc.reason === 'string' ? doc.reason : 'Document could not be written.',
        };
      }
      throw invalidInput('The stored document status is not valid.');
    });
  }
```

`packages/core/src/audit/documents/write-all.ts:233`

```ts
    } catch (err) {
      return {
        kind: spec.kind,
        status: 'not-written',
        title: spec.title,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
```

`packages/core/src/audit/documents/write-all.ts:276`

```ts
    const err = mdOutcome.status === 'rejected' ? mdOutcome.reason : (htmlOutcome as PromiseRejectedResult).reason;
    const reason = err instanceof Error ? err.message : String(err) || 'Document could not be written.';

    return {
      kind: spec.kind,
      status: 'not-written',
      title,
      reason,
    };
```

`isStoredDocumentKind(value: unknown): value is StoredDocumentKind` is exported from `packages/core/src/audit/store/keys.ts`. `MAX_VERSION_ERROR_CHARS = 300` is defined in `audit-store.ts`.

## Change

1. `audit-store.ts`: make sure `isStoredDocumentKind` is in the import from `'./keys.js'` (add it if missing).

2. `audit-store.ts`: in the block above, replace the line `if (!doc.kind || !doc.title || !doc.status) throw ...` with:

```ts
      if (!isStoredDocumentKind(doc.kind) || !doc.title || !doc.status) {
        throw invalidInput('The stored document is not valid.');
      }
      const title = String(doc.title).slice(0, MAX_VERSION_ERROR_CHARS);
```

Use `title` (instead of `String(doc.title)`) in both returned objects.

3. `audit-store.ts`: the `formats` line becomes:

```ts
          formats: Array.isArray(doc.formats)
            ? doc.formats.filter((f): f is 'markdown' | 'html' => f === 'markdown' || f === 'html')
            : ['markdown', 'html'],
```

4. `audit-store.ts`: the `reason` line becomes:

```ts
          reason:
            typeof doc.reason === 'string' && doc.reason.trim() !== ''
              ? doc.reason.slice(0, MAX_VERSION_ERROR_CHARS)
              : 'Document could not be written.',
```

5. `write-all.ts`: add near the top of the file (after the imports):

```ts
/** Fixed wording for the version record: never the error's own text (it can hold paths or storage details). */
const NOT_BUILT = 'The document could not be built.';
const NOT_SAVED = 'The document could not be saved.';
```

6. `write-all.ts`, first snippet: `reason: NOT_BUILT,` and change `catch (err) {` to `catch {`.

7. `write-all.ts`, second snippet: delete the two lines `const err = ...` and `const reason = ...`, and return `reason: NOT_SAVED,`.

## Tests

`packages/core/tests/audit-store.test.ts`: copy the setup of `'records status, finishedAt and counts; only sent fields change'` (about line 141). Add:

- `'refuses a stored document of an unknown kind'`: `updateVersion(id, 1, { documents: [{ kind: 'nonsense', status: 'ready', title: 'x' }] })` rejects.
- `'keeps only markdown and html formats and caps the reason'`: update with `[{ kind: 'findings', status: 'ready', title: 'Findings', formats: ['markdown', 'exe'] }, { kind: 'content', status: 'not-written', title: 'Content', reason: 'x'.repeat(1000) }]`; read the version back; expect the first entry's `formats` to equal `['markdown']` and the second entry's `reason` to have length 300.

(Use the document kinds that `STORED_DOCUMENT_KINDS` in `keys.ts` lists; `'findings'` and `'content'` are two of them.)

`packages/core/tests/audit-doc-write-all.test.ts`: find the test where saving or rendering a document fails. Change its expected `reason` to `'The document could not be saved.'` (save failure) or `'The document could not be built.'` (generate failure). Add an assertion that the reason does not contain the thrown error's message.

Run: `pnpm exec vitest run packages/core/tests/audit-store.test.ts packages/core/tests/audit-doc-write-all.test.ts`, then `pnpm build`.

## Done when

- [ ] An unknown `kind` is refused; unknown formats are dropped; `reason` and `title` are capped at 300 characters.
- [ ] `write-all.ts` never puts an error's message in a stored document entry.
- [ ] Tests and `pnpm build` pass.

## Notes

- Search `packages/wizard` and `packages/runner/tests` for the old raw-reason expectation only if a test fails; do not edit source there.
