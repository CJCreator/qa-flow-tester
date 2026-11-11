# T-321: Cloud Storage: the audit record is deleted last, and requests time out and retry

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/store/backend.ts`
- `packages/core/src/audit/store/gcs-backend.ts`
- `packages/core/src/audit/store/local-backend.ts`
- `packages/core/src/audit/store/audit-store.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/tests/audit-store-gcs.test.ts`
- `packages/core/tests/audit-store-backend.test.ts`
- `packages/core/tests/audit-store.test.ts`
- `packages/core/tests/audit-pipeline.test.ts`

**Do not build in parallel with:** T-325 (edits `audit-store.ts`); T-325, T-328 (all edit `audit-store.test.ts`); T-295, T-322, T-326, T-328 (all edit `pipeline.ts`, `audit-pipeline.test.ts`).

## Problem

On the hosted copy the Website Audit store is a Cloud Storage bucket (`AUDIT_STORE_BUCKET`, ADR 0036). Deleting a Website Audit calls `deletePrefix('audits/<id>')`. The Cloud Storage backend lists the keys, sorts them (`packages/core/src/audit/store/gcs-backend.ts:247`, `return keys.sort();`) and deletes them 8 at a time in that order (`gcs-backend.ts:279-295`). `audits/<id>/audit.json` sorts before `helpers/`, `shares/`, `shortlist.json` and `v1/`, so the audit record goes first. If any later delete fails (a 503, a dropped connection), the record is gone but Page Content, screenshots, the Shortlist entry and Helper grants stay. The delete route then answers 404 on a retry, because it looks the audit up first (`packages/runner/src/routes/audit-store.ts:150-151`). Nothing can delete what is left. That breaks the ADR 0036 promise "Deleting a Website Audit removes all its data".

No Cloud Storage request has a timeout or a retry. `request()` (`gcs-backend.ts:149-158`) calls `fetch` once with no `signal`, and the metadata token fetch (`gcs-backend.ts:84`) does the same, so one stuck connection holds the audit lock for as long as the socket lives. One 503 is final: `pipeline.ts:903-908` marks the whole version failed when `saveResult` fails once, so up to 60 minutes of crawl and AI work is lost to one blip. `writeVersionEntries` (`audit-store.ts:480-482`) records any error as "not saved", so a passing blip also drops Page Content and phone screenshots.

The local file backend removes the folder in one `fs.rm`, but it must follow the same "record last" rule so the two backends keep one contract.

## Current code

Branch from `main`.

`packages/core/src/audit/store/gcs-backend.ts` (`grep -n "private async request\|async deletePrefix\|return keys.sort" packages/core/src/audit/store/gcs-backend.ts`):

```ts
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.tokenProvider();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    try {
      return await this.fetchFn(url, { ...init, headers });
    } catch {
      throw networkError();
    }
  }
```

```ts
  async deletePrefix(prefix: string): Promise<void> {
    normalizePrefix(prefix);
    const keys = await this.list(prefix);
    // A few at once: an audit has hundreds of objects and the audit lock is held while they go.
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const key = keys[next++];
        if (key === undefined) return;
        const res = await this.request(this.objectUrl(key), { method: 'DELETE' });
        await discardBody(res);
        // 404: already gone (deleted concurrently); the goal state holds.
        if (!res.ok && res.status !== 404) throw statusError(res.status);
      }
    };
    await Promise.all(Array.from({ length: Math.min(DELETE_IN_FLIGHT, keys.length) }, () => worker()));
  }
```

and in `createMetadataTokenProvider`:

```ts
      res = await options.fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
```

`packages/core/src/audit/store/backend.ts:29-30`:

```ts
  /** Removes every key under a folder prefix. The prefix must not be empty. */
  deletePrefix(prefix: string): Promise<void>;
```

`packages/core/src/audit/store/audit-store.ts` (`grep -n "async deleteAudit" -A10 packages/core/src/audit/store/audit-store.ts`):

```ts
      await tombstoneShares(this, auditId);
      await removeHelperIndexEntries(this, auditId);
      await this.backend.deletePrefix(auditFolder(auditId));
```

`packages/core/src/audit/store/local-backend.ts:122-125`:

```ts
  async deletePrefix(prefix: string): Promise<void> {
    const folder = normalizePrefix(prefix);
    await fs.rm(this.resolve(folder.slice(0, -1)), { recursive: true, force: true });
  }
```

`packages/core/src/audit/pipeline/pipeline.ts` (`grep -n "await store.saveResult" -A5 packages/core/src/audit/pipeline/pipeline.ts`):

```ts
  try {
    await store.saveResult(auditId, version, result);
  } catch {
    record('saving', 'saving', false, NOTES.saving);
    throw new AuditPipelineError('save-failed');
  }
