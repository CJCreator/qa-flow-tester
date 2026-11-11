# T-323: Section rewrite state lives in the audit store, so it survives deploys and goes with deletion

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/ai/rewrite-store.ts`
- `packages/runner/src/routes/index.ts`
- `packages/core/tests/audit-rewrite-store.test.ts`
- `packages/runner/tests/audit-ai-routes.test.ts`

**Do not build in parallel with:** T-264, T-322 (all edit `index.ts`).

## Problem

A Section rewrite (approve, AI copy, accept, REQ-030) keeps its state in a plain file, `rewrites.json`, in a folder the runner picks. On a local store that folder is the version folder inside the store, so it is deleted with the audit. On the hosted copy the store is a Cloud Storage bucket, so the runner puts the file under its data folder instead: `<dataDir>/audit-rewrites/audits/<id>/v<n>/rewrites.json` (`packages/runner/src/routes/index.ts:148-155`). The hosted data folder is `/tmp/qa-data` (`.github/workflows/deploy.yml:203`).

So on the hosted copy:

- every deploy or instance restart loses which Sections were approved and the AI copy that was not accepted yet (the person pays for the AI request again);
- deleting the Website Audit does not remove the file, because `deleteAudit` only deletes the store's own folder (`packages/core/src/audit/store/audit-store.ts:393-403`). ADR 0036 says deleting an audit removes every edit and file it owns.

`RewriteStore` writes with `writeJsonAtomic` to `path.join(versionDir, REWRITES_FILE)` (`packages/core/src/audit/ai/rewrite-store.ts:174-176`, `:286`) and never goes through the store. The edit overlay already does it the right way: `updateEditsOverlay` (`packages/runner/src/routes/audit-documents.ts:100-112`) reads and writes `edits` with `store.readVersionJson` / `store.writeVersionJson`, one change at a time per version.

## Current code

Branch from `main`.

`packages/runner/src/routes/index.ts` (`grep -n "rewriteStoreFor" -A7 packages/runner/src/routes/index.ts`):

```ts
  /** Rewrite state is a local file per version; a cloud store keeps it under the runner data folder. */
  const rewriteStoreFor = (auditId: string, version: number): RewriteStore => {
    const folder = versionFolder(auditId, version).split('/');
    const dir =
      backend.kind === 'local'
        ? path.join((backend as LocalAuditStoreBackend).root, ...folder)
        : path.join(dataDir, 'audit-rewrites', ...folder);
    return new RewriteStore(dir);
  };
```

`packages/core/src/audit/ai/rewrite-store.ts` (`grep -n "constructor\|readJsonSafe\|writeJsonAtomic\|SAVE_QUEUES" packages/core/src/audit/ai/rewrite-store.ts`):

```ts
  /** `versionDir`: the audit version's folder, chosen and checked by the caller. */
  constructor(versionDir: string) {
    this.file = path.join(versionDir, REWRITES_FILE);
  }

  /** Every Section's rewrite state; empty when nothing is saved or the file is unreadable. */
  async list(): Promise<RewriteState[]> {
    const { data } = await readJsonSafe<Partial<StoredFile>>(this.file, { currentVersion: SCHEMA_VERSION });
    return cleanStates(data?.rewrites);
  }
```

and in `change()`:

```ts
    const waitFor = SAVE_QUEUES.get(this.file) ?? Promise.resolve();
    ...
      await writeJsonAtomic(this.file, stored);
```

`packages/core/src/audit/store/audit-store.ts`: `readVersionJson(auditId, version, name)` reads `audits/<id>/v<n>/<name>.json`; `writeVersionJson` writes it under the audit lock and only while the version exists ("so nothing outlives a deleted audit"). `keys.ts` already lists `rewrites` as a per-version JSON name.

The local layout does not change: `versionJsonKey(id, n, 'rewrites')` is `audits/<id>/v<n>/rewrites.json`, the same file a local runner writes today. Existing local rewrite state stays readable.

## Change

1. `rewrite-store.ts`:
   - Replace the `path`, `readJsonSafe` and `writeJsonAtomic` imports with `import type { AuditStore } from '../store/audit-store.js';` and `import { AuditStoreError } from '../store/backend.js';`.
   - Keep `export const REWRITES_FILE = 'rewrites.json';` (the stored object's file name) and add `const REWRITES_NAME = 'rewrites';` (the per-version JSON name; the store adds `.json`).
   - Add `export type RewriteStoreBackend = Pick<AuditStore, 'readVersionJson' | 'writeVersionJson'>;`
   - Replace the field and constructor:

```ts
  /** The version's rewrites object in the audit store (`audits/<id>/v<n>/rewrites.json`), deleted with the audit. */
  constructor(
    private readonly store: RewriteStoreBackend,
    private readonly auditId: string,
    private readonly version: number
  ) {}

  private get queueKey(): string {
    return `${this.auditId}\n${this.version}`;
  }
