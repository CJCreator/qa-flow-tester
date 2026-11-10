# T-123: A stopped scan lists no false "did not load" pages and stops waiting at its deadline

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/discovery/deterministic-spider.ts`

**Do not build in parallel with:** T-121, T-122, T-135 (all edit `deterministic-spider.ts`).

## Problem

Three places in the Spider ignore a Stop or the crawl deadline:

1. **False Skipped Pages.** When the person stops the scan, every page a worker was about to open throws and is
   recorded as a Skipped Page with the reason `did-not-load`. Those pages were never requested; the site did
   nothing wrong.
2. **Sitemap seeding after a Stop.** Seeding checks `timeLeft() > 0` but not the abort signal, so a scan stopped
   during start-up still fetches robots.txt and sitemaps.
3. **Outage pause past the deadline.** When the site stops answering, the Spider waits up to 60 s in 10 s
   steps, probing in between. The loop checks the abort signal but not the deadline, so a crawl with 5 s left
   can run 60 s over.

## Current code

`packages/core/src/discovery/deterministic-spider.ts:1443-1448` (branch `worktree-audit-cleanup`)

```ts
      } catch {
        // Double-record fix: only record as skipped if page was not already recorded
        if (!recorded) {
          skip({ urlPath: requestedAsAsked, why: 'did-not-load' });
        }
      }
```

`deterministic-spider.ts:568`

```ts
    if (options.seedSitemap !== false && timeLeft() > 0) {
```

`deterministic-spider.ts:612-613` (inside the seeding block)

```ts
        for (const smUrl of sitemapUrls) {
          if (locCount >= 200 || timeLeft() <= 0) break;
```

`deterministic-spider.ts:919-926`

```ts
            const intervalMs = 10_000;
            const maxWaitMs = 60_000;
            let elapsed = 0;
            while (elapsed < maxWaitMs && !options.signal?.aborted) {
              await clockSleep(intervalMs, options.signal);
              elapsed += intervalMs;
              if (options.signal?.aborted) break;
```

`timeLeft` and `capToDeadline` are declared at lines 426-428:

```ts
    const timeLeft = () => deadline - clockNow();
    const capToDeadline = (ms: number) => Math.max(1, Math.min(ms, timeLeft()));
```

## Change

1. The catch block becomes:

```ts
      } catch {
        // Only a page that was asked for and did not arrive. After a Stop nothing was asked for.
        if (!recorded && !options.signal?.aborted) {
          skip({ urlPath: requestedAsAsked, why: 'did-not-load' });
        }
      }
```

2. Line 568 becomes:

```ts
    if (options.seedSitemap !== false && timeLeft() > 0 && !options.signal?.aborted) {
```

3. Line 613 becomes:

```ts
          if (locCount >= 200 || timeLeft() <= 0 || options.signal?.aborted) break;
```

4. The outage loop becomes:

```ts
            const intervalMs = 10_000;
            const maxWaitMs = 60_000;
            let elapsed = 0;
            while (elapsed < maxWaitMs && !options.signal?.aborted && timeLeft() > 0) {
              // Never sleep past the crawl deadline.
              const wait = capToDeadline(intervalMs);
              await clockSleep(wait, options.signal);
              elapsed += wait;
              if (options.signal?.aborted || timeLeft() <= 0) break;
```

   Leave the rest of the loop body (the `probeFn` call) as it is.

## Tests

`packages/core/tests/audit-crawl-retry.test.ts` drives the Spider with a fake browser and a fake clock and
covers the outage pause. It must still pass. If one of its outage cases counts sleeps of exactly 10 000 ms with
a deadline shorter than that, the count changes: update the expectation to the capped value and say so in the
PR. Do not weaken any other assertion.

Commands: `pnpm build`, then `pnpm exec vitest run packages/core/tests/audit-crawl-retry.test.ts packages/core/tests`.

## Done when

- [x] A stopped crawl adds no `did-not-load` Skipped Page for a page that was not recorded
- [x] The outage pause never sleeps past `deadline`
- [x] Sitemap seeding does not start, and stops between sitemaps, once the signal is aborted
- [x] `pnpm build` and the core unit tests pass

## Notes

A page that throws because time ran out (`throw new Error('time-limit')`) is still listed as `did-not-load`;
that is unchanged here.
