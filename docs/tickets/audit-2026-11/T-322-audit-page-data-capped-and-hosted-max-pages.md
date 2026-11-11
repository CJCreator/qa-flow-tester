# T-322: Website Audit page data is capped, and the hosted page limit applies

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | speed | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/analysis/raw-page.ts`
- `packages/core/src/audit/analysis/read-page.ts`
- `packages/core/src/audit/analysis/hierarchy.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/runner/src/routes/audit-crawl.ts`
- `packages/runner/src/routes/index.ts`
- `packages/core/tests/audit-read-page-caps.test.ts` (new)
- `packages/core/tests/audit-hierarchy.test.ts`
- `packages/core/tests/audit-pipeline.test.ts`
- `packages/runner/tests/audit-crawl-route.test.ts`

**Do not build in parallel with:** T-324 (edits `hierarchy.ts`, `audit-hierarchy.test.ts`); T-295, T-321, T-326, T-328 (all edit `pipeline.ts`, `audit-pipeline.test.ts`); T-266 (edits `audit-crawl.ts`, `audit-crawl-route.test.ts`); T-264, T-323 (all edit `index.ts`).

## Problem

A Website Audit keeps everything it reads from every page in memory until the result is saved. On the hosted copy that is one Cloud Run instance with 2 GiB, and its working folder (`RUNNER_DATA_DIR=/tmp/qa-data`, phone screenshots under the temp folder) is in memory too (`.github/workflows/deploy.yml:200-203`). This ticket is a suspected out-of-memory risk, found by reading the code: no crash has been reproduced.

What grows without a limit:

- `readPage` keeps up to 100,000 characters of text per page (`packages/core/src/audit/analysis/read-page.ts:31`) twice: once in `raw.textChunks` and again in the Page Content built from it (`read-page.ts:57`). Nothing reads `raw.textChunks` after `buildPageContent` (`grep -rn textChunks packages/core/src` finds only `page-content.ts` and `raw-page.ts`).
- Headings, images, anchors, contact links and CTA candidates have no count cap, and heading text (`read-page.ts:243`, `:264`) and link text (`:136-139`) have no length cap. A page with 20,000 product links, or a heading that wraps a whole section, is kept whole.
- `buildPageHierarchy` copies every internal link of every page into the stored result (`packages/core/src/audit/analysis/hierarchy.ts:101-107`). The same menu and footer links repeat on every page.
- The recorder keeps every page's `read` (raw facts and Page Content) until the pipeline ends (`packages/core/src/audit/pipeline/page-recorder.ts:64`, `:97-104`), although the raw facts are last used by `analyseSite` (`pipeline.ts:438`).
- `AUDIT_LIMIT_DEFAULTS.hostedMaxPages: 200` (`packages/types/src/website-audit.ts:75`) is never applied (`grep -rn hostedMaxPages packages --include=*.ts` finds only its definition and a types test). `validateAuditStartBody` accepts up to `CRAWL_LIMIT_BOUNDS.maxPages` = 1000 (`packages/types/src/discovery.ts:25`), and the start route uses that check only (`packages/runner/src/routes/audit-crawl.ts:484-485`).

## Current code

Branch from `main`.

`packages/core/src/audit/analysis/read-page.ts` (`grep -n "READ_PAGE_MAX_TEXT_CHARS =\|buildPageContent(raw\|headings.push\|anchors.push\|images.push\|startBoundary({ kind: 'heading'" packages/core/src/audit/analysis/read-page.ts`):

```ts
export const READ_PAGE_MAX_TEXT_CHARS = 100_000;
...
  return { raw, content: buildPageContent(raw, { origin, maxTextChars }) };
...
      startBoundary({ kind: 'heading', heading: clean(el.textContent) });
...
      images.push({ src, alt: el.getAttribute('alt'), chunk: here() });
...
    if (level !== null) headings.push({ level, text: clean(el.textContent), chunk: here() });
...
      anchors.push({ href, text, region: linkRegion(el), chunk });
```

`packages/core/src/audit/analysis/hierarchy.ts:101-107`:

```ts
  const links: NavigationLink[] = [];
  for (const page of unique) {
    for (const link of page.content.links) {
      if (link.leavesSite) continue;
      links.push({ from: page.urlPath, to: link.to, region: link.region, text: link.text });
    }
  }
```

`packages/core/src/audit/pipeline/pipeline.ts` (`grep -n "raw: p.read!.raw" packages/core/src/audit/pipeline/pipeline.ts`): the only read of the raw facts, inside the `stages.analyseSite({...})` call.

`packages/runner/src/routes/audit-crawl.ts` (`grep -n "validateAuditStartBody(body)\|const crawl = await crawlFn(request" packages/runner/src/routes/audit-crawl.ts`):

```ts
    const check = validateAuditStartBody(body);
    if (!check.ok) return refuse(res, 400, 'ERR_INVALID_AUDIT', AUDIT_INVALID, check.errors);
    const request = check.value;
