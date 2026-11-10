# T-114: Benchmark crawler uses the request guard and never leaks its browser

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | core | security | built |

**Files you may edit (no others):**
- `packages/core/src/competitive/safe-crawler.ts`
- `packages/core/tests/safe-crawler-guard.test.ts` (new)

**Do not build in parallel with:** T-134 (also edits `safe-crawler.ts`).

## Problem

`SafePublicCrawler` (the Competitive Benchmark crawl, reachable on a shared machine through the benchmark route)
launches its own Chromium and ignores the browser policy (ADR 0014):

1. No `--host-resolver-rules` pins, so the browser can resolve the host to a different (private) address than
   the one that was checked.
2. No request guard, so a sub-resource request to a private address goes through.
3. Its `page.route` ends in `route.continue()`, which skips every context-level route.
4. `newContext`, `addInitScript`, `newPage` and `page.route` run before the `try`, so a throw there leaves
   Chromium running.

## Current code

`packages/core/src/competitive/safe-crawler.ts:172-181` (branch `worktree-audit-cleanup`)

```ts
    const browser = await chromium.launch({
      headless: options.headless !== false,
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ${USER_AGENT_TOKEN}/1.0`,
    });
    await context.addInitScript(BLOCK_FORM_SUBMISSION_SCRIPT);
```

`safe-crawler.ts:186` and the end of the same handler (about line 222):

```ts
    await page.route('**/*', (route) => {
      ...
      return route.continue();
    });
```

The crawl loop starts with `try {` at about line 314 and ends with:

```ts
    } finally {
      await browser.close();
    }
```

## Change

1. Add to the imports at the top:

```ts
import { getBrowserPolicy, installRequestGuard } from '../browser.js';
```

2. Replace the `chromium.launch` call with:

```ts
    // The shared machine's policy (ADR 0014): the host stays pinned to the address that was checked.
    const policy = getBrowserPolicy();
    const pinned = Object.entries(policy?.pinned ?? {}).map(
      ([host, ip]) => `MAP ${host} ${ip.includes(':') ? `[${ip.replace(/^\[|\]$/g, '')}]` : ip}`
    );
    const browser = await chromium.launch({
      headless: options.headless !== false,
      args: pinned.length ? [`--host-resolver-rules=${pinned.join(', ')}`] : [],
    });
```

3. Directly after `const context = await browser.newContext({...});` add:

```ts
    if (policy?.guard) await installRequestGuard(context, policy.guard);
```

4. In the `page.route('**/*', ...)` handler, change the last line `return route.continue();` to
   `return route.fallback();`. (A page route runs before context routes; `fallback` hands the request on to the guard.)

5. Move the browser clean-up so it covers the set-up too: put `try {` on the line right after the
   `chromium.launch(...)` statement, delete the later `try {` that opens the crawl loop, and keep the existing
   `} finally { await browser.close(); }` as the closing of the new, wider `try`. Change the `finally` body to
   `await browser.close().catch(() => {});`. Everything declared between the old and new `try` positions must
   stay in scope for the `return` at the end of the method: if the `return` sits after the `finally`, move it
   inside the `try`.

## Tests

Add `packages/core/tests/safe-crawler-guard.test.ts` (unit, no Chromium). Mock Playwright:

```ts
const launch = vi.fn();
vi.mock('playwright', () => ({ chromium: { launch: (...a: unknown[]) => launch(...a) } }));
```

- Case 1 "passes the pinned address to Chromium": call `setBrowserPolicy({ pinned: { 'example.com': '93.184.216.34' } })`
  (import from `../src/browser.js`), make `launch` resolve to a fake browser whose `newContext` rejects with
  `new Error('stop')` and whose `close` is a `vi.fn()` resolving. Run
  `new SafePublicCrawler().crawl('https://example.com/', <evidence dir>, { respectRobots: false })` inside
  `expect(...).rejects.toThrow('stop')`. Expect `launch.mock.calls[0][0].args` to equal
  `['--host-resolver-rules=MAP example.com 93.184.216.34']` and `close` to have been called once.
- Case 2 "no policy, no pin": `setBrowserPolicy(null)`; expect `args` to equal `[]`.
- Reset with `setBrowserPolicy(null)` in `afterEach`.

Read the public method name and its parameters at `safe-crawler.ts` (search `class SafePublicCrawler`) and use
them as they are; the example above assumes `crawl(entryUrl, evidenceDir, options)`.

Command: `pnpm exec vitest run packages/core/tests/safe-crawler-guard.test.ts packages/core/tests/competitive-benchmarking.test.ts`, then `pnpm build`.

## Done when

- [x] `route.continue()` no longer appears in `safe-crawler.ts`
- [x] `installRequestGuard` is called when the policy has a guard
- [x] A throw in `newContext` closes the browser (test case 1)
- [x] Both test files pass; `pnpm build` passes

## Notes

- Do not touch `isPrivateHost` or `MUTATING_METHODS` here; T-134 handles those duplicates.
- `--no-sandbox` and the other Chromium flags used by `BrowserManager` are out of scope.