```

   - `list()`:

```ts
  async list(): Promise<RewriteState[]> {
    let data: Partial<StoredFile> | null;
    try {
      data = await this.store.readVersionJson<Partial<StoredFile>>(this.auditId, this.version, REWRITES_NAME);
    } catch (err) {
      // An unreadable object reads as empty, as before; a store that cannot be reached is an error.
      if (err instanceof AuditStoreError && err.code === 'invalid-data') return [];
      throw err;
    }
    if (data && typeof data.schemaVersion === 'number' && data.schemaVersion > SCHEMA_VERSION) return [];
    return cleanStates(data?.rewrites);
  }
```

   - `change()`: key the queue on `this.queueKey` instead of `this.file`, and replace `await writeJsonAtomic(this.file, stored);` with `await this.store.writeVersionJson(this.auditId, this.version, REWRITES_NAME, stored);`. Update the `SAVE_QUEUES` comment: "One save queue per audit version...".
   - Update the file's top comment: the state is kept "in the audit store as `rewrites.json` in the version folder (ADR 0036), so it is deleted with the audit".

2. `packages/runner/src/routes/index.ts`: delete `rewriteStoreFor` and, in the `rewrites: (auditId, version) => {` wiring, build `const rewrites = new RewriteStore(store, auditId, version);`. Remove the imports that become unused (`path` from `node:path`, `versionFolder`, `type LocalAuditStoreBackend`); check with `grep -n "path\.\|versionFolder\|LocalAuditStoreBackend" packages/runner/src/routes/index.ts`.

3. Run `pnpm exec prettier --write` on the changed files, then `pnpm build` (`RewriteStore` is exported from `@qa/core`).

## Tests

`packages/core/tests/audit-rewrite-store.test.ts`:

- `beforeEach`: after `mkdtemp`, build `backend = new LocalAuditStoreBackend(dir)`, `auditStore = new AuditStore(backend)` and `auditId = (await auditStore.createAudit({ url: 'https://kumar.example/', limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] }, language: 'en' })).auditId`. Add `const open = () => new RewriteStore(auditStore, auditId, 1);` and `const rewritesFile = () => path.join(backend.root, 'audits', auditId, 'v1', REWRITES_FILE);`.
- Replace every `new RewriteStore(dir)` with `open()` and every `path.join(dir, REWRITES_FILE)` with `rewritesFile()`. The existing cases keep their meaning (approval gate, two stores on one version, persistence, unreadable object reads as empty, concurrent approvals).
- New `'is deleted with the audit (ADR 0036)'`: approve a Section, `auditStore.deleteAudit(auditId)`, then `backend.list(\`audits/${auditId}\`)` is `[]`.
- New `'refuses to write after the version is gone'`: delete the audit, then `open().approve(S2, now)` rejects with `code: 'not-found'` and no file appears.
- New `'a store that cannot be reached is an error, not an empty list'`: a fake `RewriteStoreBackend` whose `readVersionJson` throws `new AuditStoreError('unavailable', 'x')`; `list()` rejects.

`packages/runner/tests/audit-ai-routes.test.ts`: in `start()`, replace `new RewriteStore(dir)` with a small in-memory store: `let saved: unknown = null; const store = new RewriteStore({ readVersionJson: async () => saved as never, writeVersionJson: async (_a, _v, _n, value) => { saved = value; } }, AUDIT_ID, 1);`. Keep `dir` only if other code in the file still uses it.

Run: `pnpm exec vitest run packages/core/tests/audit-rewrite-store.test.ts packages/runner/tests/audit-ai-routes.test.ts packages/core/tests/audit-ai-barrel.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -rn "audit-rewrites" packages --include=*.ts` finds nothing.
- [ ] `grep -n "writeJsonAtomic\|readJsonSafe" packages/core/src/audit/ai/rewrite-store.ts` finds nothing.
- [ ] `grep -n "new RewriteStore(store, auditId, version)" packages/runner/src/routes/index.ts` finds the wiring.
- [ ] The tests above pass, the core and runner unit tests pass, and `pnpm build` passes.

## Notes

- Audit finding M38 (audit of 11 Nov 2026 on `d225418`).
- No migration: hosted rewrite state lived under `/tmp`, which every deploy already wipes. Local state is already at the new key.
- The save queue stays process-local, as the edit overlay's is. The hosted runner is one instance (`--max-instances 1`, ADR 0038), so that is enough. `writeVersionJson` adds the audit lock and the version check for each write.
- T-322 also edits `packages/runner/src/routes/index.ts` (the hosted page limit wiring), in a different block.
