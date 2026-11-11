# T-262: One `refuse` and one `refuseStoreFailure` for the Website Audit routes

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | runner | duplication | todo |

**Files you may edit (no others):**

- `packages/runner/src/routes/audit-common.ts`
- `packages/runner/src/routes/audit-store.ts`
- `packages/runner/src/routes/audit-documents.ts`
- `packages/runner/src/routes/audit-export.ts`
- `packages/runner/src/routes/audit-share.ts`
- `packages/runner/tests/audit-common.test.ts`

**Do not build in parallel with:** T-257 (edits `audit-share.ts`), T-263 (edits `audit-common.ts`, `audit-store.ts`, `audit-documents.ts`, `audit-export.ts`, `audit-share.ts`), T-264 (edits `audit-export.ts`).

## Problem

T-111 moved `versionQuery` into `routes/audit-common.ts` and left `refuseStoreFailure` because its copies use different wording. The wording is not a reason to keep four copies of the logic. Four route modules each have a `refuseStoreFailure` that does the same steps: a "not found" record error becomes 404, any other record error or a bad key becomes 400, everything else becomes 500 with a fixed sentence. Only the sentences differ in three places. Passing the sentences in keeps every reply word for word the same.

Same story for the three-line `refuse` helper: `audit-store.ts` (exported), `audit-documents.ts`, `audit-export.ts`, `audit-share.ts` each define it the same way.

Sentences per copy (all other text is identical across the four):

| File | 404 sentence | 500 sentence |
|---|---|---|
| `audit-store.ts` | `AUDIT_NOT_FOUND` | `'The saved audits could not be read or changed. Try again.'` |
| `audit-documents.ts` | `NOT_FOUND` (same words as `AUDIT_NOT_FOUND`) | `'The edits could not be read or saved. Try again.'` |
| `audit-export.ts` | `NOT_FOUND` (same words) | `FAILED` = `'The file could not be made. Try again.'` |
| `audit-share.ts` | the `notFoundMessage` argument, default `AUDIT_NOT_FOUND`; `LINK_NOT_FOUND` for a link | `STORE_FAILED` = `'The Shared Links could not be read or saved. Try again.'` |

The 400 sentence is `'The request is not valid.'` in all four.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "function refuseStoreFailure\|function refuse(" packages/runner/src/routes/audit-store.ts packages/runner/src/routes/audit-documents.ts packages/runner/src/routes/audit-export.ts packages/runner/src/routes/audit-share.ts`.

`routes/audit-store.ts`:

```ts
export function refuse(res: http.ServerResponse, status: number, code: AuditErrorCode, error: string): void {
  const body: AuditErrorReply = { error, code };
  sendJson(res, status, body);
}

export const AUDIT_NOT_FOUND = 'This Website Audit was not found. It may have been deleted.';
const INVALID_REQUEST = 'The request is not valid.';
const STORE_FAILURE = 'The saved audits could not be read or changed. Try again.';

/** Store failures become fixed sentences: no keys, paths or provider text reach the caller. */
export function refuseStoreFailure(res: http.ServerResponse, err: unknown): void {
  if (err instanceof AuditRecordError) {
    if (err.code === 'not-found') return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_REQUEST);
  }
  if (err instanceof AuditStoreError && err.code === 'invalid-key') {
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_REQUEST);
  }
  sendJson(res, 500, { error: STORE_FAILURE });
}
```

`audit-documents.ts` has the same function with `NOT_FOUND`, an inline `'The request is not valid.'` and `'The edits could not be read or saved. Try again.'`. `audit-export.ts` has it using `invalid(res, 'The request is not valid.')` (its `invalid` is `refuse(res, 400, 'ERR_INVALID_REQUEST', error)`) and `FAILED`. `audit-share.ts`:

```ts
function refuseStoreFailure(res: http.ServerResponse, err: unknown, notFoundMessage = AUDIT_NOT_FOUND): void {
  if (err instanceof AuditRecordError) {
    if (err.code === 'not-found') return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', notFoundMessage);
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID);
  }
  if (err instanceof AuditStoreError && err.code === 'invalid-key') {
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID);
  }
  sendJson(res, 500, { error: STORE_FAILED });
}
```

`audit-content.ts`, `audit-preview.ts` and `audit-shortlist.ts` import `refuseStoreFailure` (and `refuse`) from `./audit-store.js`. They keep doing so.

## Change

1. `routes/audit-common.ts`: add (with imports at the top: `import type http from 'http';`, `import { AuditRecordError, AuditStoreError } from '@qa/core';`, `import type { AuditErrorCode, AuditErrorReply } from '@qa/types';`, `import { sendJson } from './body.js';`):

```ts
/** A refusal with its fixed code and message. */
export function refuse(res: http.ServerResponse, status: number, code: AuditErrorCode, error: string): void {
  const body: AuditErrorReply = { error, code };
  sendJson(res, status, body);
}

const INVALID_REQUEST = 'The request is not valid.';

/** The two sentences that change from route to route. */
export interface StoreFailureText {
  /** The 404 sentence for a record that is not there. */
  notFound: string;
  /** The 500 sentence for any other failure. */
  failed: string;
}