```

```ts
    const crawl = await crawlFn(request, {
```

`packages/runner/src/routes/index.ts` (`grep -n "allowPrivateAddresses: wiring.localRun" packages/runner/src/routes/index.ts`): the crawl and re-run rows get `allowPrivateAddresses: wiring.localRun`. `localRun` is false on the hosted copy (`server.ts`: `localRun: !this.beta && isLoopbackBindHost(this.host)`).

## Change

1. `raw-page.ts`: add the caps and one pure function that applies them:

```ts
/** Most entries kept per list of a RawPage (headings, images, anchors, contact links, CTA candidates, scripts...). */
export const RAW_LIST_CAP = 500;
/** Longest text kept per heading, Section heading, link, CTA, menu or breadcrumb entry. */
export const RAW_ITEM_TEXT_CAP = 300;
/** Most forms per page, and most fields per form. */
export const RAW_FORM_CAP = 50;
```

   `export function capRawPage(raw: RawPage): RawPage` returns a copy where every list (`headings`, `images`, `anchors`, `contactLinks`, `ctaCandidates`, `scripts`, `stylesheets`, `iframes`, `jsonLd`, `socialMetaKeys`, `frameworkMarkers`, `addresses`, `breadcrumb`) keeps its first `RAW_LIST_CAP` entries, `forms` its first `RAW_FORM_CAP` with at most `RAW_FORM_CAP` fields each, the `menu` tree at most `RAW_LIST_CAP` items in total (depth first), and every `text`, field `label`, Section boundary `heading` and address is cut to `RAW_ITEM_TEXT_CAP` characters (never inside a surrogate pair; copy the `cut` rule from `page-content.ts`). `textChunks` is not touched here.

2. `read-page.ts`:
   - Pass `listCap: RAW_LIST_CAP` and `itemTextCap: RAW_ITEM_TEXT_CAP` into `readDom`'s args. In `readDom`, stop pushing to `headings`, `images`, `anchors`, `contactLinks` and `ctaCandidates` once the list holds `listCap` entries, and cut heading text and the `startBoundary` heading with `.slice(0, args.itemTextCap)`. This keeps the `page.evaluate` answer small; the text cap for page text stays `maxTextChars`.
   - In `readPage`, apply `capRawPage` to the evaluate result before anything else, so the caps hold whatever the browser sent.
   - After `buildPageContent`, return `raw` with `textChunks: []`, and say so on `ReadPageResult.raw`: "The text is in `content.text` only: `textChunks` is emptied once the Page Content is built."

3. `hierarchy.ts`, the navigation map: add `export const MAX_NAV_LINKS_PER_PAGE = 200;`. Per page, keep a link only the first time its `to` and `region` appear on that page (a `Set` of `` `${link.region}\n${link.to}` ``), and stop after `MAX_NAV_LINKS_PER_PAGE` links. Update the `PageHierarchy.links` meaning in the doc comment above `buildPageHierarchy`: "each internal link once per page and region, at most MAX_NAV_LINKS_PER_PAGE per page".

4. `pipeline.ts`: after the analysis `try`/`catch` (both branches), release the raw facts, which nothing reads after the analysis:

```ts
  // The raw facts are read by the analysis only; drop them so 200 pages do not stay in memory twice.
  for (const p of readable) p.read!.raw = { ...p.read!.raw, ...EMPTY_RAW_LISTS };
```

   with `EMPTY_RAW_LISTS` a constant in `raw-page.ts` (`export const EMPTY_RAW_LISTS = { textChunks: [], headings: [], images: [], anchors: [], contactLinks: [], forms: [], ctaCandidates: [], scripts: [], stylesheets: [], iframes: [], jsonLd: [], addresses: [], menu: [], breadcrumb: [] } satisfies Partial<RawPage>;`). Check first with `grep -n "\.raw" packages/core/src/audit/pipeline/pipeline.ts` that the analysis call is still the only reader.

5. `audit-crawl.ts`, the hosted page limit:
   - `AuditRunServices` gains `maxPages?: number` with the comment "Most pages one audit may record on this runner. The hosted copy sets AUDIT_LIMIT_DEFAULTS.hostedMaxPages; unset means the start check's own limit."
   - Add `export const AUDIT_HOSTED_PAGES = (max: number) => \`This copy audits at most ${max} pages. Lower Max pages and start again.\`;`
   - In the start handler, right after `const request = check.value;`: `if (deps.maxPages !== undefined && request.limits.maxPages > deps.maxPages) return refuse(res, 400, 'ERR_INVALID_AUDIT', AUDIT_INVALID, { maxPages: AUDIT_HOSTED_PAGES(deps.maxPages) });`
   - In `runAuditVersion`, before the crawl, cut a stored limit that is above the cap (a re-run of an older version): `const runRequest = services.maxPages !== undefined && request.limits.maxPages > services.maxPages ? { ...request, limits: { ...request.limits, maxPages: services.maxPages } } : request;` and pass `runRequest` to `crawlFn` and to the after-crawl step instead of `request`.

6. `routes/index.ts`: in both `auditCrawlRoutes({...})` and `auditRerunRoutes({...})` add `...(wiring.localRun ? {} : { maxPages: AUDIT_LIMIT_DEFAULTS.hostedMaxPages }),` and import `AUDIT_LIMIT_DEFAULTS` from `@qa/types`.

7. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New `packages/core/tests/audit-read-page-caps.test.ts` (unit tier: a fake `page` object, no Chromium):

- A fake page: `{ evaluate: async () => facts, url: () => 'https://shop.example/' } as unknown as Page`, where `facts` holds 2,000 anchors, 2,000 headings with 5,000-character text, 2,000 images, one text chunk of 50,000 characters and a heading boundary of 5,000 characters.
- `'caps every list and every item text'`: `result.raw.anchors.length` is `RAW_LIST_CAP`, every heading text is at most `RAW_ITEM_TEXT_CAP` characters, `result.content.links.length` is at most `RAW_LIST_CAP`.
- `'keeps the text in the Page Content only'`: `result.raw.textChunks` is `[]` and `result.content.text.length` is 50,000.
- `capRawPage` on its own: a menu of 3 levels with 1,000 items keeps `RAW_LIST_CAP` in total; a heading ending in a surrogate pair at the cut is not split.

`packages/core/tests/audit-hierarchy.test.ts`:

- `'lists every internal link of every recorded page...'`: build `expected` with the same per-page `region`+`to` de-duplication.
- New `'keeps a link once per page and region, and at most MAX_NAV_LINKS_PER_PAGE per page'`: one page with the same menu link twice and 300 distinct internal links gives one menu entry and `MAX_NAV_LINKS_PER_PAGE` links from that page.

`packages/core/tests/audit-pipeline.test.ts`: `'drops the raw facts after the analysis'`: after `runAuditPipeline` resolves, every `recorder.pages[i].read.raw.anchors` is `[]` while `read.content` is unchanged.

`packages/runner/tests/audit-crawl-route.test.ts`, in `describe('POST /api/audits')`:

- `'the hosted copy refuses more pages than its limit'`: rows built with `deps({ maxPages: 200 })`; `post(base, { ...VALID, maxPages: 500 })` gives 400, `json.code` `'ERR_INVALID_AUDIT'`, `json.fields.maxPages` names 200, and `crawlCalls` is empty. `maxPages: 200` starts normally.
- `'a run never crawls more than the limit'`: call `runAuditVersion` (or start through the route with a store holding an older version) with `maxPages: 200` and a request of 500: `crawlCalls[0].request.limits.maxPages` is 200.
- `'a local runner has no extra limit'`: without `maxPages`, 500 starts.

Run: `pnpm exec vitest run packages/core/tests/audit-read-page-caps.test.ts packages/core/tests/audit-hierarchy.test.ts packages/core/tests/audit-pipeline.test.ts packages/runner/tests/audit-crawl-route.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -rn "hostedMaxPages" packages/runner/src` finds the wiring in `routes/index.ts`.
- [ ] `grep -n "capRawPage" packages/core/src/audit/analysis/read-page.ts` finds the call.
- [ ] `grep -n "MAX_NAV_LINKS_PER_PAGE" packages/core/src/audit/analysis/hierarchy.ts` finds the cap.
- [ ] The new and changed tests pass, the core and runner unit tests pass, and `pnpm build` passes.

## Notes

- Audit finding M37 (audit of 11 Nov 2026 on `d225418`). Suspected out-of-memory: found by reading, not by a crash. A real check is a hand run on a large public site on the hosted copy (`docs/TESTING.md`), watching the instance memory in Cloud Run.
- `inboundCounts` (`internalLinking`) is computed from the stored links, so a page that links to the same target twice in one region now counts once. That is closer to "pages that link here".
- The browser-tier crawl tests (`audit-crawl-browser`) run `readDom` for real; they keep passing because their pages are far below the caps. Run them by hand if you change `readDom`: `pnpm exec vitest run --project browser packages/core/tests/audit-crawl-browser.test.ts`.
- Out of scope: showing the hosted limit in the wizard's Max pages field. The 400 reply already carries the field message.
- T-324 also edits `hierarchy.ts` (host compare in `hrefToSitePath`); T-321, T-326 and T-295 also edit `pipeline.ts`; T-323 also edits `routes/index.ts`.
