# T-141: A start page that answers 429 or 503 fails without the one retry

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core/audit | bug | built |

**Files you may edit (no others):**
- `packages/core/src/discovery/deterministic-spider.ts`
- `packages/core/tests/audit-crawl-retry.test.ts`

**Do not build in parallel with:** any other ticket that edits `packages/core/src/discovery/deterministic-spider.ts`.

## Problem

In the Spider, the start-page check (`options.onStartPage`) runs before the busy-host block that slows down and retries once on 429 or 5xx. The Website Audit's `onStartPage` refuses any start status of 400 or more. So a start page that answers 429 or 503 once fails the whole Website Audit with `ERR_UNREACHABLE`, without the single retry ADR 0043 requires. Every other page gets that retry.

## Current code

`packages/core/src/discovery/deterministic-spider.ts:801` (branch `worktree-audit-cleanup`)

```ts
        if (requestedDepth === 0 && options.onStartPage) {
          const check = await options.onStartPage(page, navRes);
          if (check?.blocked) {
            startBlocked = check.blocked;
            return;
          }
          if (check?.startError) {
            startRefused = check.startError;
            return;
          }
        }

        // The host says it is busy or answers 5xx (ADR 0043): slow down on 429/503, retry once
        if (
          pacer &&
          options.retryBusyHost &&
          navRes.ok &&
          (navRes.status === 429 || (navRes.status !== undefined && navRes.status >= 500 && navRes.status < 600))
        ) {
          if (navRes.status === 429 || navRes.status === 503) {
            pacer.slowDown(new URL(fullUrl).host, navRes.retryAfterMs);
          }
          options.onPageProgress?.({ type: 'page', path: requestedAsAsked, state: 'retrying' });
          try {
            const again = await paced(fullUrl, () =>
              navigate(page, fullUrl, {
                ...navLimits(pageTimeoutMs),
                needLinks: true,
                who: options.role || (isRoleSignedIn ? 'signed-in' : 'visitor'),
                retryDelayMs: options.retryDelayMs,
                onRetry: () => {
                  options.onPageProgress?.({ type: 'page', path: requestedAsAsked, state: 'retrying' });
                },
              })
            );
            navRes = { ...again, attempts: navRes.attempts + again.attempts };
          } catch {
            // The wait ended at the deadline or on abort: the first answer stands.
          }
        }

        const landed = new URL(navRes.finalUrl || page.url());
```

## Change

Move the first block (the whole `if (requestedDepth === 0 && options.onStartPage) { ... }`) so it sits after the busy-host block and before `const landed = ...`. Do not change a single line inside either block. Result order:

1. `// The host says it is busy ...` block (unchanged).
2. `if (requestedDepth === 0 && options.onStartPage) { ... }` (unchanged), with this comment added above it:

```ts
        // After the busy-host retry, so a start page that answered 429 or 5xx once gets its one retry too.
```

3. `const landed = ...`.

## Tests

Edit `packages/core/tests/audit-crawl-retry.test.ts`. Copy the setup of the existing test `'retries 500 once and records page if retry succeeds'` (about line 298).

Add `'a start page answering 503 once is retried and the audit goes on'`: the start address answers 503 on the first navigation and 200 with a normal page on the second. Expect the crawl to resolve (no `AuditCrawlRefusedError`) and the start page to be in `result.pages`.

Keep `'start page answering 500 throws ERR_UNREACHABLE with status'` (about line 152) passing: there the start page answers 500 every time, so after one retry it is still refused. If that test counts navigations, its expected count becomes 2 (first try plus one retry).

Run: `pnpm exec vitest run packages/core/tests/audit-crawl-retry.test.ts`, then `pnpm build`.

## Done when

- [x] A start page that answers 503 then 200 is audited.
- [x] A start page that answers 5xx twice still fails with `ERR_UNREACHABLE`.
- [x] Tests and `pnpm build` pass.

## Notes

- The retry block only runs when the caller sets `retryBusyHost`; the Website Audit does, a Check-up does not. A Check-up's behaviour is unchanged apart from the order of two independent blocks.
- Do not change `packages/core/src/audit/crawl/crawl.ts` here.
