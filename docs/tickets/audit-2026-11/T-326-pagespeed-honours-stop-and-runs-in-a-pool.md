# T-326: PageSpeed and site analysis honour Stop, and PageSpeed runs a small pool with a page cap

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | speed | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/ai/pagespeed.ts`
- `packages/core/src/safe-net.ts`
- `packages/core/src/audit/analysis/analyse-site.ts`
- `packages/core/src/audit/analysis/broken-links.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `docs/adr/0035-pagespeed-data.md`
- `packages/core/tests/audit-pagespeed.test.ts`
- `packages/core/tests/audit-broken-links.test.ts`
- `packages/core/tests/audit-pipeline.test.ts`

**Do not build in parallel with:** T-320 (edits `safe-net.ts`); T-295, T-321, T-322, T-328 (all edit `pipeline.ts`, `audit-pipeline.test.ts`).

## Problem

When the tool user presses Stop during a Website Audit, the pipeline checks the signal only between stages (`stopIfAborted(signal)` in `packages/core/src/audit/pipeline/pipeline.ts`). Two stages run long without looking at it:

- **Speed.** `measureSampleSpeeds` asks PageSpeed Insights for one Sample Page at a time (`packages/core/src/audit/ai/pagespeed.ts:336-350`), each request allowed up to 90 seconds (`PSI_TIMEOUT_MS`, `pagespeed.ts:21`). `PageSpeedDeps` has no signal (`pagespeed.ts:25-38`) and the pipeline passes none (`pipeline.ts:517`). Every page with a fixed address is a Sample Page, plus the first three of each Layout Group (`page-recorder.ts`), so a 200-page audit can have 100 of them: at worst more than two hours of PSI calls, and Stop is seen only after the last one. The run slot stays held all that time.
- **Analysis.** `analyseSite` takes no signal (`packages/core/src/audit/analysis/analyse-site.ts:46-73`, called at `pipeline.ts:432-457`), and its broken-link check sends up to 100 requests one after another (`broken-links.ts:185-198`, `ANALYSIS_MAX_LINK_REQUESTS`).

`makeOutboundFetch` cannot cancel a request either: `safeGet` accepts a `signal` (`packages/core/src/safe-net.ts:222-223`), but `OutboundFetchOptions` (`safe-net.ts:319-335`) has no field for it.

## Current code

Branch from `main`.

`packages/core/src/audit/ai/pagespeed.ts` (`grep -n "for (const url of pages)" -B2 -A13 packages/core/src/audit/ai/pagespeed.ts`):

```ts
  const out: SampleSpeed[] = [];
  let quotaHit = false;
  for (const url of pages) {
    if (quotaHit) {
      out.push({ url, speed: notMeasured('quota'), notMeasuredReason: 'quota' });
      continue;
    }
    const speed = await measureWithKey(url, apiKey, deps);
    quotaHit = wasQuota(speed);
    out.push({
      url,
      speed,
      ...(speed.notMeasuredReason ? { notMeasuredReason: speed.notMeasuredReason } : {}),
    });
  }
  return out;
```

and in `measureWithKey`:

```ts
  const fetchFn = makeOutboundFetch({
    allowPrivate: false,
    maxRedirects: 0,
    maxBytes: PSI_MAX_BYTES,
    timeoutMs: deps.timeoutMs ?? PSI_TIMEOUT_MS,
    headers: { accept: 'application/json', ...(apiKey ? { 'x-goog-api-key': apiKey } : {}) },
    deps: net,
  });
```

`packages/core/src/audit/pipeline/pipeline.ts` (`grep -n "stages.measureSampleSpeeds(urls" packages/core/src/audit/pipeline/pipeline.ts`):

```ts
    const speeds = urls.length > 0 ? await stages.measureSampleSpeeds(urls, deps.pageSpeed) : [];
```

`packages/core/src/safe-net.ts`, `makeOutboundFetch` calls `safeGet(url, { maxRedirects, maxBytes, timeoutMs, headers, allowPrivate, redirectAsResponse: true }, deps)`, inside a `try` that answers null on any error.

