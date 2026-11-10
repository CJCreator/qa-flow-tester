# T-154: Remove dead code and fix stale comments in the Website Audit modules

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core/audit | dead-code | built |

**Files you may edit (no others):**
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/core/src/audit/crawl/reachability.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/src/audit/store/keys.ts`
- `packages/core/src/audit/store/gcs-backend.ts`
- `packages/core/src/audit/ai/pagespeed.ts`
- `packages/core/src/audit/documents/content.ts`, `findings.ts`, `generate.ts`, `owner-audit.ts`, `pitch.ts`, `roadmap-document.ts`, `structure.ts` (step 5 only, one identical replacement each)

**Do not build in parallel with:** T-138, T-139, T-140, T-142, T-144, T-145, T-147, T-152, T-153, T-156, T-158 (they edit `crawl.ts`, `pipeline.ts`, `reachability.ts`, `keys.ts` or `gcs-backend.ts`). Build it last in this batch.

## Problem

Code that can never run, exports that nothing uses, and comments that describe behaviour the code does not have. All are checked with a search of `packages/` (source and tests).

## Current code and change

Branch `worktree-audit-cleanup`. Do each numbered step exactly.

### 1. `crawl.ts`: the `startRecorded` branch can never run

The Spider calls `onStartPage` for every depth-0 visit before it records the page, and `onStartPage` either sets `startRecorded = true` or blocks the page. So `!startRecorded && item.depth === 0` is always false in `onRecordedPage`.

Current (`crawl.ts:332`, `:422`, `:432`; after T-139 and T-147 the last line of the callback differs, keep whatever they left):

```ts
  let startRecorded = false;
```

```ts
        startRecorded = true;
      },
```

```ts
      onRecordedPage: async (page, item) => {
        if (!startRecorded && item.depth === 0) {
          startRecorded = true;
          finalUrl = withoutHash(page.url());
          const kind = classifyInterstitial(await readInterstitialSignals(page));
          if (kind) {
            blocked = kind;
            blockedStop.abort();
            return;
          }
        }
        if (opts.onRenderedPage) await opts.onRenderedPage(page, toAuditPage(item));
      },
```

Change: delete `let startRecorded = false;`; delete the line `startRecorded = true;` at the end of `onStartPage`; delete the whole `if (!startRecorded && item.depth === 0) { ... }` block. Keep the `onRenderedPage` call as it is in the file.

### 2. `keys.ts`: unused alias

Delete this line (`keys.ts:179`):

```ts
export const auditDocumentKey = auditDocPath;
```

### 3. `gcs-backend.ts`: unused factory

Delete (`gcs-backend.ts:267`):

```ts
export function createGcsAuditStoreBackend(options: GcsAuditStoreOptions): GcsAuditStoreBackend {
  return new GcsAuditStoreBackend(options);
}
```

### 4. `pipeline.ts`: a code that is never constructed

Current (`pipeline.ts:172`):

```ts
export class AuditPipelineError extends Error {
  readonly code: 'save-failed' | 'status-not-updated' | 'ERR_PIPELINE';
  readonly errorCode = 'ERR_PIPELINE' as const;
  constructor(code: 'save-failed' | 'status-not-updated' | 'ERR_PIPELINE' = 'save-failed') {
```

Change the two unions to `'save-failed' | 'status-not-updated'`. Keep `errorCode`.

Also in `pipeline.ts` (`:160`), the comment on `citationProblems` says the problems are "recorded, never dropped", but they are only returned to the caller and never stored. Change it to:

```ts
  /** Findings whose page or Section citation does not hold (REQ-017 AC-2): returned to the caller, not stored. */
  citationProblems: CitationProblem[];
```

### 5. Seven documents files: a fallback that never applies

`LabelLookup.requested` is a required field, so `lookup.requested ?? lookup.language` always gives `lookup.requested`. Replace the expression in each place:

| File | Current | New |
|---|---|---|
| `documents/content.ts:233` | `language: lookup.requested ?? lookup.language,` | `language: lookup.requested,` |
| `documents/generate.ts:92` | `language: lookup.requested ?? lookup.language,` | `language: lookup.requested,` |
| `documents/owner-audit.ts:147` | `language: lookup.requested ?? lookup.language,` | `language: lookup.requested,` |
| `documents/pitch.ts:225` | `language: lookup.requested ?? lookup.language,` | `language: lookup.requested,` |
| `documents/structure.ts:179` | `language: lookup.requested ?? lookup.language,` | `language: lookup.requested,` |
| `documents/roadmap-document.ts:77` | `const language = lookup.requested ?? lookup.language;` | `const language = lookup.requested;` |
| `documents/findings.ts:154` | `language: lookup.requested ?? language,` | `language: lookup.requested,` |

In `findings.ts`, if the local `language` variable is then unused, remove it from the destructuring or declaration that defines it.

### 6. Stale comments

`reachability.ts:8`. Current:

```ts
 * - Reachable: the final response after redirects is below 400 within the page timeout. Every hop goes
```

New (the code accepts any answered status; an error status is judged later by the crawl, ADR 0042):

```ts
 * - Reachable: the site answers with any HTTP status after redirects, within the page timeout. Every hop goes
```

`pagespeed.ts:10-11`. Current:

```ts
 *   header, never the address, and never into a returned value, error or log line. Without a key the request is
 *   keyless (free, lower limit).
```

New:

```ts
 *   header, never the address, and never into a returned value, error or log line. Without a key no request is
 *   made (the pages come back 'no-key'), unless the caller sets `allowKeyless`.
```

## Tests

No new test. Run:

`pnpm exec vitest run packages/core/tests/audit-crawl-retry.test.ts packages/core/tests/audit-crawl-limits.test.ts packages/core/tests/audit-pipeline.test.ts packages/core/tests/audit-store-gcs.test.ts packages/core/tests/audit-doc-builders.test.ts packages/core/tests/audit-document-text.test.ts packages/core/tests/audit-document-text-languages.test.ts packages/runner/tests/audit-crawl-route.test.ts`

Then `pnpm build` and `pnpm exec eslint packages/core/src/audit` (no new errors).

## Done when

- [ ] `startRecorded`, `auditDocumentKey` and `createGcsAuditStoreBackend` no longer appear anywhere under `packages/`.
- [ ] No `lookup.requested ??` is left under `packages/core/src/audit/documents`.
- [ ] The listed tests, `pnpm build` and eslint pass.

## Notes

- If a test fails because it relied on the deleted `onRecordedPage` branch (a start page recorded without `onStartPage` running), stop, restore step 1 only, and report it: that would mean the branch is reachable.
- The runner still checks `code === 'ERR_PIPELINE'` on other errors (`packages/runner/src/routes/audit-crawl.ts`); that check reads a plain string and is not affected.
- `PreviewProblem` (the preview's failure type) is not removed: the runner's preview route builds a `{ ok: false, problem: 'failed' }` value when the generator throws.
