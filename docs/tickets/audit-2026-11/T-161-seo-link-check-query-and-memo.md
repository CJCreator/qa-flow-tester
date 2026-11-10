# T-161: SEO link check drops the query string and asks for the same links on every page

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | built |

**Files you may edit (no others):**
- `packages/checkers/src/seo.ts`
- `packages/checkers/tests/seo.test.ts`

**Do not build in parallel with:** T-160, T-170 (same source file), T-159, T-169, T-178 (same test file).

## Problem
Two faults in the broken-link part of `SeoChecker`:
1. Links are reduced to their path. `/product?id=4` is requested as `/product`; if that answers 404 the link is reported broken although the real link works.
2. Only the first 5 links of a page are checked, and they are usually the shared header menu. The same 5 are requested again on every page of the Check-up, so links further down are never reached and the site gets repeated requests.

## Current code
`packages/checkers/src/seo.ts:524-529`, inside `collectDetails` (runs in the page) (branch `worktree-audit-cleanup`)
```ts
          try {
            const urlObj = new URL(href, window.location.href);
            if (urlObj.origin === currentOrigin && !seen.has(urlObj.pathname)) {
              seen.add(urlObj.pathname);
              sameSiteLinks.push(urlObj.pathname);
            }
          } catch {
```
`packages/checkers/src/seo.ts:550`
```ts
          sameSiteLinks: sameSiteLinks.slice(0, 10), // Limit to 10 links to avoid flooding
```
`packages/checkers/src/seo.ts:585-606`, `checkBrokenLinks`
```ts
  /** One GET per link (no HEAD first), up to 5 links, only through `fetchFn`. */
  private async checkBrokenLinks(paths: string[], context: SeoContext, fetchFn?: FetchFn): Promise<Finding[]> {
    const findings: Finding[] = [];
    const toCheck = paths.slice(0, 5);
    if (!fetchFn) {
```
```ts
    for (const linkPath of toCheck) {
      try {
        const fullUrl = context.baseUrl ? new URL(linkPath, context.baseUrl).href : linkPath;
        const res = await fetchFn(fullUrl);
```

## Change
1. Keep the query string. In `collectDetails` replace the `try` body shown above with:
```ts
          try {
            const urlObj = new URL(href, window.location.href);
            const target = urlObj.pathname + urlObj.search;
            if (urlObj.origin === currentOrigin && !seen.has(target)) {
              seen.add(target);
              sameSiteLinks.push(target);
            }
          } catch {
```
2. Send more candidates out of the page, so links past the header can be reached. Change line 550 to:
```ts
          sameSiteLinks: sameSiteLinks.slice(0, 30), // Candidates only: at most 5 are requested per page
```
3. Skip links already requested in this Check-up. In `checkBrokenLinks` replace
```ts
    const toCheck = paths.slice(0, 5);
```
with
```ts
    // A link already requested this run (the shared menu, on every page) is not asked for again.
    const asked = (p: string) => context.siteWide?.has(`link:${p}`) === true;
    const toCheck = paths.filter((p) => !asked(p)).slice(0, 5);
```
4. Remember each link once it has been requested. In the `for (const linkPath of toCheck)` loop, add one line straight after `const res = await fetchFn(fullUrl);`:
```ts
        context.siteWide?.add(`link:${linkPath}`);
```
5. Update the doc comment above `checkBrokenLinks` to:
```ts
  /** One GET per link (no HEAD first), up to 5 links a page that this run has not asked for yet, only through `fetchFn`. */
```

## Tests
Edit `packages/checkers/tests/seo.test.ts`. Copy the set-up of the existing link test that ends with
`expect(findings.map((f) => f.title)).toEqual(['Broken link found: /c returned HTTP 410']);` (it uses `createMockPage(linkPageDetails([...]))`, `recordingFetch` and a context with `baseUrl: 'http://localhost:3050'`, `searchChecks: false` and all four `visibility` flags false). Add:

1. A link is requested once per run:
   one `siteWide = new Set<string>()` shared by two `checkPage` calls. First call: `linkPageDetails(['/a', '/b'])`, `urlPath: '/'`. Second call: `linkPageDetails(['/a', '/b', '/c'])`, `urlPath: '/next'`. Same `recordingFetch()` for both.
   Expect `calls` to equal `['http://localhost:3050/a', 'http://localhost:3050/b', 'http://localhost:3050/c']`.
2. With no `siteWide`, behaviour is unchanged: the existing five-link test must pass without edits.
3. A link with a query string is requested with it:
   `linkPageDetails(['/product?id=4'])`.
   Expect `calls` to equal `['http://localhost:3050/product?id=4']`.

The in-page part of step 1 (the `collectDetails` evaluate) is replaced by the mock page in unit tests, so it has no unit test; check it by reading.

Run: `pnpm exec vitest run packages/checkers/tests/seo.test.ts`

## Done when
- [x] New tests pass; existing tests in `seo.test.ts` pass unchanged.
- [x] `pnpm build` passes.

## Notes
- A broken link is still reported once; the report already records the other pages a problem was seen on.
- Do not raise the 5-per-page cap. It limits requests to a site the tool does not own.
- When `fetchFn` is absent the method returns the "Links were not checked" finding as before; do not add to `siteWide` in that branch.
