# T-140: Tool-caused load failures are reported as findings against the site

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core/audit | bug | built |

**Files you may edit (no others):**
- `packages/core/src/audit/pipeline/skipped-findings.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/tests/audit-skipped-findings.test.ts`

**Do not build in parallel with:** T-138, T-144, T-145, T-153, T-154, T-158 (all edit `pipeline.ts`).

## Problem

Every Skipped Page with the reason `did-not-load` becomes a Major finding that tells the owner to "Check network connectivity and ensure the web server is answering requests." But the Spider also uses `did-not-load` when the tool itself failed:

- `detail: 'aborted'`: the page was closed or the browser crashed.
- `detail: 'other'` or an error name such as `'Error'`: an internal error, or a pacer wait that threw.
- no `detail`: the page was queued but never requested.

Only `detail: 'net'` is a network failure caused by the site. ADR 0042 says a tool-caused failure is listed as not checked and is never a finding.

Scenario: Chromium crashes on one page. The Website Audit reports "Page failed to load" against the site for a page that was never the site's fault.

## Current code

`packages/core/src/audit/pipeline/skipped-findings.ts:13` (branch `worktree-audit-cleanup`)

```ts
export const SITE_CAUSED_SKIP_REASONS: ReadonlySet<RouteSkipReason> = new Set([
  'http-error',
  'timeout',
  'did-not-load',
]);

/**
 * Returns true if the skip reason was caused by the target website rather than crawler limits.
 */
export function isSiteCausedSkip(why: RouteSkipReason): boolean {
  return SITE_CAUSED_SKIP_REASONS.has(why);
}
```

Same file, end:

```ts
  for (const s of skipped) {
    if (isSiteCausedSkip(s.why)) {
      findings.push(createSkippedPageFinding(s, ids.next()));
    }
  }
```

`packages/core/src/audit/pipeline/pipeline.ts:490`

```ts
  // Site-caused Skipped Pages become findings (T-84, ADR 0018)
  for (const s of crawl.coverage.skipped) {
    if (isSiteCausedSkip(s.why)) {
      unscored.push(createSkippedPageFinding(s, ids.next()));
    }
  }
```

`SkippedPageInfo` is `{ urlPath: string; why: RouteSkipReason; status?: number; finalPath?: string; detail?: string }`.

## Change

1. `skipped-findings.ts`: keep `SITE_CAUSED_SKIP_REASONS` and `isSiteCausedSkip` exactly as they are (other code calls `isSiteCausedSkip` with a rule name). Add below `isSiteCausedSkip`:

```ts
/**
 * True when this Skipped Page failed because of the site. A `did-not-load` skip counts only when the
 * Spider recorded a network failure (`detail: 'net'`); a closed page, a crashed browser or a page that was
 * never requested is the tool's own failure and stays "not checked" (ADR 0042).
 */
export function isSiteCausedSkippedPage(skip: Pick<SkippedPageInfo, 'why' | 'detail'>): boolean {
  if (skip.why === 'did-not-load') return skip.detail === 'net';
  return isSiteCausedSkip(skip.why);
}
```

2. `skipped-findings.ts`, in `createSkippedPageFindings`: change `if (isSiteCausedSkip(s.why)) {` to `if (isSiteCausedSkippedPage(s)) {`.

3. `pipeline.ts`: change the loop shown above to:

```ts
  // Site-caused Skipped Pages become findings (T-84, ADR 0018)
  for (const s of crawl.coverage.skipped) {
    if (isSiteCausedSkippedPage(s)) {
      unscored.push(createSkippedPageFinding(s, ids.next()));
    }
  }
```

Add `isSiteCausedSkippedPage` to the existing import from `'./skipped-findings.js'` in `pipeline.ts`. Leave the other use of `isSiteCausedSkip` in `pipeline.ts` (the `checkCitations` filter) unchanged.

## Tests

Edit `packages/core/tests/audit-skipped-findings.test.ts`. Add a `describe('isSiteCausedSkippedPage', ...)`:

| input | expected |
|---|---|
| `{ why: 'http-error' }` | `true` |
| `{ why: 'timeout', detail: '30000ms' }` | `true` |
| `{ why: 'did-not-load', detail: 'net' }` | `true` |
| `{ why: 'did-not-load', detail: 'aborted' }` | `false` |
| `{ why: 'did-not-load', detail: 'other' }` | `false` |
| `{ why: 'did-not-load', detail: 'Error' }` | `false` |
| `{ why: 'did-not-load' }` | `false` |
| `{ why: 'robots' }` | `false` |

Add to the `createSkippedPageFindings` tests: three skips `[{ urlPath: '/a', why: 'did-not-load', detail: 'net' }, { urlPath: '/b', why: 'did-not-load', detail: 'aborted' }, { urlPath: '/c', why: 'did-not-load' }]` give exactly one finding, for `/a`. If an existing test in the file passes a `did-not-load` skip without `detail` and expects a finding, add `detail: 'net'` to its input.

Run: `pnpm exec vitest run packages/core/tests/audit-skipped-findings.test.ts packages/core/tests/audit-pipeline.test.ts`, then `pnpm build`.

## Done when

- [x] A `did-not-load` skip with `detail` other than `'net'` gives no finding.
- [x] The Skipped Page is still listed in `result.coverage.skipped` (no change there).
- [x] Tests and `pnpm build` pass.

## Notes

- If `audit-pipeline.test.ts` has a test that feeds a `did-not-load` skip without `detail` and expects a finding, add `detail: 'net'` to that fixture; do not weaken the rule.
- Do not change the finding wording.
