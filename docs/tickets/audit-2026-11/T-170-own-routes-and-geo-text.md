# T-170: the tool's own screen paths are hard-coded into the search checks, and the GEO text states the wrong limit

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | checkers | inconsistency | todo |

**Files you may edit (no others):**
- `packages/checkers/src/seo.ts`
- `packages/checkers/src/geo.ts`
- `packages/checkers/tests/seo.test.ts`

**Do not build in parallel with:** T-160, T-161 (same file `seo.ts`), T-159, T-169, T-178 (same test file).

## Problem
1. Two general checkers skip paths that are this tool's own wizard screens: `/settings`, `/check/scan`, `/check/testing`, `/reports/run-...`, `/baselines`. A customer's App that has a public `/settings` or `/baselines` page silently skips the "noindex" check and the GEO checks there. A checker must not know the tool's own routes.
2. The GEO low-text finding says pages should keep a text-to-HTML ratio "(> 8%)", but the check fires below 5%.

## Current code
`packages/checkers/src/seo.ts:266-268` (branch `worktree-audit-cleanup`)
```ts
      // 6. Meta Robots Noindex Warning (only on public routes, not intentionally private/app screens)
      const isPrivateOrAppRoute = /^\/(settings|check\/scan|check\/testing|reports\/run-)/i.test(context.urlPath);
      if (!isPrivateOrAppRoute && details.metaRobots && details.metaRobots.toLowerCase().includes('noindex')) {
```
`packages/checkers/src/geo.ts:31-36`
```ts
    const isSpecialPath =
      context.urlPath === '/login' ||
      context.urlPath.includes('/auth') ||
      context.urlPath.includes('/signup') ||
      context.urlPath.includes('/cart') ||
      /^\/(settings|reports\/run-|check\/scan|check\/testing|baselines)/i.test(context.urlPath);
```
`packages/checkers/src/geo.ts:63` and `:75`
```ts
      if (textRatio < 0.05 && details.wordCount < 100) {
```
```ts
              'Pages should maintain a healthy text-to-HTML ratio (> 8%) to ensure generative AI parsers can index meaningful content',
```

## Change
1. `seo.ts`: replace the three lines with:
```ts
      // 6. Meta Robots Noindex Warning
      if (details.metaRobots && details.metaRobots.toLowerCase().includes('noindex')) {
```
2. `geo.ts`: replace the `isSpecialPath` block with:
```ts
    const isSpecialPath =
      context.urlPath === '/login' ||
      context.urlPath.includes('/auth') ||
      context.urlPath.includes('/signup') ||
      context.urlPath.includes('/cart');
```
3. `geo.ts`: in the finding text change `(> 8%)` to `(> 5%)`. Do not change the `0.05` threshold.

## Tests
Edit `packages/checkers/tests/seo.test.ts`. Find the existing test that expects a noindex finding (search for `noindex`) and copy its mock details and context. Add:

1. A page at `/settings` with `metaRobots: 'noindex'` now gets the noindex finding: same details, `urlPath: '/settings'`. Expect a finding whose title contains `noindex`.
2. If the file has a GEO low-density test (search for `Low text-to-code ratio`), add an assertion that the finding's `expectedVsActual.expected` contains `> 5%`. If there is no such test, add one: `new GeoChecker().checkPage(...)` with mock details copied from an existing GEO test in the file, changed so that `totalHtmlLength: 10000`, `textLength: 100`, `wordCount: 20`, and expect the finding title to contain `Low text-to-code ratio` and `expected` to contain `> 5%`.

Run: `pnpm exec vitest run packages/checkers/tests/seo.test.ts`

## Done when
- [ ] No `check\/scan`, `reports\/run-` or `baselines` string remains in `packages/checkers/src/seo.ts` or `geo.ts`.
- [ ] New tests pass; existing tests pass unchanged.
- [ ] `pnpm build` passes.

## Notes
- Owner decision made here: the GEO text is aligned to the code (5%); the threshold does not change.
- Effect: when the tool is pointed at its own wizard, its private screens (which carry `noindex` on purpose) will now be reported. That is correct for a general checker; the person can mark the finding Intended.
