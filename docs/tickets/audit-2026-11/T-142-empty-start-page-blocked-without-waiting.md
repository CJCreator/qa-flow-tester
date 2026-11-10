# T-142: An empty start page is called an Interstitial Page without waiting for it to fill

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core/audit | bug | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/core/tests/audit-crawl-retry.test.ts`

**Do not build in parallel with:** T-139, T-147, T-152, T-154 (all edit `crawl.ts`); T-141 (edits the same test file).

## Problem

`onStartPage` reads the start page's title and visible text once. An empty body is classified as the Interstitial Page kind `'empty'` and the Website Audit stops at once with `ERR_SITE_BLOCKED`. A single-page app that has not rendered yet has an empty body for a moment. CONTEXT.md and ADR 0042 say an Interstitial Page is retried and fails only if it is still in the way.

Scenario: a React site whose root is filled 800 ms after load. The Website Audit refuses it as blocked.

## Current code

`packages/core/src/audit/crawl/crawl.ts:396` (branch `worktree-audit-cleanup`)

```ts
      onStartPage: async (page, navRes) => {
        finalUrl = withoutHash(page.url());
        const signals = await readInterstitialSignals(page);
        const kind = classifyInterstitial(signals);
        if (kind) {
          blocked = kind;
          blockedStop.abort();
          return { blocked: kind };
        }
```

`classifyInterstitial(signals)` returns `'tunnel-warning' | 'bot-check' | 'empty' | null`. `readInterstitialSignals(page)` returns `{ title, text }`.

## Change

Replace the three lines `const signals = ...`, `const kind = ...` with:

```ts
        let kind = classifyInterstitial(await readInterstitialSignals(page));
        if (kind === 'empty') {
          // A page that renders in the browser can be empty for a moment: wait once, then look again (ADR 0042).
          await page
            .waitForFunction(() => !!document.body && document.body.innerText.trim() !== '', null, {
              timeout: EMPTY_START_WAIT_MS,
            })
            .catch(() => {});
          kind = classifyInterstitial(await readInterstitialSignals(page));
        }
```

Leave the `if (kind) { ... }` block after it unchanged.

Add the constant near the other constants at the top of the file (next to `AUDIT_MIN_GAP_MS`):

```ts
/** How long an empty start page gets to render before it counts as an Interstitial Page. */
const EMPTY_START_WAIT_MS = 5_000;
```

## Tests

Edit `packages/core/tests/audit-crawl-retry.test.ts`.

- Existing test `'start page with empty body throws AuditCrawlBlockedError with ERR_SITE_BLOCKED and kind empty'` (about line 210) must still pass: the body stays empty, so after the wait it is still blocked. If that test uses a fake page object, add a `waitForFunction` method to the fake that rejects (`async () => { throw new Error('timeout'); }`).
- Add `'an empty start page that fills in is audited'`: copy that test's setup; make the page's text empty on the first read and `'Welcome to the shop'` on the second read (the fake's `evaluate` returns `''` first, then the text), and make `waitForFunction` resolve. Expect no `AuditCrawlBlockedError` and the start page recorded.

Run: `pnpm exec vitest run packages/core/tests/audit-crawl-retry.test.ts packages/core/tests/audit-interstitial.test.ts`, then `pnpm build`.

## Done when

- [ ] An empty start page is re-read once after waiting up to 5 s.
- [ ] A start page that stays empty still throws `AuditCrawlBlockedError` with kind `'empty'`.
- [ ] A tunnel warning or bot check is still blocked at once (no wait).
- [ ] Tests and `pnpm build` pass.

## Notes

- Do not change `interstitial.ts`.
- The wait is on the page that is already open: it sends no request to the site.
