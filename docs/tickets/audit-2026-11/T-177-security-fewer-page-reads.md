# T-177: the security checkers read the same page data twice

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | speed | todo |

**Files you may edit (no others):**
- `packages/checkers/src/security.ts`
- `packages/checkers/src/security-depth.ts`

**Do not build in parallel with:** T-162, T-175 (same file `security.ts`), T-163 (same file `security-depth.ts`).

## Problem
Two repeated round trips to the browser on every page, at every screen size and Role:
1. `SecurityChecker.checkPage` reads the page's cookies for the cookie-flag check; `checkCsrf`, called a few lines later, reads them again.
2. `SecurityDepthChecker.checkSri` and `checkSourceMaps` each call `collectResources(page)`, the same page read, one after the other.

## Current code
`packages/checkers/src/security.ts`, in `checkPage` (branch `worktree-audit-cleanup`)
```ts
    // 4. Cookie flags (Secure, HttpOnly, SameSite)
    try {
      const cookies = await page
        .context()
        .cookies(page.url())
        .catch(() => []);
      for (const cookie of cookies) {
```
```ts
    // 4b. CSRF token on state-changing forms (heuristic, passive DOM read)
    findings.push(...(await this.checkCsrf(page, context)));
```
`packages/checkers/src/security.ts`, `checkCsrf`
```ts
  async checkCsrf(page: Page, context: SecurityContext & { urlPath: string }): Promise<Finding[]> {
```
```ts
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const cookies = await page
      .context()
      .cookies(page.url())
      .catch(() => []);
    if (cookies.some((c) => /^(?:lax|strict)$/i.test(c.sameSite ?? ''))) return [];
```
`packages/checkers/src/security-depth.ts`, in `checkPage`
```ts
    const steps: Array<() => Promise<Finding[]> | Finding[]> = [
      () => this.checkSri(page, context),
      () => this.checkCsp(context.cspHeader, context),
      () => this.checkTls(page.url(), context),
    ];
    if (onTarget && fetchFn) {
      steps.push(
        () => this.checkSourceMaps(page, context, fetchFn),
        () => this.checkSecurityTxt(fetchFn, context, pageOrigin)
      );
```
`packages/checkers/src/security-depth.ts`
```ts
  async checkSri(page: Page, context: SecurityDepthContext): Promise<Finding[]> {
    const pageOrigin = pageOriginOf(page);
    if (!pageOrigin) return [];
    const tags = await collectResources(page);
```
```ts
  async checkSourceMaps(page: Page, context: SecurityDepthContext, get: FetchFn): Promise<Finding[]> {
    const pageOrigin = pageOriginOf(page);
    if (!pageOrigin) return [];
    const tags = await collectResources(page);
```

## Change
### security.ts
1. In `checkPage`, directly above the comment `// 4. Cookie flags (Secure, HttpOnly, SameSite)`, add:
```ts
    // Read once here, used again by the CSRF check.
    let pageCookies: Array<{ sameSite?: string }> | undefined;
```
2. Inside the `try`, directly after the `const cookies = await page.context().cookies(page.url()).catch(() => []);` statement, add:
```ts
      pageCookies = cookies;
```
3. Change the CSRF call to:
```ts
    findings.push(...(await this.checkCsrf(page, context, pageCookies)));
```
4. Change `checkCsrf`:
```ts
  async checkCsrf(
    page: Page,
    context: SecurityContext & { urlPath: string },
    knownCookies?: Array<{ sameSite?: string }>
  ): Promise<Finding[]> {
```
   and replace its cookie read with:
```ts
    const cookies =
      knownCookies ??
      (await page
        .context()
        .cookies(page.url())
        .catch(() => []));
```

### security-depth.ts
5. Give both methods an optional last parameter and use it:
```ts
  async checkSri(page: Page, context: SecurityDepthContext, knownTags?: ResourceTag[]): Promise<Finding[]> {
    const pageOrigin = pageOriginOf(page);
    if (!pageOrigin) return [];
    const tags = knownTags ?? (await collectResources(page));
```
```ts
  async checkSourceMaps(
    page: Page,
    context: SecurityDepthContext,
    get: FetchFn,
    knownTags?: ResourceTag[]
  ): Promise<Finding[]> {
    const pageOrigin = pageOriginOf(page);
    if (!pageOrigin) return [];
    const tags = knownTags ?? (await collectResources(page));
```
6. In `checkPage`, directly above `const steps: ...`, add:
```ts
    // One read of the page's scripts and stylesheets, shared by the SRI and source-map checks.
    let tagsOnce: Promise<ResourceTag[]> | undefined;
    const tags = () => (tagsOnce ??= collectResources(page));
```
   and change the two steps:
```ts
      async () => this.checkSri(page, context, await tags()),
```
```ts
        async () => this.checkSourceMaps(page, context, fetchFn, await tags()),
```
   `ResourceTag` is the type `collectResources` already returns in this file; use that name as it is declared there.

## Tests
No new behaviour, so no new test. All existing tests must pass unchanged (they call `checkSri`, `checkSourceMaps` and `checkCsrf` without the new optional argument):
- `pnpm exec vitest run packages/checkers/tests/security-depth.test.ts`
- `pnpm exec vitest run --project browser packages/checkers/tests/security.test.ts` (browser tier; install Chromium with `pnpm --filter @qa/core exec playwright install chromium` if needed)
- `pnpm build`

## Done when
- [ ] `collectResources(` is called from exactly two places in `security-depth.ts` at run time for one `checkPage`: once through `tags()` (check by reading; the fallbacks inside `checkSri` and `checkSourceMaps` only run when a test calls them directly).
- [ ] Both test files pass unchanged; `pnpm build` passes.

## Notes
- If `collectResources` rejects, `await tags()` rejects inside each step, and the existing per-step `try/catch` in `checkPage` handles it as before.
- Not done on purpose: running the three `page.evaluate` reads of `security.ts` with `Promise.all`. The finding ids are numbered in order (`findings.length + 1`), so the order must stay fixed.
