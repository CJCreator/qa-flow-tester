# T-340: SEO: noindex counts only for public visitors, the link probe skips action links, and title and description lengths are checked

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/seo.ts`
- `packages/checkers/tests/seo-noindex-links-lengths.test.ts` (new)

**Do not build in parallel with:** T-343 (edits `seo.ts`).

## Problem

Three things in `SeoChecker.checkPage` give wrong or empty answers.

1. **noindex.** The meta-robots check (`packages/checkers/src/seo.ts:282-300`) raises a Major "Page has a noindex directive" for every Role and every page. A signed-in account page, a login page or a cart page is meant to have `noindex`, so the report calls a correct page a Major problem. The other search checks already gate on `isPublicVisitor` (`:236`, `:303`, `:326`), and `geo.ts:31` skips login, auth, signup and cart paths. The `X-Robots-Tag` response header is never read, so a header-only `noindex` on a public page is missed.
2. **Link probe.** `checkBrokenLinks` (`:601`, request at `:622`) sends one GET to up to 5 same-site links a page, whatever the link is. The request is anonymous (`makeCheckerFetch` in `packages/core/src/checker-fetch.ts` sends no cookies or tokens, so `/logout` does not sign anyone out). But a link such as `/unsubscribe?token=...` or `/delete?id=7` is still a GET that some sites act on. A Check-up must not trigger actions on the checked site.
3. **Lengths.** The title finding says the title "should be between 10 and 60 characters" (`:117`) and the description fix says "50-160 character" (`:143`), but only an empty value is ever checked. A one-word title or a 400-character description passes.

## Current code

Branch from `main`.

`packages/checkers/src/seo.ts` (`grep -n "includes('noindex')\|const toCheck\|await fetchFn(fullUrl)\|between 10 and 60" packages/checkers/src/seo.ts`):

```ts
      if (details.metaRobots && details.metaRobots.toLowerCase().includes('noindex')) {
...
    const toCheck = paths.filter((p) => !asked(p)).slice(0, 5);
...
        const res = await fetchFn(fullUrl);
```

## Change

1. Add a pure exported helper `isActionLink(pathAndQuery: string): boolean` in `seo.ts`. True when the path has a segment (case-insensitive) in this list: `logout`, `signout`, `sign-out`, `log-out`, `unsubscribe`, `delete`, `remove`, `cancel`, `confirm`, `verify`, `activate`, `approve`, `checkout`, `pay`; or the query has a key named `token`, `key`, `code`, `otp`, `signature`, or `sig`; or the query key is `action`. Skip these links in `checkBrokenLinks` before `slice(0, 5)`, so they do not use up a slot. They are not reported as broken or as unchecked.
2. Add a pure exported helper `isNoindexExempt(urlPath: string): boolean` for the same special paths as `geo.ts:31` (`/login`, `/auth`, `/signup`, `/cart`) plus `/account`, `/checkout`, `/admin`, `/dashboard`, `/settings`. Do not edit `geo.ts`.
3. noindex: raise the finding only when `isPublicVisitor && !isNoindexExempt(context.urlPath)`. Also read the header: when `fetchFn` exists, the page is a public one, and `firstTime('xrobots:' + context.urlPath)`, do one `fetchFn(page.url())` and read `headers['x-robots-tag']` (lower-case key; a `FetchedResponse` header map is lower-cased). If it contains `noindex`, raise the same finding with `actual` saying `X-Robots-Tag header is "..."`. If the request fails, say nothing (no claim). This is one extra GET to the page itself per public page, which the Check-up already visited.
4. Lengths, in the `vis.search` block next to the existing checks:
   - Title present but shorter than 10 or longer than 60 characters (after `trim()`): one `Suggestion` finding `F-SEO-<id>-TITLE-LENGTH-<n>`, title `Page title is {too short|too long} ({n} characters)`, expected `A title of 10 to 60 characters`.
   - Description present but shorter than 50 or longer than 160: the same, `DESC-LENGTH`.
   Use the neighbouring findings as the shape (`checker: 'seo'`, `categoryTag: 'SEO'`).
5. Run `pnpm exec prettier --write` on the two files.

## Tests

New `packages/checkers/tests/seo-noindex-links-lengths.test.ts` (unit tier; copy the mock page and `recordingFetch` helpers from `seo.test.ts`):

- `isActionLink`: `/logout`, `/Unsubscribe?token=abc`, `/delete?id=7`, `/pay`, `/page?action=del` are true; `/about`, `/blog/cancel-culture-essay` (one segment containing the word is not a segment match: use exact segment equality) are false. Pick the second example so it checks segment equality.
- Link probe: a page with links `['/about', '/logout', '/unsubscribe?token=x']` makes one request, to `/about`.
- noindex: `role: 'visitor'`, `/pricing`, `metaRobots: 'noindex'` gives the Major finding; `role: 'admin'` gives none; `/login` as a visitor gives none.
- X-Robots-Tag: a fetch that returns `{ 'x-robots-tag': 'noindex, nofollow' }` on a public page gives the finding; a fetch returning null gives none and no error.
- Lengths: a 3-character title gives `TITLE-LENGTH`; a 30-character title gives none; a 200-character description gives `DESC-LENGTH`.

Run: `pnpm exec vitest run packages/checkers/tests/seo-noindex-links-lengths.test.ts`, then `pnpm exec vitest run packages/checkers/tests/seo.test.ts`, then `pnpm exec vitest run --project unit packages/checkers/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "isActionLink\|isNoindexExempt" packages/checkers/src/seo.ts` finds both helpers and their use.
- [ ] `grep -n "x-robots-tag" packages/checkers/src/seo.ts` finds the header read.
- [ ] Existing `seo.test.ts` cases still pass (update an assertion only where it expected a noindex finding for a non-public Role, and say so in the commit).
- [ ] `pnpm build` passes.

## Notes

- Audit findings M22 (part), M24, L7 (part) (audit of 11 Nov 2026 on `d225418`). The audit flagged "suspected: cookies on the probe": checked, `makeCheckerFetch` sends none, so the risk is token and action URLs, not the signed-in session.
- The length findings are `Suggestion`, not Minor, so a short brand title does not lower the score.
- Related: T-232 (one missing-title problem across checks, may touch the same title text), T-341 (AEO/GEO detection).