`packages/core/src/audit/analysis/broken-links.ts` (`grep -n "const response = await opts.fetch" -B6 packages/core/src/audit/analysis/broken-links.ts`):

```ts
    if (status === undefined) {
      if (requests >= maxRequests) continue;
      const url = targetUrl(site, target.to);
      if (!url) continue;
      requests++;
      // One at a time: the next request starts only after this one has settled.
      const response = await opts.fetch(url).catch(() => null);
```

`packages/core/src/abort.ts` has `abortError()`, `isAbortError()` and `stopIfAborted(signal)`. `docs/adr/0035-pagespeed-data.md` says "Requests go one at a time."

## Change

1. `safe-net.ts`: add `signal?: AbortSignal;` to `OutboundFetchOptions` ("Aborting cancels a request in flight; the fetch then answers null like any failed request.") and pass `signal: opts.signal` in the `safeGet` options inside `makeOutboundFetch`. Nothing else changes.

2. `pagespeed.ts`:
   - `PageSpeedDeps` gains `signal?: AbortSignal` ("Stop: no new request starts and the one in flight is cancelled; `measureSampleSpeeds` then throws AbortError."), `inFlight?: number` and `maxPages?: number`.
   - Add `export const PSI_IN_FLIGHT = 4;` and `export const PSI_MAX_PAGES = 20;` with comments ("PSI requests at once" and "Sample Pages measured by PSI per audit; the others use this tool's own timing (ADR 0042)").
   - `measureWithKey` passes `signal: deps.signal` to `makeOutboundFetch`.
   - Rewrite the loop in `measureSampleSpeeds` as a pool that keeps the page order:
     - `stopIfAborted(deps.signal)` before the key lookup.
     - `const out = new Array<SampleSpeed>(pages.length)`; pages at index `>= (deps.maxPages ?? PSI_MAX_PAGES)` get `{ url, speed: notMeasured('failed') }` with no request and no `notMeasuredReason`.
     - `Math.min(deps.inFlight ?? PSI_IN_FLIGHT, measured.length)` workers take the next index. Before each request a worker calls `stopIfAborted(deps.signal)`; once `quotaHit` is set, the remaining pages get the `quota` entry without a request (requests already sent finish). After each `measureWithKey`, `stopIfAborted(deps.signal)` again, so a cancelled request ends the call with AbortError instead of a 'failed' page.
   - Update the module comment ("asks for up to PSI_IN_FLIGHT pages at once, the first PSI_MAX_PAGES Sample Pages only") and the `measureSampleSpeeds` doc comment.

3. `broken-links.ts`: `CheckLinksOptions` gains `signal?: AbortSignal`; in the request loop call `stopIfAborted(opts.signal)` (import from `../../abort.js`) right before `requests++`. A request in flight finishes (the checker fetch times out after 3 s).

4. `analyse-site.ts`: `AnalysisInput` gains `signal?: AbortSignal` ("Stop: the link check ends before its next request."), passed as `...(input.signal ? { signal: input.signal } : {})` into the `checkLinks` options.

5. `pipeline.ts`: pass the run's signal to both stages: `signal` in the `stages.analyseSite({...})` input, and `stages.measureSampleSpeeds(urls, { ...deps.pageSpeed, signal })`. Both calls are already inside a `try` whose `catch` calls `rethrowIfStopped(err, signal)`, so an AbortError ends the pipeline as a stop.

6. `docs/adr/0035-pagespeed-data.md`: in the Status line add "Amended by T-326 (up to 4 requests at once, the first 20 Sample Pages only)". Replace "Requests go one at a time. A failed page does not stop the others." with "Up to 4 requests go at once, for the first 20 Sample Pages; the other Sample Pages use this tool's own timing (ADR 0042). A failed page does not stop the others. Stop cancels the requests in flight." and add to the quota sentence "(requests already sent still finish)".

7. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

`packages/core/tests/audit-pagespeed.test.ts`, in `describe('measureSampleSpeeds')`:

- `'asks one page at a time, in order...'`: pass `inFlight: 1` in its deps; it keeps its assertions. Rename to `'with inFlight 1 asks one page at a time, in order, resolving the key once'`.
- `'after a quota answer no further request is made...'`: pass `inFlight: 1` (its `connects` count of 2 depends on order).
- `'a failed page does not stop the rest'`: pass `inFlight: 1` too. The fake hands out answers in connect order, so any existing test whose answers are per page needs one request at a time.
- New `'asks up to PSI_IN_FLIGHT pages at once and keeps the page order'`: 8 pages, a `connect` that waits 5 ms and tracks the highest number in flight; it is `PSI_IN_FLIGHT`, and `out.map((o) => o.url)` equals the input order.
- New `'measures the first PSI_MAX_PAGES pages only'`: 25 pages with `maxPages: 3, inFlight: 1`; 3 connects; `out` has 25 entries; entries 3 to 24 are not measured and have no `notMeasuredReason`.
- New `'Stop cancels the request in flight and throws AbortError'`: a `connect` that never answers until its request's signal aborts (reject with an Error named `AbortError` on abort); call with an `AbortController` signal, abort after the first connect; the promise rejects with `isAbortError(err)` true and no second connect is made.
- New `'an aborted signal makes no request'`: an already aborted signal rejects at once with no key lookup.

`packages/core/tests/audit-broken-links.test.ts`: `'Stop ends the link check before the next request'`: a fake fetch that aborts the controller during its second call; `checkLinks(..., options({ fetch, maxRequests: 10, signal }))` rejects with AbortError and `f.calls` has length 2.

`packages/core/tests/audit-pipeline.test.ts`:

- `'passes the run signal to PageSpeed and the analysis'`: run with a controller signal; `vi.mocked(stages.measureSampleSpeeds!).mock.calls[0][1]?.signal` is that signal, and the `analyseSite` input has `signal` set.
- `'a Stop during PageSpeed ends the run as stopped, nothing saved'`: a `measureSampleSpeeds` fake that aborts the controller and throws `abortError()`; the outcome rejects with an AbortError and `saveResult` is not called (copy the shape of `'stops at once on abort: nothing is saved'`).

Run: `pnpm exec vitest run packages/core/tests/audit-pagespeed.test.ts packages/core/tests/audit-broken-links.test.ts packages/core/tests/audit-pipeline.test.ts packages/core/tests/audit-analyse-site.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "signal" packages/core/src/audit/ai/pagespeed.ts` finds the deps field, the outbound fetch option and the stop checks.
- [ ] `grep -n "PSI_IN_FLIGHT\|PSI_MAX_PAGES" packages/core/src/audit/ai/pagespeed.ts` finds both constants and their use.
- [ ] `grep -n "measureSampleSpeeds(urls, { ...deps.pageSpeed, signal })" packages/core/src/audit/pipeline/pipeline.ts` finds the call.
- [ ] ADR 0035 no longer says "Requests go one at a time".
- [ ] The tests above pass, the core unit tests pass, and `pnpm build` passes.

## Notes

- Audit finding M31, PageSpeed and analysis part (audit of 11 Nov 2026 on `d225418`). The docs fetch and narrow-screen part is T-332.
- Pages past `PSI_MAX_PAGES` already have a fallback: the pipeline uses the lab timing this tool measured during the crawl when PSI did not measure a page (`pipeline.ts`, the speed step; ADR 0042). So the cap costs no page its speed figure when the crawl timing worked.
- Four at once stays well inside Google's per-minute PSI limit for a keyed request; a keyless audit can hit `quota` sooner, which the existing quota rule handles.
- Other files: T-320 edits `safe-net.ts` (the `allowPrivate` rule, a different function); T-321, T-322 and T-295 edit `pipeline.ts`.
