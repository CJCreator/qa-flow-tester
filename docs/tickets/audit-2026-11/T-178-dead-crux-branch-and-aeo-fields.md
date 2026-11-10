# T-178: remove the unused CrUX branch and two unused AEO fields

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | dead-code | todo |

**Files you may edit (no others):**
- `packages/checkers/src/performance.ts`
- `packages/checkers/src/aeo.ts`
- `packages/checkers/tests/seo.test.ts`

**Do not build in parallel with:** T-169 (same file `aeo.ts`), T-159, T-160, T-161, T-170 (same test file).

## Problem
1. `PerformanceChecker` has a branch for Chrome UX Report field data (`context.cruxFieldMetrics`). Nothing in the repository ever passes that value (Grep for `cruxFieldMetrics` under `packages/` finds only `performance.ts` itself), so the branch never runs. Owner decision: code that nothing uses is deleted.
2. `AeoChecker.collectDetails` reads `hasAuthorByline` and `hasDatePublished` from the page, but `AeoChecker` never uses them. `GeoChecker` collects its own copies of both and is the one that reports on them.

## Current code
`packages/checkers/src/performance.ts:22-31` (branch `worktree-audit-cleanup`)
```ts
  /**
   * Chrome UX Report (CrUX) 75th percentile real-user field data (G16 / ADR 0035).
   */
  cruxFieldMetrics?: {
    lcpP75Ms?: number;
    inpP75Ms?: number;
    clsP75?: number;
    scope?: 'page' | 'origin';
  };
}
```
`packages/checkers/src/performance.ts:291-319`
```ts
    // 4b. Chrome UX Report (CrUX) real-user field data (G16 / ADR 0035)
    if (context.cruxFieldMetrics) {
      const { lcpP75Ms, inpP75Ms, clsP75, scope } = context.cruxFieldMetrics;
      ...
    }

    // 4. Slow network requests (> 2s)
```
`packages/checkers/src/aeo.ts:16-25`
```ts
export interface AeoPageDetails {
  jsonLdScripts: string[];
  hasBreadcrumbsNav: boolean;
  questionHeadings: Array<{ text: string; nextParagraphWordCount: number; hasAnswerParagraph: boolean }>;
  wordCount: number;
  listCount: number;
  tableCount: number;
  hasAuthorByline: boolean;
  hasDatePublished: boolean;
}
```
`packages/checkers/src/aeo.ts:255-274`, inside `collectDetails`
```ts
        // Author / Date attribution in DOM
        const authorEl = document.querySelector('[rel="author"], [class*="author" i], [itemprop="author"]');
        const hasAuthorByline = !!authorEl;

        const dateEl = document.querySelector(
          'time[datetime], [itemprop="datePublished"], meta[property="article:published_time"]'
        );
        const hasDatePublished = !!dateEl;

        return {
          jsonLdScripts,
          hasBreadcrumbsNav,
          questionHeadings: questionHeadings.slice(0, 5),
          wordCount,
          listCount,
          tableCount,
          hasAuthorByline,
          hasDatePublished,
        };
```

## Change
### performance.ts
1. Delete the `cruxFieldMetrics?: { ... };` field and its doc comment from the context interface (the six lines above the closing `}` shown first).
2. Delete the whole block that starts with the comment `// 4b. Chrome UX Report (CrUX) real-user field data (G16 / ADR 0035)` and ends with the closing brace of `if (context.cruxFieldMetrics) { ... }`. The next line kept is `// 4. Slow network requests (> 2s)`.
3. If a variable is now unused (the build or `pnpm lint` reports it), remove it. Do not remove `SPEED_THRESHOLDS`; other rules use it.

### aeo.ts
4. In `AeoPageDetails`, delete the lines `hasAuthorByline: boolean;` and `hasDatePublished: boolean;`.
5. In `collectDetails`, delete from the comment `// Author / Date attribution in DOM` through `const hasDatePublished = !!dateEl;`, and delete `hasAuthorByline,` and `hasDatePublished,` from the returned object.

### seo.test.ts
6. Mock details passed to `AeoChecker` (the objects that have a `questionHeadings` key) may still list `hasAuthorByline` and `hasDatePublished`. Remove those two keys from the AEO mocks only. Leave them in mocks passed to `GeoChecker` (objects with `hasMainOrArticle` or `totalHtmlLength`): GEO uses them.

## Tests
No new test: this removes code that cannot run.
- `pnpm exec vitest run packages/checkers/tests/seo.test.ts`
- `pnpm exec vitest run --project browser packages/checkers/tests/performance.test.ts` (browser tier; Chromium: `pnpm --filter @qa/core exec playwright install chromium`)
- `pnpm build` and `pnpm typecheck`

## Done when
- [ ] Grep for `cruxFieldMetrics` and `CRUX` under `packages/checkers` finds nothing.
- [ ] Grep for `hasAuthorByline` under `packages/checkers/src/aeo.ts` finds nothing; `geo.ts` still has it.
- [ ] The test runs, `pnpm build` and `pnpm typecheck` pass.

## Notes
- Do not touch `packages/checkers/src/geo.ts`.
- `docs/adr/0035-*` describes CrUX as a plan; leave the ADR alone. If CrUX is wired in later it should also judge INP, which the deleted branch ignored.
- If T-169 has already been built, `questionHeadings` in `AeoPageDetails` has a longer type; keep whatever is there and only delete the two fields.
