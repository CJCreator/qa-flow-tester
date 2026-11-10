# T-167: accessibility scan results are reused across Roles on the same address

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | todo |

**Files you may edit (no others):**
- `packages/checkers/src/ux-quality.ts`
- `packages/checkers/tests/ux-axe-cache.test.ts`

**Do not build in parallel with:** T-164, T-165 (same source file).

## Problem
One axe scan cache is shared by every Role and Test of a Check-up. Its key is the page address plus the viewport. A signed-in Role that sees a different page at the same address (for example `/dashboard` as admin and as member) gets the first Role's scan results, so what the second Role sees is never scanned.

## Current code
`packages/checkers/src/ux-quality.ts:124-147` (branch `worktree-audit-cleanup`)
```ts
/**
 * Per-run cache of axe results (PERF-2). Key: page URL and viewport (`axeCacheKey`). Share one Map across the
 * checks of one run; the checker deletes an entry whose scan failed so the next check runs it again.
 */
export type AxeCache = Map<string, Promise<AxeScan>>;

export function axeCacheKey(page: Page): string {
  const vp = page.viewportSize();
  return `${page.url()}|${vp ? `${vp.width}x${vp.height}` : 'no-viewport'}`;
}

export class UXQualityChecker {
  private async axeScan(page: Page, cache?: AxeCache): Promise<AxeScan> {
    const scan = async (): Promise<AxeScan> => {
      const axeResults = await new (AxeBuilder as any)({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      return axeResults as AxeScan;
    };
    if (!cache) return scan();
    const key = axeCacheKey(page);
```
`packages/checkers/src/ux-quality.ts:177`
```ts
        const axeResults = await this.axeScan(page, context.axeCache);
```

## Change
1. Replace the doc comment and `axeCacheKey` with:
```ts
/**
 * Per-run cache of axe results (PERF-2). Key: page URL, viewport and Role (`axeCacheKey`): two Roles can
 * see different pages at one address. Share one Map across the checks of one run; the checker deletes an
 * entry whose scan failed so the next check runs it again.
 */
export type AxeCache = Map<string, Promise<AxeScan>>;

export function axeCacheKey(page: Page, role = ''): string {
  const vp = page.viewportSize();
  return `${page.url()}|${vp ? `${vp.width}x${vp.height}` : 'no-viewport'}|${role}`;
}
```
2. Give `axeScan` the Role. Change its signature and the key line:
```ts
  private async axeScan(page: Page, cache?: AxeCache, role = ''): Promise<AxeScan> {
```
```ts
    const key = axeCacheKey(page, role);
```
3. Pass the Role at the call site (line 177):
```ts
        const axeResults = await this.axeScan(page, context.axeCache, context.role);
```

## Tests
Edit `packages/checkers/tests/ux-axe-cache.test.ts`. It already has `fakePage(url, viewport)`, a shared `ctx = { role: 'visitor', breakpoint: '1440px', urlPath: '/' }` and a counter `axe.calls`. Add one test after `runs axe once for the same URL and viewport, twice when the viewport differs`:
```ts
  it('runs axe again for another Role on the same URL and viewport', async () => {
    const cache: AxeCache = new Map();
    const p = fakePage('https://site.test/a', { width: 1440, height: 900 });
    await checker.check(p, { ...ctx, role: 'admin', axeCache: cache }).catch(() => undefined);
    await checker.check(p, { ...ctx, role: 'admin', axeCache: cache }).catch(() => undefined);
    expect(axe.calls).toBe(1);
    await checker.check(p, { ...ctx, role: 'member', axeCache: cache }).catch(() => undefined);
    expect(axe.calls).toBe(2);
  });
```
The existing tests keep one Role, so they pass unchanged (the test `does not cache a failed scan` expects `cache.size` 1; that still holds).

Run: `pnpm exec vitest run packages/checkers/tests/ux-axe-cache.test.ts`

## Done when
- [ ] The new test passes; existing tests in the file pass unchanged.
- [ ] `pnpm build` passes (core imports only the `AxeCache` type, so no core change is needed).

## Notes
- Out of scope: a page state left by a Test's steps on the same address and Role (an open dialog). That needs the Test id in the key and would remove most of the cache's benefit; it is not part of this ticket.
