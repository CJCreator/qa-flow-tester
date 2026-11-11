# T-153: The pipeline re-implements three helpers that already exist

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core/audit | inconsistency | built |

**Files you may edit (no others):**
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/src/audit/phone-layout.ts`
- `packages/core/src/audit/store/keys.ts`
- `packages/core/tests/audit-store.test.ts`

**Do not build in parallel with:** T-138, T-140, T-144, T-145, T-154, T-158 (edit `pipeline.ts`); T-150, T-156, T-157 (same test file or `keys.ts`). **Depends on:** T-140 (it changes the loop in step 1).

## Problem

1. `pipeline.ts` loops over the Skipped Pages and builds findings itself. `createSkippedPageFindings` in `skipped-findings.ts` does exactly that and is used only by tests.
2. `pipeline.ts` passes `aiInFlight: 4`. The constant `AUDIT_AI_IN_FLIGHT = 4` exists in `ai/assessment.ts` for this.
3. `pageContentName` (`pipeline.ts`) and `phoneScreenshotFile` (`phone-layout.ts`) contain the same "slug plus 8 hex characters of a SHA-256" routine.

## Current code

Branch `worktree-audit-cleanup`.

`packages/core/src/audit/pipeline/pipeline.ts:490` (after T-140)

```ts
  // Site-caused Skipped Pages become findings (T-84, ADR 0018)
  for (const s of crawl.coverage.skipped) {
    if (isSiteCausedSkippedPage(s)) {
      unscored.push(createSkippedPageFinding(s, ids.next()));
    }
  }
```

`packages/core/src/audit/pipeline/pipeline.ts:653`

```ts
        aiInFlight: 4,
```

`packages/core/src/audit/pipeline/pipeline.ts:187`

```ts
/** The per-version Page Content object name of a page: `pages/<slug>-<sha256-8>`. */
export function pageContentName(urlPath: string): string {
  const slug =
    urlPath
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'home';
  const hash = createHash('sha256').update(urlPath).digest('hex').slice(0, 8);
  return `pages/${slug}-${hash}`;
}
```

`packages/core/src/audit/phone-layout.ts:39`

```ts
export function phoneScreenshotFile(urlPath: string): string {
  const slug =
    urlPath
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'home';
  const hash = createHash('sha256').update(urlPath).digest('hex').slice(0, 8);
  return `phone/${slug}-${hash}.png`;
}
```

## Change

1. `pipeline.ts`: replace the loop with one line, and change the import from `'./skipped-findings.js'` so it imports `createSkippedPageFindings` (remove `createSkippedPageFinding` and `isSiteCausedSkippedPage` from that import if they are no longer used in the file; keep `isSiteCausedSkip`, which the `checkCitations` filter uses):

```ts
  // Site-caused Skipped Pages become findings (T-84, ADR 0018)
  unscored.push(...createSkippedPageFindings(crawl.coverage.skipped, ids));
```

2. `pipeline.ts`: `aiInFlight: AUDIT_AI_IN_FLIGHT,` and add `AUDIT_AI_IN_FLIGHT` to the existing import from `'../ai/assessment.js'` (add the import if the file reaches assessment through another path such as `'../ai/index.js'`: then import it from where `assessPages` is imported, and if that module does not export the constant, import it directly from `'../ai/assessment.js'`).

3. `store/keys.ts`: add (and add `import { createHash } from 'crypto';` at the top if the file does not import it):

```ts
/**
 * A page path as a stable, file-safe name: a readable slug of at most 60 characters plus the first 8 hex
 * characters of the path's SHA-256, so two paths that slug alike still differ. `/` gives `home-<hash>`.
 */
export function pageSlug(urlPath: string): string {
  const slug =
    urlPath
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'home';
  const hash = createHash('sha256').update(urlPath).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}
```

4. `pipeline.ts`: `pageContentName` body becomes `return \`pages/${pageSlug(urlPath)}\`;`. Import `pageSlug` from `'../store/keys.js'`. Remove the `createHash` import from `pipeline.ts` if nothing else uses it.

5. `phone-layout.ts`: `phoneScreenshotFile` body becomes `return \`phone/${pageSlug(urlPath)}.png\`;`. Import `pageSlug` from `'./store/keys.js'`. Remove the `createHash` import if nothing else uses it.

## Tests

`packages/core/tests/audit-store.test.ts`: add `'pageSlug: a readable slug plus a hash, the same names as before'`:

- `pageSlug('/')` matches `/^home-[0-9a-f]{8}$/`;
- `pageSlug('/About Us/')` matches `/^about-us-[0-9a-f]{8}$/`;
- `pageSlug('/a')` is not equal to `pageSlug('/A')`;
- `pageContentName('/pricing')` equals `` `pages/${pageSlug('/pricing')}` `` and `phoneScreenshotFile('/pricing')` equals `` `phone/${pageSlug('/pricing')}.png` ``.

Import `pageSlug` from the same module the test file already imports store key helpers from; import `pageContentName` and `phoneScreenshotFile` from `'../src/index.js'` or the path other core tests use for them.

Existing check that must still hold: `audit-pipeline.test.ts` (about line 491) expects `assessCall.aiInFlight` to be `4`.

Run: `pnpm exec vitest run packages/core/tests/audit-store.test.ts packages/core/tests/audit-pipeline.test.ts packages/core/tests/audit-phone-layout.test.ts packages/core/tests/audit-skipped-findings.test.ts`, then `pnpm build`.

## Done when

- [x] The slug routine exists once.
- [x] Stored object names are unchanged (the new test proves it).
- [x] Tests and `pnpm build` pass.

## Notes

- Do not move `pageContentName` out of `pipeline.ts`: the runner and `write-all.ts` import it from there.
- The names must not change: audits already stored use them.