/** Store failures become fixed sentences: no keys, paths or backend text reach the caller. */
export function refuseStoreFailure(res: http.ServerResponse, err: unknown, text: StoreFailureText): void {
  if (err instanceof AuditRecordError) {
    if (err.code === 'not-found') return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', text.notFound);
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_REQUEST);
  }
  if (err instanceof AuditStoreError && err.code === 'invalid-key') {
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_REQUEST);
  }
  sendJson(res, 500, { error: text.failed });
}
```

2. `audit-store.ts`: delete its `refuse` and `INVALID_REQUEST` only if no other line uses `INVALID_REQUEST` (`grep -n "INVALID_REQUEST" packages/runner/src/routes/audit-store.ts`; keep the constant if another line uses it). Add `import { refuse, refuseStoreFailure as refuseWith } from './audit-common.js';` and `export { refuse };` (other modules import `refuse` from here). Replace its `refuseStoreFailure` with:

```ts
/** Store failures become fixed sentences: no keys, paths or provider text reach the caller. */
export function refuseStoreFailure(res: http.ServerResponse, err: unknown): void {
  refuseWith(res, err, { notFound: AUDIT_NOT_FOUND, failed: STORE_FAILURE });
}
```

3. `audit-documents.ts`: delete the local `refuse` and `refuseStoreFailure`; add `import { refuse, refuseStoreFailure as refuseWith, versionQuery } from './audit-common.js';` (it already imports `versionQuery` from there: extend that line) and add after the `NOT_FOUND` constant:

```ts
function refuseStoreFailure(res: http.ServerResponse, err: unknown): void {
  refuseWith(res, err, { notFound: NOT_FOUND, failed: 'The edits could not be read or saved. Try again.' });
}
```

Callers (`refuseStoreFailure(c.res, err)`) stay as they are.

4. `audit-export.ts`: same with `{ notFound: NOT_FOUND, failed: FAILED }`. Delete its `refuse` and old `refuseStoreFailure`; keep its `invalid` helper (used elsewhere in the file) and import `refuse` from `./audit-common.js` for it.

5. `audit-share.ts`: delete the local `refuse` and old `refuseStoreFailure`; add:

```ts
function refuseStoreFailure(res: http.ServerResponse, err: unknown, notFoundMessage = AUDIT_NOT_FOUND): void {
  refuseWith(res, err, { notFound: notFoundMessage, failed: STORE_FAILED });
}
```

with the same import. Keep the `LINK_NOT_FOUND` call as it is.

6. Run `pnpm exec eslint packages/runner/src/routes 2>&1 | grep "never used"` and remove unused imports and constants in the five files (`AuditRecordError`, `AuditStoreError`, `AuditErrorReply`, `INVALID`, and so on). Run `pnpm exec prettier --write` on the six files and `pnpm build`.

## Tests

Edit `packages/runner/tests/audit-common.test.ts`. Add imports `import { AuditRecordError, AuditStoreError } from '@qa/core';` and `refuseStoreFailure` to the import from `../src/routes/audit-common.js`. Add a small fake response:

```ts
function fakeRes() {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (status: number) => {
      out.status = status;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  };
  return { res: res as unknown as import('http').ServerResponse, out };
}
const text = { notFound: 'NF sentence', failed: 'FAILED sentence' };
```

Tests (describe `'refuseStoreFailure'`):

- `'a record that is not there is a 404 with the route sentence'`: `new AuditRecordError('not-found', 'x')` gives status 404 and `JSON.parse(out.body)` toEqual `{ error: 'NF sentence', code: 'ERR_AUDIT_NOT_FOUND' }`.
- `'another record error is a 400'`: `new AuditRecordError('invalid-input', 'x')` gives 400 and `{ error: 'The request is not valid.', code: 'ERR_INVALID_REQUEST' }`.
- `'a bad store key is a 400'`: `new AuditStoreError('invalid-key', 'x')` gives 400, same body.
- `'anything else is a 500 with the route sentence and no internals'`: `new Error('secret path C:\\data')` gives 500 and `{ error: 'FAILED sentence' }`; `out.body` not toContain `'secret'`.

Run: `pnpm exec vitest run packages/runner/tests/audit-common.test.ts packages/runner/tests/audit-store-routes.test.ts packages/runner/tests/audit-edits-routes.test.ts packages/runner/tests/audit-export-routes.test.ts packages/runner/tests/audit-share-routes.test.ts packages/runner/tests/audit-content-routes.test.ts packages/runner/tests/audit-shortlist-routes.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "function refuse(\|function refuseStoreFailure" packages/runner/src/routes/*.ts` lists only: `audit-common.ts` (both), `audit-store.ts` (the one-line wrapper `refuseStoreFailure`), `audit-documents.ts`, `audit-export.ts` and `audit-share.ts` (each only the thin `refuseStoreFailure` wrapper), plus the unrelated `refuse` in `audit-ai.ts`, `audit-crawl.ts`, `audit-helpers.ts` and `audit-rerun.ts`.
- [ ] The listed tests pass (existing tests that assert the old reply texts pass unchanged) and `pnpm build` passes.

## Notes

- Do not change any reply sentence. If a test fails on a sentence, you changed one by mistake.
- Not in this ticket: the `refuse` in `audit-ai.ts`, `audit-crawl.ts`, `audit-helpers.ts`, `audit-rerun.ts`. They have different signatures (extra fields, or a `running` block).
- `routes/index.ts` re-exports `audit-store.ts` with `export *`; keep `refuse`, `refuseStoreFailure` and `AUDIT_NOT_FOUND` exported from there.
