# T-147: Response headers never reach technology detection

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core/audit | inconsistency | built |

**Files you may edit (no others):**
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/core/src/audit/pipeline/page-recorder.ts`
- `packages/core/tests/audit-pipeline.test.ts`

**Do not build in parallel with:** T-139, T-142, T-152, T-154 (all edit `crawl.ts`). **Depends on:** T-139 (it adds `RenderedPageContext`).

## Problem

`technology.ts` has 15 `header(...)` signatures (for example `x-shopid` for Shopify, `x-powered-by: Next.js`, `x-drupal-cache`). They match against `RawPage.responseHeaders`. `readPage(page, { responseHeaders })` accepts the headers, but the page recorder calls `readPage(page)` with no options, and nothing else supplies headers. In a real Website Audit every header signature is dead.

Scenario: a Shopify shop on its own domain with a custom theme (no `cdn.shopify.com` address in the first page's scripts) is not identified, although every response carries `x-shopid`.

## Current code

`packages/core/src/audit/pipeline/page-recorder.ts:97` (branch `worktree-audit-cleanup`)

```ts
    try {
      entry.read = await this.stages.readPage(page);
    } catch {
      entry.read = null;
    }
```

`readPage` signature (`packages/core/src/audit/analysis/read-page.ts`): `readPage(page: Page, options: ReadPageOptions = {})`, where `ReadPageOptions.responseHeaders?: Record<string, string>`. `readPage` already drops `set-cookie`, `cookie` and `authorization`.

`packages/core/src/audit/crawl/crawl.ts:364` (after the context is ready)

```ts
    // Added last, so it runs first: same-site requests carry the tunnel skip headers into the routes above.
    await addTunnelSkipHeaders(context, start);

    const spider = new DeterministicSpider([], request.limits.maxPages);
```

After T-139, `crawl.ts` has:

```ts
export interface RenderedPageContext {
  pacer: HostPacer;
}
```

and calls `opts.onRenderedPage(page, toAuditPage(item), { pacer })`.

## Change

1. `crawl.ts`, `RenderedPageContext`: add a field.

```ts
export interface RenderedPageContext {
  pacer: HostPacer;
  /** The headers of the page's own (main frame) response, when one was seen. For technology detection only. */
  responseHeaders?: Record<string, string>;
}
```

2. `crawl.ts`, right after `await addTunnelSkipHeaders(context, start);`, record the latest main-frame document response of each page:

```ts
    // The headers of each page's own response, for technology detection (never stored whole: readPage drops
    // cookies and authorization).
    const mainHeaders = new WeakMap<Page, Record<string, string>>();
    context.on('response', (response) => {
      try {
        const req = response.request();
        const frame = req.frame();
        if (!req.isNavigationRequest() || frame.parentFrame() !== null) return;
        mainHeaders.set(frame.page(), response.headers());
      } catch {
        // A response of a page that is already closed: nothing to record.
      }
    });
```

`Page` is already imported as a type in `crawl.ts` (it is used in `onRenderedPage`'s signature). `response.headers()` returns lower-case names.

3. `crawl.ts`, the `onRenderedPage` call inside `onRecordedPage`:

```ts
        if (opts.onRenderedPage) {
          const responseHeaders = mainHeaders.get(page);
          await opts.onRenderedPage(page, toAuditPage(item), {
            pacer,
            ...(responseHeaders ? { responseHeaders } : {}),
          });
        }
```

4. `page-recorder.ts`, the `readPage` call:

```ts
    try {
      entry.read = await this.stages.readPage(
        page,
        context?.responseHeaders ? { responseHeaders: context.responseHeaders } : {}
      );
    } catch {
      entry.read = null;
    }
```

(`context` is the third parameter of `onRenderedPage` added by T-139.)

## Tests

Edit `packages/core/tests/audit-pipeline.test.ts`. Copy the setup that builds the recorder with `createPageRecorder({ workDir, stages: pageStages() })` (about line 840).

Add `'the page response headers are passed to readPage'`: stub `stages.readPage` with a spy that returns the file's usual fake read result; call `recorder.onRenderedPage(page, info, { pacer: { run: (_h: string, t: () => unknown) => t() }, responseHeaders: { 'x-shopid': '1' } } as never)`; expect the spy's second argument to equal `{ responseHeaders: { 'x-shopid': '1' } }`.

Add `'without headers readPage gets empty options'`: call without the third argument; expect the spy's second argument to equal `{}`.

Run: `pnpm exec vitest run packages/core/tests/audit-pipeline.test.ts packages/core/tests/audit-technology.test.ts`, then `pnpm build`.

## Done when

- [x] `readPage` receives the main response headers of each recorded page.
- [x] Tests and `pnpm build` pass.

## Notes

- Do not pass headers to `analyseSite` separately: `detectTechnology` already merges every page's own `responseHeaders`.
- Headers are used for detection only. Do not add them to any stored result type.
- The crawl's fake contexts in other tests may not have an `on` method. If `pnpm exec vitest run packages/core/tests/audit-crawl-retry.test.ts` fails with "context.on is not a function", guard the registration with `if (typeof context.on === 'function')`.
