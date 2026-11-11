# T-324: Page Content treats the www twin as the same site

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/analysis/page-content.ts`
- `packages/core/src/audit/analysis/hierarchy.ts`
- `packages/core/tests/audit-page-content.test.ts`
- `packages/core/tests/audit-hierarchy.test.ts`

**Do not build in parallel with:** T-322 (edits `hierarchy.ts`, `audit-hierarchy.test.ts`).

## Problem

The Website Audit crawl treats `example.com` and `www.example.com` as one site: the Spider follows links between them (`isSameSiteOrLoopback`, `packages/core/src/discovery/deterministic-spider.ts:235-236`) and the crawl pins both hosts (`packages/core/src/audit/crawl/crawl.ts:263-266`). The shared rule is `isSameSite` in `packages/core/src/same-site.ts:10-11`.

Page Content does not follow it. `buildPageContent` has its own host check that compares hosts exactly (`packages/core/src/audit/analysis/page-content.ts:171-173`), used for links (`:184`), form actions (`:191`) and CTA targets (`:214`). The menu and breadcrumb reader in `hierarchy.ts` does the same (`packages/core/src/audit/analysis/hierarchy.ts:173`). So on a site whose pages link to their www twin (very common: a logo links to `https://www.example.com/` while the audit started at `https://example.com/`):

- those links are marked `leavesSite: true` and listed as links that leave the site;
- they are left out of the navigation map (`hierarchy.ts:104`), so the pages they point to show up as "unlinked pages" (`hierarchy.ts:129`) although every page links to them;
- the broken-link check never looks at them (`packages/core/src/audit/analysis/broken-links.ts:158` skips `leavesSite`);
- menu and breadcrumb links to the twin are ignored when the hierarchy is placed.

## Current code

Branch from `main`.

`packages/core/src/audit/analysis/page-content.ts` (`grep -n "isSameSite" packages/core/src/audit/analysis/page-content.ts`):

```ts
function isSameSite(url: URL, site: URL | null): boolean {
  return site !== null && url.host.toLowerCase() === site.host.toLowerCase();
}
```

```ts
  if (isSameSite(url, site)) return { to: sitePath(url), leavesSite: false };
  return { to: redactUrl(url.href), leavesSite: true };
```

```ts
  return isSameSite(url, site) ? sitePath(url) : redactUrl(url.href);
```

(the last line appears twice: `formAction` and `ctaTarget`).

`packages/core/src/audit/analysis/hierarchy.ts` (`grep -n "base.host" packages/core/src/audit/analysis/hierarchy.ts`), in `hrefToSitePath`:

```ts
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.host.toLowerCase() !== base.host.toLowerCase()) return null;
  return redactUrl(`${url.pathname}${url.search}`);
```

`packages/core/src/same-site.ts`:

```ts
/**
 * True when two hosts are one site: identical, or one is the other's www twin (example.com and
 * www.example.com). Ports must match, and any other subdomain (app.example.com) is another site.
 */
export function isSameSite(host: string, siteHost: string): boolean {
```

## Change

1. `page-content.ts`: add `import { isSameSite } from '../../same-site.js';`. Rename the local helper to `onSite` and make it use the shared rule:

```ts
/** The crawl's rule: the same host or its www twin, same port (same-site.ts). */
function onSite(url: URL, site: URL | null): boolean {
  return site !== null && isSameSite(url.host, site.host);
}
```

   Replace the three calls (`linkTarget`, `formAction`, `ctaTarget`) with `onSite(url, site)`.

2. `hierarchy.ts`: add `import { isSameSite } from '../../same-site.js';` and in `hrefToSitePath` replace the host line with `if (!isSameSite(url.host, base.host)) return null;`.

3. Run `pnpm exec prettier --write` on the two files and `pnpm build`.

## Tests

`packages/core/tests/audit-page-content.test.ts`, new cases in `describe('buildPageContent')`:

- `'a link to the www twin is a site path, not a link that leaves the site'`: `rawPage({ url: 'https://bakery.example/', anchors: [{ href: 'https://www.bakery.example/about', text: 'About', region: 'internal', chunk: -1 }] })` with `OPTIONS` (origin `https://bakery.example`) gives `{ to: '/about' }` and no `leavesSite`. The same with the page on `https://www.bakery.example/` and a link to `https://bakery.example/menu`.
- `'another subdomain or another port still leaves the site'`: `https://shop.bakery.example/x` and `https://bakery.example:8443/x` keep `leavesSite: true`.
- `'form actions and CTA links to the twin are site paths'`: a form with action `https://www.bakery.example/order` gives `action: '/order'`; a button-styled link to the twin gives a site path.

`packages/core/tests/audit-hierarchy.test.ts`:

- `'menu and breadcrumb links to the www twin place the page'`: a start page `https://bakery.example/` whose menu item links to `https://www.bakery.example/menu` places `/menu` with `placedBy: 'menu'`.
- In `describe('internalLinking (REQ-015)')`: `'a page linked only through the www twin is not unlinked'`: build the pages with `buildPageContent` from raw pages whose anchors use the twin host, then `internalLinking(buildPageHierarchy(...), paths).unlinkedPages` does not list it.

Run: `pnpm exec vitest run packages/core/tests/audit-page-content.test.ts packages/core/tests/audit-hierarchy.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "host.toLowerCase()" packages/core/src/audit/analysis/page-content.ts packages/core/src/audit/analysis/hierarchy.ts` finds nothing.
- [ ] `grep -n "isSameSite(" packages/core/src/audit/analysis/page-content.ts packages/core/src/audit/analysis/hierarchy.ts` finds the shared rule in both files.
- [ ] The two test files and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M39 (audit of 11 Nov 2026 on `d225418`).
- `broken-links.ts` needs no change: it already skips `leavesSite` links and requests every site path on the audit's own origin (`targetUrl` joins the path to `site.origin`), so a twin link is now checked on the start host. The redirect to the twin, if any, is not followed (the checker fetch has no redirects), which is the existing rule.
- Stored results of earlier versions keep their old `leavesSite` values; a re-run gives the new ones.
- T-322 also edits `hierarchy.ts` (the navigation map cap in `buildPageHierarchy`), in a different function.
