# T-157: The save step writes Page Content and screenshots one object at a time

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | core/audit | speed | built |

**Files you may edit (no others):**
- `packages/core/src/audit/store/audit-store.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/tests/audit-store.test.ts`
- `packages/core/tests/audit-pipeline.test.ts`

**Do not build in parallel with:** every other ticket that edits `pipeline.ts` (T-138, T-140, T-144, T-145, T-153, T-154, T-158) or `audit-store.ts` (T-150, T-156). **Depends on:** T-156 (same file; build after it).

## Problem

At the end of a Website Audit the pipeline saves each page's Page Content and each phone screenshot with its own store call. Each call takes the audit lock, reads the version record (one GET) and then writes (one PUT), and the calls run one after another. On Cloud Storage a 50-page audit makes about 2 x (pages + screenshots) sequential round trips before the result is saved.

## Current code

Branch `worktree-audit-cleanup`.

`packages/core/src/audit/store/audit-store.ts:394`

```ts
  /** Writes under the audit lock, only while the version exists (so nothing outlives a deleted audit). */
  private async writeToVersion(auditId: string, version: number, write: () => Promise<void>): Promise<void> {
    await this.withAuditLock(auditId, async () => {
      if (!(await this.readVersion(auditId, version))) throw notFound('version');
      await write();
    });
  }
```

```ts
  async writeVersionJson(auditId: string, version: number, name: string, value: unknown): Promise<void> {
    const key = versionJsonKey(auditId, version, name);
    if (value === undefined) throw invalidInput('The version object is empty.');
    await this.writeToVersion(auditId, version, () => this.backend.putJson(key, value));
  }

  /** Writes `audits/<id>/v<n>/<name>` (preview.html, screenshots...). */
  async putVersionFile(auditId: string, version: number, name: string, data: Uint8Array): Promise<void> {
    const key = versionFileKey(auditId, version, name);
    if (!(data instanceof Uint8Array)) throw invalidInput('The version file is not valid.');
    await this.writeToVersion(auditId, version, () => this.backend.putBytes(key, data));
  }
```

`packages/core/src/audit/pipeline/pipeline.ts:121`

```ts
export type AuditPipelineStore = Pick<
  AuditStore,
  'saveResult' | 'writeVersionJson' | 'putVersionFile' | 'updateVersion'
> &
  Partial<Pick<AuditStore, 'saveAuditDocument' | 'readVersionJson'>>;
```

`packages/core/src/audit/pipeline/pipeline.ts:826` (the save step)

```ts
  const saveNotes: string[] = [];
  for (const p of readable) {
    try {
      await store.writeVersionJson(auditId, version, pageContentName(p.info.urlPath), p.read!.content);
    } catch {
      saveNotes.push(`The Page Content of ${p.info.urlPath} could not be saved.`);
    }
  }
  for (const p of samples) {
    const rel = p.phone?.screenshotPath;
    if (!p.phone || !rel) continue;
    try {
      const data = await fs.readFile(path.join(deps.workDir, ...rel.split('/')));
      await store.putVersionFile(auditId, version, rel, new Uint8Array(data));
    } catch {
      p.phone = { ...p.phone, screenshotPath: null };
      saveNotes.push(`The phone screenshot of ${p.urlPath} could not be saved.`);
    }
  }
```

## Change

1. `audit-store.ts`: add a batch write below `putVersionFile`. It checks the version once, under one lock, and writes with a small pool. It never throws for a single failed entry; it reports which entries were saved.

```ts
  /**
   * Writes several per-version objects under one audit lock and one version check, a few at a time. Returns,
   * in input order, whether each entry was saved. Throws only when the version does not exist or an entry's
   * name or value is not valid.
   */
  async writeVersionEntries(
    auditId: string,
    version: number,
    entries: ReadonlyArray<{ kind: 'json'; name: string; value: unknown } | { kind: 'file'; name: string; data: Uint8Array }>
  ): Promise<boolean[]> {
    const writes = entries.map((entry) => {
      if (entry.kind === 'json') {
        const key = versionJsonKey(auditId, version, entry.name);
        if (entry.value === undefined) throw invalidInput('The version object is empty.');
        return () => this.backend.putJson(key, entry.value);
      }
      const key = versionFileKey(auditId, version, entry.name);
      if (!(entry.data instanceof Uint8Array)) throw invalidInput('The version file is not valid.');
      return () => this.backend.putBytes(key, entry.data);
    });
    const saved: boolean[] = new Array(writes.length).fill(false);
    await this.withAuditLock(auditId, async () => {
      if (!(await this.readVersion(auditId, version))) throw notFound('version');
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++;
          if (i >= writes.length) return;
          try {
            await writes[i]();
            saved[i] = true;
          } catch {
            saved[i] = false;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(VERSION_WRITES_IN_FLIGHT, writes.length) }, () => worker()));
    });
    return saved;
  }
```

Add near the other constants at the top of `audit-store.ts`:

```ts
/** Per-version objects written at once by `writeVersionEntries`. */
const VERSION_WRITES_IN_FLIGHT = 6;
```

2. `pipeline.ts`: allow the batch method on the pipeline's store type (optional, so test doubles without it still work):

```ts
export type AuditPipelineStore = Pick<
  AuditStore,
  'saveResult' | 'writeVersionJson' | 'putVersionFile' | 'updateVersion'
> &
  Partial<Pick<AuditStore, 'saveAuditDocument' | 'readVersionJson' | 'writeVersionEntries'>>;
```

3. `pipeline.ts`: replace the two loops shown above with:

```ts
  const saveNotes: string[] = [];
  if (typeof store.writeVersionEntries === 'function') {
    // One lock and one version check for all of them, a few at a time.
    const shots: Array<{ page: AuditPage; rel: string; data: Uint8Array | null }> = [];
    for (const p of samples) {
      const rel = p.phone?.screenshotPath;
      if (!p.phone || !rel) continue;
      let data: Uint8Array | null = null;
      try {
        data = new Uint8Array(await fs.readFile(path.join(deps.workDir, ...rel.split('/'))));
      } catch {
        data = null;
      }
      shots.push({ page: p, rel, data });
    }
    const readableShots = shots.filter((s) => s.data !== null);
    let saved: boolean[];
    try {
      saved = await store.writeVersionEntries(auditId, version, [
        ...readable.map((p) => ({
          kind: 'json' as const,
          name: pageContentName(p.info.urlPath),
          value: p.read!.content,
        })),
        ...readableShots.map((s) => ({ kind: 'file' as const, name: s.rel, data: s.data! })),
      ]);
    } catch {
      saved = new Array(readable.length + readableShots.length).fill(false);
    }
    readable.forEach((p, i) => {
      if (!saved[i]) saveNotes.push(`The Page Content of ${p.info.urlPath} could not be saved.`);
    });
    const shotSaved = new Map(readableShots.map((s, i) => [s.rel, saved[readable.length + i]]));
    for (const s of shots) {
      if (s.data !== null && shotSaved.get(s.rel)) continue;
      s.page.phone = { ...s.page.phone!, screenshotPath: null };
      saveNotes.push(`The phone screenshot of ${s.page.urlPath} could not be saved.`);
    }
  } else {
    for (const p of readable) {
      try {
        await store.writeVersionJson(auditId, version, pageContentName(p.info.urlPath), p.read!.content);
      } catch {
        saveNotes.push(`The Page Content of ${p.info.urlPath} could not be saved.`);
      }
    }
    for (const p of samples) {
      const rel = p.phone?.screenshotPath;
      if (!p.phone || !rel) continue;
      try {
        const data = await fs.readFile(path.join(deps.workDir, ...rel.split('/')));
        await store.putVersionFile(auditId, version, rel, new Uint8Array(data));
      } catch {
        p.phone = { ...p.phone, screenshotPath: null };
        saveNotes.push(`The phone screenshot of ${p.urlPath} could not be saved.`);
      }
    }
  }
```

`AuditPage` is already imported as a type in `pipeline.ts` (it types `const pages: AuditPage[]`). The `else` branch is the old code, unchanged.

## Tests

`packages/core/tests/audit-store.test.ts`: copy the setup of `'records status, finishedAt and counts; only sent fields change'`. Add:

- `'writeVersionEntries saves JSON and files and reports each one'`: write `[{ kind: 'json', name: 'pages/a', value: { a: 1 } }, { kind: 'file', name: 'phone/a.png', data: new Uint8Array([1, 2]) }]`; expect `[true, true]`; read both back with `readVersionJson` and `getVersionFile`.
- `'writeVersionEntries refuses a version that does not exist'`: version 99 rejects.
- `'writeVersionEntries reports a failed entry without failing the others'`: wrap the backend so `putJson` rejects for one key; expect `[false, true]` for two entries where the first uses that key.

`packages/core/tests/audit-pipeline.test.ts`: the existing save tests use a store double without `writeVersionEntries`, so they exercise the `else` branch and must pass unchanged. Add `'the save step uses one batch write when the store has it'`: copy a test that checks saved Page Content; give the store double a `writeVersionEntries` spy that returns `entries.map(() => true)`; expect the spy called once, with one `json` entry per readable page, and `writeVersionJson` not called for page content (it is still called once for `'stages'`). Add a second case where the spy returns `false` for the first entry: expect `result.notes` to contain `The Page Content of <that path> could not be saved.`

Run: `pnpm exec vitest run packages/core/tests/audit-store.test.ts packages/core/tests/audit-pipeline.test.ts`, then `pnpm build`.

## Done when

- [x] With the real `AuditStore`, the save step takes the audit lock once for all Page Content and screenshots.
- [x] The notes for a failed save are worded exactly as before.
- [x] Tests and `pnpm build` pass.

## Notes

- The 14 document saves in `write-all.ts` still go through `saveAuditDocument` one lock each. Leave them: they are few.
- Do not change `writeVersionJson`, `putVersionFile` or the lock.