```

A few lines below, `updateVersion` already gets one retry ("One retry: the result is already stored, so a passing blip should not cost the caller its status.").

## Change

1. `backend.ts`: add the option type and widen the contract:

```ts
export interface DeletePrefixOptions {
  /**
   * A key directly inside the folder that is deleted only after every other key under it is gone. When any
   * other delete fails it stays, so the caller can run the same delete again (the audit record, ADR 0036).
   */
  last?: string;
}
```

   Change the interface line to `deletePrefix(prefix: string, options?: DeletePrefixOptions): Promise<void>;` and its doc comment to mention `last`. Add next to `normalizePrefix`:

```ts
/** Throws invalid-key unless `key` is a valid key directly inside `folder` (as `normalizePrefix` returns it). */
export function assertKeyInFolder(folder: string, key: string): void {
  assertValidKey(key);
  if (!key.startsWith(folder) || key.slice(folder.length).includes('/')) throw invalidKey();
}
```

2. `gcs-backend.ts`, timeouts and retries:
   - Add constants: `GCS_REQUEST_TIMEOUT_MS = 30_000`, `METADATA_TIMEOUT_MS = 5_000`, `GCS_RETRY_DELAYS_MS: readonly number[] = [250, 1000]` (so at most 3 attempts).
   - Add `function isRetryableStatus(status: number): boolean { return status === 408 || status === 429 || status >= 500; }` and a small helper `sleep(ms)` (`setTimeout` promise; resolve at once for 0).
   - `GcsAuditStoreOptions` gains `timeoutMs?: number` and `retryDelaysMs?: readonly number[]` (tests pass `[0, 0]`). Store both on the instance.
   - Rewrite `request()`: for each attempt `i` from 0 to `retryDelaysMs.length`, get the token, call `this.fetchFn(url, { ...init, headers, signal: AbortSignal.timeout(this.timeoutMs) })`. A thrown error (network failure or the timeout) or a response with `isRetryableStatus(res.status)` waits `retryDelaysMs[i]` (after `await discardBody(res)` for a response) and tries again; on the last attempt return the response, or throw `networkError()` for a thrown error. Every other response is returned at once (404 stays a single request). Upload bodies are strings or `Uint8Array`, so they can be sent again as they are.
   - `createMetadataTokenProvider` options gain `timeoutMs?: number` and `retryDelaysMs?: readonly number[]`. In `refresh`, send `signal: AbortSignal.timeout(options.timeoutMs ?? METADATA_TIMEOUT_MS)` and retry a thrown error or a retryable status with the same delays (`GCS_RETRY_DELAYS_MS` by default). A 4xx other than 408/429 is not retried. The error wording stays as it is.

3. `gcs-backend.ts`, `deletePrefix(prefix, options: DeletePrefixOptions = {})`:
   - `const folder = normalizePrefix(prefix);` then, when `options.last !== undefined`, `assertKeyInFolder(folder, options.last)`.
   - Delete every listed key except `options.last` with the existing 8 workers (move the single delete into a private `deleteObject(key)` that keeps the "404 is gone" rule).
   - After `Promise.all` resolves, `if (options.last !== undefined) await this.deleteObject(options.last);` with a comment: "Only once everything else is gone: a failure above leaves the record, so the delete can be run again."

4. `local-backend.ts`, `deletePrefix(prefix, options: DeletePrefixOptions = {})`: when `options.last` is set, `assertKeyInFolder(folder, options.last)`, read the folder's entries with `fs.readdir` (return quietly when it is missing, `isMissing`), `fs.rm` each entry except the last key's file name (`{ recursive: true, force: true }`), then remove the folder as today. Without `last` the code stays as it is.

5. `audit-store.ts`, `deleteAudit`: `await this.backend.deletePrefix(auditFolder(auditId), { last: auditRecordKey(auditId) });` with the comment "The record last: while it exists the audit is listed and the delete can be run again (ADR 0036)."

6. `pipeline.ts`: give `saveResult` the same one retry `updateVersion` has:

```ts
  try {
    await store.saveResult(auditId, version, result);
  } catch {
    // One retry: a passing blip should not throw away the whole crawl.
    try {
      await store.saveResult(auditId, version, result);
    } catch {
      record('saving', 'saving', false, NOTES.saving);
      throw new AuditPipelineError('save-failed');
    }
  }
