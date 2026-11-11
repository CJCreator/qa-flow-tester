# T-341: AEO reads answers in divs and details, the Organization check waits for the home page, GEO matches author classes as words

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/aeo.ts`
- `packages/checkers/src/geo.ts`
- `packages/checkers/tests/aeo-geo-detection.test.ts` (new)
- `packages/checkers/tests/aeo-geo-dom.test.ts` (new, browser tier)
- `vitest.workspace.ts`

**Do not build in parallel with:** T-308, T-336, T-349, T-379, T-380 (all edit `vitest.workspace.ts`).

## Problem

Three detections in the AEO and GEO checks report problems that are not there.

1. **Answers in a div.** `AeoChecker` finds the answer after a question heading in `packages/checkers/src/aeo.ts:244-247`: `tag !== 'DIV'` forces the answer text to `''` whenever the next block is a `<div>`. A FAQ written `<h3>How do I pay?</h3><div>You can pay by card...</div>` is reported as "Heading is not followed by an immediate answer". A heading with no next sibling (it sits inside a wrapper `<div class="q">`) is reported the same way, and an accordion written with `<details><summary>Question?</summary>...answer...</details>` is never read as a question at all.
2. **Organization schema.** The site-wide flag `org-schema` (`aeo.ts:104-105`) is set the first time any root or `/about` page is seen. If `/about` is crawled before `/`, it uses up the flag. A missing `Organization` or `WebSite` block is then only reported for `/about` (and the title says "Homepage"), and a home page that has the block is never counted.
3. **Author class.** `GeoChecker` (`geo.ts:162-165`) treats any class containing `author` as a byline, so `class="authority-badge"` or `class="authorization"` counts. A content page with no real author then passes the E-E-A-T check.

## Current code

Branch from `main`.

`packages/checkers/src/aeo.ts` (`grep -n "tag !== 'DIV'\|org-schema\|const BLOCKS" packages/checkers/src/aeo.ts`):

```ts
            const answerText =
              nextEl && tag !== 'DIV' && !/^H[1-6]$/.test(tag) ? (nextEl.textContent || '').trim() : '';
...
      const first = !context.siteWide?.has('org-schema');
      context.siteWide?.add('org-schema');
```

`packages/checkers/src/geo.ts` (`grep -n 'class\*="author"' packages/checkers/src/geo.ts`):

```ts
          '[rel="author"], [class*="author" i], [itemprop="author"], meta[name="author"]'
```

## Change

1. `aeo.ts`, in the `collectDetails` page function: the answer is the first block after the heading. If the heading has no next element sibling, start from the heading's parent's next element sibling. A `DIV` counts as an answer when its text is under 600 characters and it contains no heading (`h1..h6`) inside; otherwise it is a layout wrapper and gives no answer. Remove the `tag !== 'DIV'` test. A `DIV` answer is not "structured" (only lists, tables, `DL` are).
2. Same function: also read `details > summary` as a question when its text passes the existing question test. The answer is the summary's next element sibling (a `p`, `div`, `ul`...), or the text of the `<details>` minus the summary when there is no element sibling. Keep the cap of 5 question headings.
3. `aeo.ts:98-120`: set a site-wide key only when the home page (`urlPath` is `/` or empty) has been judged: use `firstTime`-style logic in two parts. If the page is the home page and has no Organization or WebSite schema and `org-schema` was not set, raise the finding; then set `org-schema` for any root page. A `/about` page never raises and never sets the flag. Update the id/title text if needed so it only says "Homepage" for the home page.
4. `geo.ts`: replace `[class*="author" i]` in the selector with a check in the page function: any element whose `class` attribute has a token that equals `author`, `byline`, or starts with `author-` or `author_` or ends with `-author` or `_author` (test with `/(^|[\s_-])(author|byline)($|[\s_-])/i` on the `class` attribute string, so `authority` and `authorization` do not match). Keep `[rel="author"]`, `[itemprop="author"]`, `meta[name="author"]`.
5. `vitest.workspace.ts`: add `'aeo-geo-dom'` to the `checkers` entry of `BROWSER_TESTS`.
6. Run `pnpm exec prettier --write` on the touched files.

## Tests

- `packages/checkers/tests/aeo-geo-detection.test.ts` (new, unit tier, mock page whose `evaluate` returns details, as `seo.test.ts` does): `/about` first with no Organization block gives no finding and leaves `org-schema` unset; then `/` with no block gives one Organization finding; `/` with an Organization block and `/about` without give none.
- `packages/checkers/tests/aeo-geo-dom.test.ts` (new, browser tier: launches Chromium and uses `page.setContent`): `<h3>How do I pay?</h3><div>` + 20 words + `</div>` gives `hasAnswerParagraph: true`; a heading wrapped in `<div class="q"><h3>How?</h3></div><p>...20 words...</p>` finds its answer; a `<details><summary>What is it?</summary><p>...20 words...</p></details>` is read as a question; a `div` wrapper holding another heading is not an answer. For GEO: `<span class="authority-badge">` gives no byline; `<span class="post-author">` gives one. Call the checkers' `checkPage` and assert on the findings, since the page function is not exported.

Run: `pnpm exec vitest run packages/checkers/tests/aeo-geo-detection.test.ts`, then `pnpm test:browser` for `packages/checkers/tests/aeo-geo-dom.test.ts` (it launches Chromium), then `pnpm exec vitest run --project unit packages/checkers/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "tag !== 'DIV'" packages/checkers/src/aeo.ts` finds nothing.
- [ ] `grep -n 'class\*="author"' packages/checkers/src/geo.ts` finds nothing.
- [ ] `grep -n "aeo-geo-dom" vitest.workspace.ts` finds the entry.
- [ ] Existing AEO and GEO cases in `seo.test.ts` still pass; `pnpm build` passes.

## Notes

- Audit findings M22 (part), L7 (part) (audit of 11 Nov 2026 on `d225418`).
- The AEO answer rules stay `Suggestion` severity; only the detection changes.
- Related: T-340 (SEO checks), T-232 (missing-title problem).
