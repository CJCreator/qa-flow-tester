# T-325: A Shared Link view reads only its own version, and audit listing has bounded concurrency

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | speed | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/store/shares.ts`
- `packages/core/src/audit/store/audit-store.ts`
- `packages/core/tests/audit-store-shares.test.ts`
- `packages/core/tests/audit-store.test.ts`

**Do not build in parallel with:** T-321 (edits `audit-store.ts`); T-321, T-328 (all edit `audit-store.test.ts`).

## Problem

`GET /s/:linkId` is public: anyone with a Shared Link opens it, and it is served on the hosted copy (`beta: 'allow'`). To answer it, `resolveShare` calls `ctx.getAudit(auditId)` (`packages/core/src/audit/store/shares.ts:136-137`), which reads the audit record, every version record of the audit and the Shortlist entry (`packages/core/src/audit/store/audit-store.ts:365-378`). It only needs one fact from all that: whether the link's own version still exists. The route does not use the summary at all (`packages/runner/src/routes/audit-share.ts`, the comment above `sharedPage`: "the resolved audit summary is not used"). On Cloud Storage each read is a request, so for an audit with 20 versions one view costs 24 reads before the snapshot (index, link, audit record, 20 version records, Shortlist), and repeated views of a link are cheap for the caller and not for the runner.

`listAudits` (`audit-store.ts:381-390`) starts `getAudit` for every audit at once, and each `getAudit` reads all its versions at once. With 100 audits of 5 versions that is about 700 Cloud Storage requests in flight together, which invites 429 answers and holds many sockets.

## Current code

Branch from `main`.

`packages/core/src/audit/store/shares.ts` (`grep -n "ctx.getAudit\|export type ShareResolution" -A3 packages/core/src/audit/store/shares.ts`):

```ts
export type ShareResolution =
  | { status: 'open'; link: ShareLink; audit: AuditSummary }
```

```ts
  const audit = await ctx.getAudit(auditId);
  if (!audit || !audit.versions.some((v) => v.version === link.version)) return { status: 'gone' };
  return { status: 'open', link, audit };
```

`packages/core/src/audit/store/audit-store.ts` (`grep -n "async getAudit\|async listAudits" -A12 packages/core/src/audit/store/audit-store.ts`):

```ts
    const numbers = Array.from({ length: Math.max(0, record.latestVersion) }, (_, i) => i + 1);
    const versions = (await Promise.all(numbers.map((n) => this.readVersion(auditId, n)))).filter(
      (v): v is AuditVersion => v !== null
    );
```

```ts
    const audits = (await Promise.all(ids.map((id) => this.getAudit(id)))).filter((a): a is AuditSummary => a !== null);
```

`AuditStoreContext` already has `readVersion(auditId, version)`, which reads `versionRecordKey(auditId, version)` only. The only caller of `resolveShare` outside tests is the `/s/:linkId` handler, and it reads `resolved.link` only (`grep -rn "resolveShare\|ShareResolution" packages --include=*.ts`).

## Change

1. `shares.ts`:
   - Change the open variant to `{ status: 'open'; link: ShareLink; version: AuditVersion }` (import `type AuditVersion` from `@qa/types`; drop `AuditSummary` from the import when unused).
   - Replace the two `getAudit` lines with:

```ts
  // Only the link's own version: one read, whatever the number of versions (the route needs no more).
  if (!isPositiveVersion(link.version)) return { status: 'gone' };
  const version = await ctx.readVersion(auditId, link.version);
  if (!version) return { status: 'gone' };
  return { status: 'open', link, version };
```

   where `isPositiveVersion` is a local check (`Number.isInteger(v) && v >= 1`) so a damaged link record answers 'gone' instead of throwing in `assertVersion` (inside `versionRecordKey`).

2. `audit-store.ts`:
   - Add `const AUDIT_READS_IN_FLIGHT = 8;` next to `VERSION_WRITES_IN_FLIGHT` and a module helper that keeps input order:

```ts
/** Runs `fn` over `items`, at most `limit` at once; results in input order. */
async function mapInFlight<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}
```

   - `getAudit`: `const versions = (await mapInFlight(numbers, AUDIT_READS_IN_FLIGHT, (n) => this.readVersion(auditId, n))).filter(...)`.
   - `listAudits`: `const audits = (await mapInFlight(ids, AUDIT_READS_IN_FLIGHT, (id) => this.getAudit(id))).filter(...)`.

3. Run `pnpm exec prettier --write` on the two files and `pnpm build` (`ShareResolution` is exported from `@qa/core`).

## Tests

`packages/core/tests/audit-store-shares.test.ts`:

- `'resolves an open link with its audit'` becomes `'resolves an open link with its own version'`: `expect(resolved.version).toMatchObject({ auditId, version: 1 })`.
- New `'reads only the index entry, the link record and its own version record'`: wrap `LocalAuditStoreBackend` so `getJson` records each key; create an audit, add two versions, share version 2, clear the record list, `resolveShare(link.id)`; the recorded keys are exactly `[shareIndexKey(id), shareRecordKey(auditId, id), versionRecordKey(auditId, 2)]` (import `versionRecordKey` from the store index).
- New `'is gone when its version record is missing or the stored version is not a number'`: remove `audits/<id>/v1/version.json` with `fs.rm` (local store path under `backend.root`) and expect `{ status: 'gone' }`; then write a link record with `version: 0` through `backend.putJson(shareRecordKey(...))` and expect `{ status: 'gone' }` (no throw).
- The existing cases (revoked, expired, deleted audit, unknown) keep passing unchanged.

`packages/core/tests/audit-store.test.ts`: new `describe('bounded reads')`:

- `'listAudits and getAudit keep their reads bounded'`: a wrapping backend whose `getJson` increments a counter, waits 5 ms, and decrements it, tracking the highest value. Create 20 audits with 2 versions each: `listAudits()` returns the 20 audits, newest first as before, and the highest value is at most 16 (8 audits at once, each reading its 2 versions together; the record and the Shortlist entry are read before and after). Reset the tracker; `getAudit` of one audit with 12 versions keeps the highest value at most 8.

Run: `pnpm exec vitest run packages/core/tests/audit-store-shares.test.ts packages/core/tests/audit-store.test.ts packages/runner/tests/audit-share-routes.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "getAudit" packages/core/src/audit/store/shares.ts` finds nothing.
- [ ] `grep -n "AUDIT_READS_IN_FLIGHT" packages/core/src/audit/store/audit-store.ts` finds the constant and both uses.
- [ ] The tests above pass, the core unit tests pass, and `pnpm build` passes.

## Notes

- Audit finding M40 (audit of 11 Nov 2026 on `d225418`).
- Out of scope: a rate limit on the public `GET /s/:linkId` row. After this ticket a view costs three small reads plus the snapshot; a per-address limit for public rows is a runner change of its own.
- Out of scope: a per-audit summary record that would make `listAudits` one read per audit. Bounded reads fix the burst without a new stored object to keep in step.
- T-321 also edits `audit-store.ts` (`deleteAudit`) and `audit-store.test.ts`.