```

7. Run `pnpm exec prettier --write` on the changed files, then `pnpm build` (the `AuditStoreBackend` contract is exported).

## Tests

`packages/core/tests/audit-store-gcs.test.ts`:

- Change `backendWith` to pass `retryDelaysMs: [0, 0]`, and pass `retryDelaysMs: [0, 0]` to every `createMetadataTokenProvider(...)` call, so the existing error cases stay fast. The existing `it.each` over 429/500/503 keeps passing (the same code after the last attempt).
- `'retries a 503 and a dropped connection, then succeeds'`: a fetch that answers 503, then throws, then 200 `{"x":1}`; `getJson` returns `{ x: 1 }` and exactly 3 requests were sent.
- `'does not retry 401, 403 or 404'`: for each status one request only (count requests).
- `'gives up after three attempts with the fixed wording'`: always 500 gives `code: 'unavailable'` after 3 requests.
- `'times out a request that never answers'`: a fetch that returns a promise rejecting when `init.signal` aborts; backend built with `timeoutMs: 20, retryDelaysMs: [0, 0]`; `getJson` rejects with `code: 'unavailable'` and 3 requests were sent.
- `'deletePrefix with last deletes the record after every other object'`: keys `audits/a1/audit.json`, `audits/a1/shortlist.json`, `audits/a1/v1/version.json`, `audits/a1/v1/result.json`; the last DELETE request URL ends in `audit.json`.
- `'a failed delete leaves the record, and a second delete finishes'`: DELETE of `v1/result.json` answers 403 on the first run (not retried); `deletePrefix(..., { last })` rejects and no DELETE for `audit.json` was sent. Run again with the fake answering 204: it resolves and `audit.json` was deleted last.
- `'refuses a last key outside the folder'`: `{ last: 'audits/a2/audit.json' }` and `{ last: 'audits/a1/v1/version.json' }` reject with `code: 'invalid-key'` before any request.
- Metadata provider: `'retries a 503 from the metadata server'` (503 then a token: resolves, 2 requests) and `'does not retry a 404 from the metadata server'` (1 request, rejects).

`packages/core/tests/audit-store-backend.test.ts`: `'deletePrefix with last removes everything, the last key included'` for the local backend (write `audits/a1/audit.json`, `audits/a1/v1/x.json`; after the call `list('audits/a1')` is `[]`), and the same `invalid-key` refusal for a nested `last`.

`packages/core/tests/audit-store.test.ts`:

- Update `spy` to pass the options through: `deletePrefix: (p, o) => (calls.push(\`deletePrefix ${p}\`), inner.deletePrefix(p, o)),`.
- In `describe('deleteAudit (Q-30)')` add `'names the audit record as the last key'`: wrap the local backend so `deletePrefix` records its options; after `deleteAudit(id)` the recorded `last` is `` `audits/${id}/audit.json` ``.

`packages/core/tests/audit-pipeline.test.ts`:

- The two tests that use `mem.store.saveResult.mockRejectedValueOnce(...)` (`'throws AuditPipelineError when the result cannot be saved...'` and `'only a save failure throws with errorCode ERR_PIPELINE'`) change to `mockRejectedValue(...)`, and the first also asserts `expect(mem.store.saveResult).toHaveBeenCalledTimes(2)`.
- New `'retries saveResult once: a passing blip still saves the result'`: `mockRejectedValueOnce(new Error('blip'))`; the outcome resolves, `mem.results` has length 1, `saveResult` was called twice.

Run: `pnpm exec vitest run packages/core/tests/audit-store-gcs.test.ts packages/core/tests/audit-store-backend.test.ts packages/core/tests/audit-store.test.ts packages/core/tests/audit-pipeline.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "last: auditRecordKey" packages/core/src/audit/store/audit-store.ts` finds the delete call.
- [ ] `grep -n "AbortSignal.timeout" packages/core/src/audit/store/gcs-backend.ts` finds the request and the metadata fetch.
- [ ] `grep -n "GCS_RETRY_DELAYS_MS" packages/core/src/audit/store/gcs-backend.ts` finds the retry delays.
- [ ] A failed object delete leaves `audit.json` (gcs test), and the pipeline retries `saveResult` once (pipeline test).
- [ ] The four test files and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit findings H15 and H16 (audit of 11 Nov 2026 on `d225418`).
- A "deleting" marker that list and get show was the other option. Record-last needs no new state and no wizard change: the audit stays listed until it is fully gone, and the same Delete button finishes the job.
- The retry is inside the backend, so `writeVersionEntries` (Page Content, screenshots) and every route get it without their own retry. Its "any error means not saved" rule stays.
- Retries run under the audit lock. Worst case per request is 3 attempts of 30 s plus 1.25 s of waits, against the unbounded wait today.
- T-295 also edits `pipeline.ts` (a note's wording, a different function). T-262 changes the runner's `refuseStoreFailure`; this ticket does not touch runner files.
- Not in scope: making `deleteAudit` resume the Shared Link tombstones and Helper index removal on a second run. Both are already safe to repeat (they work from what is still listed).
