# T-160: SEO link and site-file requests go to the typed address, not the address the page loaded from

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | todo |

**Files you may edit (no others):**
- `packages/checkers/src/seo.ts`
- `packages/checkers/tests/seo.test.ts`

**Do not build in parallel with:** T-161, T-170 (same source file), T-159, T-169, T-178 (same test file).

## Problem
`SeoChecker` builds every link address and the robots.txt / sitemap.xml / llms.txt addresses from `context.baseUrl`, which is the address the person typed. The checker's fetch follows no redirects. When the site redirects (apex to `www`, or `http` to `https`), every request answers 301:
- robots.txt, sitemap.xml and llms.txt are each reported as missing (three false findings);
- a broken link answers 301, so it is never reported.

Scenario: App address `https://example.com`, the site serves from `https://www.example.com`. The page loaded is `https://www.example.com/`, but the checker asks `https://example.com/robots.txt` and gets 301.

## Current code
`packages/checkers/src/seo.ts:61-64` (branch `worktree-audit-cleanup`)
```ts
  async checkPage(page: Page, context: SeoContext, fetchFn?: FetchFn): Promise<Finding[]> {
    const findings: Finding[] = [];
    const details = await this.collectDetails(page);
    if (!details) return [couldNotVerifyFinding('seo', 'search basics', context)];
```
The two places that read `context.baseUrl` for requests, same file:
```ts
              baseUrl: context.baseUrl,        // passed to this.siteRootAuditor.audit(...)
```
```ts
        const fullUrl = context.baseUrl ? new URL(linkPath, context.baseUrl).href : linkPath;   // in checkBrokenLinks
```

## Change
1. In `packages/checkers/src/seo.ts`, add this function above `export class SeoChecker` (module level):
```ts
/**
 * The address requests are built from: the page as it loaded (after any redirect), else the address
 * the Check-up was given. The checker's fetch follows no redirects, so the typed address can answer 301.
 */
function requestBaseOf(page: Page, context: SeoContext): string | undefined {
  try {
    const loaded = typeof page.url === 'function' ? page.url() : '';
    if (/^https?:\/\//i.test(loaded)) return loaded;
  } catch {
    // A page that cannot say its address: use the given one.
  }
  return context.baseUrl;
}
```
2. Make `checkPage` use it. Replace the first line of the body so the rest of the method reads the corrected value through `context`:
```ts
  async checkPage(page: Page, givenContext: SeoContext, fetchFn?: FetchFn): Promise<Finding[]> {
    const context: SeoContext = { ...givenContext, baseUrl: requestBaseOf(page, givenContext) };
    const findings: Finding[] = [];
```
   Leave every other line of `checkPage` and `checkBrokenLinks` as it is. They already read `context.baseUrl`, which now holds the loaded address. `siteWide` and `marketingLog` are the same objects (shallow copy), so their state is still shared.

## Tests
Edit `packages/checkers/tests/seo.test.ts`. The file's `createMockPage(details)` returns a page with no `url`; add a second helper next to it:
```ts
  function createMockPageAt(url: string, details: any): Page {
    return { ...(createMockPage(details) as any), url: () => url } as unknown as Page;
  }
```
Add two tests next to `AC-5: site files go through the same FetchFn at the site root` (copy its set-up; it uses `recordingFetch` and `linkPageDetails`):

1. Site files follow the loaded address:
   page `createMockPageAt('https://www.example.com/', linkPageDetails([]))`, context `{ testCaseId: 'TC-WWW', role: 'visitor', breakpoint: '1440px', urlPath: '/', baseUrl: 'https://example.com' }`, fetch `recordingFetch(() => 404)`.
   Expect `calls` to contain `'https://www.example.com/robots.txt'` and every call's origin to be `'https://www.example.com'`.
2. Links follow the loaded address:
   page `createMockPageAt('https://www.example.com/', linkPageDetails(['/a']))`, context as above plus `searchChecks: false` and `visibility: { search: false, answers: false, aiSearch: false, marketing: false }`, fetch `recordingFetch()`.
   Expect `calls` to equal `['https://www.example.com/a']`.

The existing tests use a page with no `url`, so they keep using `baseUrl` and must still pass unchanged.

Run: `pnpm exec vitest run packages/checkers/tests/seo.test.ts`

## Done when
- [ ] Both new tests pass; all existing tests in `seo.test.ts` pass unchanged.
- [ ] `pnpm build` passes.

## Notes
- Do not make the fetch follow redirects: ADR 0031 forbids it (a redirect could leave the site).
- `requestBaseOf` returns the full page address; `new URL(linkPath, base)` and `new URL(base).origin` both work with it.
- Out of scope: `packages/checkers/src/site-root.ts` (it already takes the origin of the `baseUrl` it is given).
