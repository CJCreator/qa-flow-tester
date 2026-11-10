# T-179: remove an always-true condition and a duplicate type in the checkers

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | dead-code | built |

**Files you may edit (no others):**
- `packages/checkers/src/site-root.ts`
- `packages/checkers/src/refusal-rule.ts`
- `packages/checkers/src/spec-conformance.ts`

**Do not build in parallel with:** T-159 (same file `site-root.ts`), T-172 (same file `spec-conformance.ts`).

## Problem
1. `site-root.ts`: `else if (!hasSitemap)` sits in the `else` of the branch that sets `hasSitemap = true`. `hasSitemap` is declared `false` just above and nothing else sets it, so the condition is always true there.
2. `refusal-rule.ts` declares `RefusalExpectation`, a hand-kept copy of the `refusal` field of `TestCaseExpectations` in `@qa/types` ("Local mirror of ..."). `spec-conformance.ts` casts the real, already typed value to this copy for no reason. Two copies of one shape can drift.

## Current code
`packages/checkers/src/site-root.ts:164-174` (branch `worktree-audit-cleanup`)
```ts
    // 2. Audit sitemap.xml
    let hasSitemap = false;
    let sitemapUrl: string | undefined = declaredSitemaps[0];

    try {
      const probeUrl = sitemapUrl || `${origin}/sitemap.xml`;
      const sitemapRes = await fetchFn(probeUrl);
      if (sitemapRes && sitemapRes.status() >= 200 && sitemapRes.status() < 300) {
        hasSitemap = true;
        sitemapUrl = probeUrl;
      } else if (!hasSitemap) {
```
`packages/checkers/src/refusal-rule.ts:40-46`
```ts
/** Local mirror of `TestCaseExpectations.refusal`. */
export interface RefusalExpectation {
  formPath: string;
  submitSelector?: string;
  message?: string;
  probeOnly?: boolean;
}
```
`packages/checkers/src/spec-conformance.ts`, the import from `./refusal-rule.js` (lines 5-9) includes
```ts
  type RefusalExpectation,
```
and `:148`
```ts
    const refusal = (testCase.expectations as { refusal?: RefusalExpectation }).refusal;
```

## Change
1. `site-root.ts`: change
```ts
      } else if (!hasSitemap) {
```
   to
```ts
      } else {
```
2. `refusal-rule.ts`: delete the `RefusalExpectation` interface and its one-line doc comment (the seven lines shown above).
3. `spec-conformance.ts`: remove `type RefusalExpectation,` from the import list, and change line 148 to:
```ts
    const refusal = testCase.expectations.refusal;
```
   `testCase.expectations` is a `TestCaseExpectations`, whose `refusal` field already has the shape `{ formPath: string; submitSelector?: string; message?: string; probeOnly?: boolean }`.

## Tests
No new test: behaviour is unchanged.
- `pnpm exec vitest run packages/checkers/tests/seo.test.ts packages/checkers/tests/spec-denial.test.ts packages/checkers/tests/spec-url-pattern.test.ts packages/checkers/tests/refusal-baseline-unit.test.ts`
- `pnpm exec vitest run --project browser packages/checkers/tests/refusal-rule.test.ts` (browser tier; Chromium: `pnpm --filter @qa/core exec playwright install chromium`)
- `pnpm build` and `pnpm typecheck`

## Done when
- [x] Grep for `RefusalExpectation` under `packages/` finds nothing.
- [x] The test runs, `pnpm build` and `pnpm typecheck` pass.

## Notes
- If the build reports that `testCase.expectations.refusal` does not exist on the type of `testCase` in `spec-conformance.ts`, the parameter there is typed with a narrower local type. In that case keep the cast but point it at the shared type: `(testCase.expectations as TestCaseExpectations).refusal`, importing `type TestCaseExpectations` from `@qa/types`.
- Before deleting, Grep `RefusalExpectation` across `packages/` once more; at the time of writing the only uses are the two files above.
