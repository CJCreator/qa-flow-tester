# T-156: Listing and deleting audits is slow on Cloud Storage

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | core/audit | speed | built |

**Files you may edit (no others):**
- `packages/core/src/audit/store/backend.ts`
- `packages/core/src/audit/store/gcs-backend.ts`
- `packages/core/src/audit/store/local-backend.ts`
- `packages/core/src/audit/store/audit-store.ts`
- `packages/core/tests/audit-store-backend.test.ts`
- `packages/core/tests/audit-store-gcs.test.ts`

**Do not build in parallel with:** T-150, T-154, T-157 (edit `audit-store.ts` or `gcs-backend.ts`).

## Problem

1. `AuditStore.listAudits()` lists every object under `audits/` (each version's Page Content, documents and screenshots) only to pick out the `audit.json` of each audit. On the hosted copy that is tens of thousands of object names per call, paged 1000 at a time. `listShortlist` calls it too.
2. `GcsAuditStoreBackend.deletePrefix` deletes the objects of an audit one request after another, while the audit lock is held. Deleting one audit means hundreds of sequential requests.

## Current code

Branch `worktree-audit-cleanup`.

`packages/core/src/audit/store/audit-store.ts:370`

```ts
  async listAudits(): Promise<AuditSummary[]> {
    const keys = await this.backend.list(AUDITS_FOLDER);
    const ids = keys.map((key) => AUDIT_RECORD_KEY.exec(key)?.[1]).filter((id): id is string => !!id);
    const audits = (await Promise.all(ids.map((id) => this.getAudit(id)))).filter((a): a is AuditSummary => a !== null);
    return audits.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.auditId.localeCompare(b.auditId));
  }
```

`AUDITS_FOLDER` is `'audits'`. `getAudit(id)` returns `null` when the folder has no `audit.json`. `AUDIT_RECORD_KEY` is `/^audits\/([A-Za-z0-9_-]{8,64})\/audit\.json$/`.

`packages/core/src/audit/store/backend.ts:8` (the interface; `list` and `deletePrefix` shown)

```ts
  list(prefix: string): Promise<string[]>;
  /** Removes every key under a folder prefix. The prefix must not be empty. */
  deletePrefix(prefix: string): Promise<void>;
}
```

`packages/core/src/audit/store/gcs-backend.ts:220` (`list`, start)

```ts
  async list(prefix: string): Promise<string[]> {
    const folder = normalizePrefix(prefix, { allowEmpty: true });
    const keys: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ fields: 'items(name),nextPageToken' });
      if (folder) params.set('prefix', folder);
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.request(`${this.apiBase}/storage/v1/b/${encodeURIComponent(this.bucket)}/o?${params}`);
      if (!res.ok) {
        await discardBody(res);
        throw statusError(res.status);
      }
      let page: { items?: Array<{ name?: unknown }>; nextPageToken?: unknown };
      try {
        page = (await res.json()) as typeof page;
      } catch {
        throw new AuditStoreError('invalid-data', 'Cloud Storage returned an unreadable object list.');
      }
```

`packages/core/src/audit/store/gcs-backend.ts:247`

```ts
  async deletePrefix(prefix: string): Promise<void> {
    normalizePrefix(prefix);
    const keys = await this.list(prefix);
    for (const key of keys) {
      const res = await this.request(this.objectUrl(key), { method: 'DELETE' });
      await discardBody(res);
      // 404: already gone (deleted concurrently); the goal state holds.
      if (!res.ok && res.status !== 404) throw statusError(res.status);
    }
  }
```

`packages/core/src/audit/store/local-backend.ts`: `list(prefix)` resolves the folder with `const folder = normalizePrefix(prefix, { allowEmpty: true }); const start = folder === '' ? this.root : this.resolve(folder.slice(0, -1));` and walks it with `fs.readdir(dir, { withFileTypes: true })`. `isMissing(err)` tells a missing folder.

## Change

1. `backend.ts`: add an optional method to `AuditStoreBackend`, after `list`:

```ts
  /**
   * The names of the folders directly inside a folder prefix, sorted, without the prefix and without slashes
   * (`listFolders('audits')` gives the audit ids). Optional: a backend without it is listed with `list`.
   */
  listFolders?(prefix: string): Promise<string[]>;
```

2. `local-backend.ts`: add after `list`:

```ts
  async listFolders(prefix: string): Promise<string[]> {
    const folder = normalizePrefix(prefix, { allowEmpty: true });
    const start = folder === '' ? this.root : this.resolve(folder.slice(0, -1));
    try {
      const entries = await fs.readdir(start, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => String(e.name))
        .sort();
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }
```

3. `gcs-backend.ts`: add after `list` (Cloud Storage returns the sub-folders of a prefix as `prefixes` when `delimiter=/` is set):

```ts
  async listFolders(prefix: string): Promise<string[]> {
    const folder = normalizePrefix(prefix, { allowEmpty: true });
    const names: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ fields: 'prefixes,nextPageToken', delimiter: '/' });
      if (folder) params.set('prefix', folder);
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.request(`${this.apiBase}/storage/v1/b/${encodeURIComponent(this.bucket)}/o?${params}`);
      if (!res.ok) {
        await discardBody(res);
        throw statusError(res.status);
      }
      let page: { prefixes?: unknown[]; nextPageToken?: unknown };
      try {
        page = (await res.json()) as typeof page;
      } catch {
        throw new AuditStoreError('invalid-data', 'Cloud Storage returned an unreadable object list.');
      }
      for (const p of page.prefixes ?? []) {
        if (typeof p !== 'string') continue;
        const name = p.slice(folder.length).replace(/\/$/, '');
        if (name && !name.includes('/')) names.push(name);
      }
      pageToken = typeof page.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
    } while (pageToken);
    return names.sort();
  }
```

4. `gcs-backend.ts`: delete with a small pool. Replace the `for` loop in `deletePrefix` with:

```ts
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
```

Add near the top of `gcs-backend.ts`, with the other constants:

```ts
/** Object deletes sent at once by `deletePrefix`. */
const DELETE_IN_FLIGHT = 8;
```

5. `audit-store.ts`, `listAudits`: use the folder listing when the backend has it.

```ts
  async listAudits(): Promise<AuditSummary[]> {
    const AUDIT_ID = /^[A-Za-z0-9_-]{8,64}$/;
    const ids = this.backend.listFolders
      ? (await this.backend.listFolders(AUDITS_FOLDER)).filter((id) => AUDIT_ID.test(id))
      : (await this.backend.list(AUDITS_FOLDER))
          .map((key) => AUDIT_RECORD_KEY.exec(key)?.[1])
          .filter((id): id is string => !!id);
    const audits = (await Promise.all(ids.map((id) => this.getAudit(id)))).filter((a): a is AuditSummary => a !== null);
    return audits.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.auditId.localeCompare(b.auditId));
  }
```

(A folder without `audit.json` gives `getAudit(id) === null` and is filtered out, as before.)

## Tests

`packages/core/tests/audit-store-backend.test.ts` (it runs the local backend): add `'listFolders gives the folders directly inside a prefix'`: put `audits/aaaaaaaa/audit.json`, `audits/aaaaaaaa/v1/result.json`, `audits/bbbbbbbb/audit.json` and `other/x.json`; expect `listFolders('audits')` to equal `['aaaaaaaa', 'bbbbbbbb']`, `listFolders('audits/aaaaaaaa')` to equal `['v1']`, and `listFolders('missing')` to equal `[]`.

`packages/core/tests/audit-store-gcs.test.ts` (it uses a fake `fetch`): copy the setup of an existing `list` test. Add:

- `'listFolders asks with a delimiter and returns the folder names'`: the fake answers `{ prefixes: ['audits/aaaaaaaa/', 'audits/bbbbbbbb/'] }`; expect the request URL to contain `delimiter=%2F` and `prefix=audits%2F`, and the result to equal `['aaaaaaaa', 'bbbbbbbb']`.
- `'deletePrefix deletes every object and treats 404 as gone'`: list answers 20 object names; DELETE answers 204 for all but one, which answers 404. Expect 20 DELETE requests and no throw. Then one DELETE answering 500: expect the call to reject.

`packages/core/tests/audit-store.test.ts`: the existing list tests must pass unchanged (they prove `listAudits` gives the same result through the new path).

Run: `pnpm exec vitest run packages/core/tests/audit-store-backend.test.ts packages/core/tests/audit-store-gcs.test.ts packages/core/tests/audit-store.test.ts packages/core/tests/audit-store-shortlist.test.ts`, then `pnpm build`.

## Done when

- [ ] `listAudits` no longer lists every object when the backend has `listFolders`.
- [ ] `deletePrefix` on Cloud Storage sends up to 8 deletes at once.
- [ ] Tests and `pnpm build` pass.

## Notes

- `listFolders` is optional on purpose: test doubles that implement `AuditStoreBackend` by hand keep working through the `list` fallback.
- Do not change key names or the lock.
