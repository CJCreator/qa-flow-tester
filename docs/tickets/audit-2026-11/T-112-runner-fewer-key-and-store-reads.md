# T-112: Resolve the AI key once, and read Page Content in parallel

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | speed | built |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`
- `packages/runner/src/routes/audit-export.ts`
- `packages/runner/src/routes/audit-share.ts`

**Do not build in parallel with:** T-91, T-92, T-94, T-96, T-97, T-99, T-100, T-106, T-108, T-110 (edit `server.ts`); T-109 (edits `audit-share.ts`).

## Problem

A. `aiSetup()` resolves the stored AI key twice per call: `storedKey(provider)` and then `storedKeySource(provider)` each call `keyResolver.resolveKey(provider)`. A key kept in the OS keychain is read by starting an OS process, so each call pays twice. `aiSetup()` runs on every AI settings, usage and estimate request and on every Check-up start.

B. Exporting or sharing a Website Audit reads every page's Page Content from the store one after another. On the hosted copy the store is Cloud Storage, so a 50-page audit makes 50 sequential requests.

## Current code

`packages/runner/src/server.ts` (branch `worktree-audit-cleanup`), inside `aiSetup()` (find with `grep -n "private async aiSetup" packages/runner/src/server.ts`):

```ts
    const settings = await this.readAiModels();
    const provider = settings.provider ?? 'openrouter';
    const key = await this.storedKey(provider);
    // Where that key is kept (never the key): the resolver's own answer for the same provider.
    const keySource = key && provider !== 'mock' ? await this.storedKeySource(provider) : undefined;
```

The two helpers in the same file:

```ts
  private async storedKey(provider: AIProviderType): Promise<string | undefined> {
    if (provider === 'mock') return 'mock-key';
    const resolved = await this.keyResolver.resolveKey(provider);
    return resolved?.provider === provider ? resolved.apiKey : undefined;
  }
```

```ts
  private async storedKeySource(provider: AIProviderType): Promise<AiKeySource | undefined> {
    const resolved = await this.keyResolver.resolveKey(provider);
    return resolved?.provider === provider ? resolved.source : undefined;
  }
```

`packages/runner/src/routes/audit-export.ts:197-205` and `packages/runner/src/routes/audit-share.ts:200-208` (the same loop in both):

```ts
  const contents: PageContent[] = [];
  for (const page of result.pages) {
    try {
      const content = await store.readVersionJson<PageContent>(auditId, version, pageContentName(page.urlPath));
      if (content) contents.push(content);
    } catch {
      // A page without readable Page Content keeps its stored text.
    }
  }
```

## Change

A. In `aiSetup()`, replace the two lines that set `key` and `keySource` (and the comment between them) with:

```ts
    // One lookup gives both the key and where it is kept (a keychain read can start an OS process).
    let key: string | undefined;
    let keySource: AiKeySource | undefined;
    if (provider === 'mock') {
      key = 'mock-key';
    } else {
      const resolved = await this.keyResolver.resolveKey(provider);
      if (resolved?.provider === provider) {
        key = resolved.apiKey;
        keySource = key ? resolved.source : undefined;
      }
    }
```

Then check `grep -n "storedKeySource(" packages/runner/src/server.ts`. If only the declaration is left, delete the `storedKeySource` method and its doc comment. Keep `storedKey`: other code calls it.

B. In both route files, replace the loop with:

```ts
  // Read together: on the hosted copy each read is a Cloud Storage request. Order follows result.pages.
  const read = await Promise.all(
    result.pages.map((page) =>
      store
        .readVersionJson<PageContent>(auditId, version, pageContentName(page.urlPath))
        // A page without readable Page Content keeps its stored text.
        .catch(() => null)
    )
  );
  const contents: PageContent[] = read.filter((content): content is PageContent => !!content);
```

## Tests

No new test: results are the same, in the same order. Run:

`pnpm exec vitest run packages/runner/tests/audit-share-routes.test.ts`, every runner export test (`pnpm exec vitest run --project unit packages/runner/tests/audit-export`), every runner AI test (`pnpm exec vitest run --project unit packages/runner/tests/ai-`), then `pnpm build`.

## Done when

- [x] `aiSetup()` calls `resolveKey` once.
- [x] Both route files read Page Content with `Promise.all`.
- [x] Listed tests and `pnpm build` pass.

## Notes

- Keep the order of `contents` the same as `result.pages`; `Promise.all` preserves it.
- If a test counts calls to `resolveKey` and now expects one fewer, update that number only.
- Not in this ticket: `handleAiEstimate` calling `freeRequestsToday` twice (it needs a change to `aiBudgetFor`'s return value).
