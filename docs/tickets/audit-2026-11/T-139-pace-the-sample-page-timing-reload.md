# T-139: The Sample Page timing reload runs outside the crawl's pacing

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core/audit | bug | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/core/src/audit/pipeline/page-recorder.ts`
- `packages/core/tests/audit-pipeline.test.ts`

**Do not build in parallel with:** T-142, T-147, T-152, T-154 (all edit `crawl.ts`).

## Problem

For every Sample Page, `AuditPageRecorder.onRenderedPage` calls `measureBrowserTiming(page)`, which does a full `page.reload()` (cache off, throttled, up to 30 s). That reload is a second request to the audited site and it does not go through the crawl's `HostPacer`. So it ignores the robots.txt Crawl-delay, the 500 ms gap between requests and the "one at a time after a 429/503" rule (ADR 0043).

Scenario: a site sets `Crawl-delay: 5`. The crawl waits 5 s between page loads, but each Sample Page is reloaded immediately after its first load.

## Current code

`packages/core/src/audit/crawl/crawl.ts:198` (branch `worktree-audit-cleanup`)

```ts
  /** Awaited for each recorded page while it is still rendered (Page Content extraction, REQ-005). */
  onRenderedPage?: (page: Page, info: AuditCrawlPage) => Promise<void>;
```

`packages/core/src/audit/crawl/crawl.ts:443` (inside `onRecordedPage`)

```ts
        if (opts.onRenderedPage) await opts.onRenderedPage(page, toAuditPage(item));
```

`packages/core/src/audit/pipeline/page-recorder.ts:76`

```ts
  readonly onRenderedPage = async (page: Page, info: AuditCrawlPage): Promise<void> => {
```

`packages/core/src/audit/pipeline/page-recorder.ts:114`

```ts
    try {
      entry.timing = await this.stages.measureBrowserTiming(page);
    } catch {
      entry.timing = null;
    }
```

`HostPacer.run(host, task, signal?)` (`packages/core/src/host-pacer.ts`) runs `task` in the host's turn. A call made while that host's turn is already held runs at once, so nesting is safe.

## Change

1. `crawl.ts`: export a context type next to the options interface and widen the callback:

```ts
/** What the crawl hands to `onRenderedPage` besides the page: its pacer, so extra requests take turns too. */
export interface RenderedPageContext {
  pacer: HostPacer;
}
```

```ts
  /** Awaited for each recorded page while it is still rendered (Page Content extraction, REQ-005). */
  onRenderedPage?: (page: Page, info: AuditCrawlPage, context: RenderedPageContext) => Promise<void>;
```

2. `crawl.ts`, the call inside `onRecordedPage`:

```ts
        if (opts.onRenderedPage) await opts.onRenderedPage(page, toAuditPage(item), { pacer });
```

(`pacer` is the `const pacer = new HostPacer({...})` already defined earlier in the same function.)

3. `page-recorder.ts`: import the type and accept the third argument (optional, so existing callers and tests keep working):

```ts
import type { AuditCrawlPage, RenderedPageContext } from '../crawl/crawl.js';
```

(Keep the file's existing import of `AuditCrawlPage`; only add `RenderedPageContext` to it. If the file imports from a different path such as `'../crawl/index.js'`, add the type there and export `RenderedPageContext` from that index file too.)

```ts
  readonly onRenderedPage = async (page: Page, info: AuditCrawlPage, context?: RenderedPageContext): Promise<void> => {
```

4. `page-recorder.ts`, the timing block:

```ts
    try {
      // The timing reloads the page: a second request to the site, so it takes the crawl's turn (ADR 0043).
      const measure = () => this.stages.measureBrowserTiming(page);
      const host = context?.pacer ? new URL(page.url()).host : null;
      entry.timing = context?.pacer && host ? await context.pacer.run(host, measure) : await measure();
    } catch {
      entry.timing = null;
    }
```

## Tests

Use `packages/core/tests/audit-pipeline.test.ts`. It builds the recorder with `createPageRecorder({ workDir, stages: pageStages() })` (about line 840) and feeds it pages; copy that setup, including its fake `page` and its `pageStages()` helper, and call `recorder.onRenderedPage(page, info)` the way the file already does.

Add `'the timing reload runs in the pacer turn of the page host'`:

- fake `page` with `url: () => 'https://example.com/a'`;
- `stages.measureBrowserTiming` as a spy returning a measured result;
- a fake pacer `{ run: vi.fn((host, task) => task()) }` passed as `{ pacer }` (cast `as never`);
- call `recorder.onRenderedPage(page, info, { pacer })`;
- expect `pacer.run` to have been called once with `'example.com'` as first argument, and the timing spy once.

Add `'without a context the timing still runs'`: same without the third argument; expect the timing spy called once.

Run: `pnpm exec vitest run <that test file>`, then `pnpm build` (the runner passes `recorder.onRenderedPage` to the crawl, so the types must still line up).

## Done when

- [ ] `measureBrowserTiming` is called inside `pacer.run` when the crawl passes its pacer.
- [ ] Both new tests pass; `pnpm build` passes.

## Notes

- Decision made: timing is still measured even when a PageSpeed key is saved, because ADR 0042 uses this tool's own timing as the fallback when PageSpeed Insights cannot answer.
- T-147 adds a second field (`responseHeaders`) to `RenderedPageContext`. Build T-139 first.
