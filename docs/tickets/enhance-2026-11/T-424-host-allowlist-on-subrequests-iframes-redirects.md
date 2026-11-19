# T-424: A host allowlist on subrequests, iframes and redirects

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | L | core | security | todo |

**Files you may edit (no others):**
- `packages/core/src/browser.ts` (the allowlist route; `headerHosts` at line 18)
- `packages/core/src/discovery/deterministic-spider.ts` (the navigation and redirect handling only, near lines 425 and 1089-1108)
- `packages/core/src/orchestrator.ts` (the context set-up only)
- `packages/core/src/same-site.ts` (a helper, if needed)
- `packages/core/tests/safety-host-allowlist.test.ts` (new)

**Do not build in parallel with:** T-422, T-423, T-426 (they come first), T-425, T-428 (they come after). Build in that order.

## Problem

The Domain Allowlist (`headerHosts`) is checked only by `onSiteAddress` (`same-site.ts:19`) for the start page and navigate steps (`orchestrator.ts:785, 979`), and by `hostAllowed` (`browser.ts:196-213`), which only decides where secret headers go and blocks nothing. The Spider uses `isSameSiteOrLoopback` (`deterministic-spider.ts:425`). An off-site page after `goto` is recorded as `off-site-redirect` (`:1089-1108`) only after it has loaded. Subresources, iframes and redirects to other hosts are unfiltered. Review B.

## Change

- Install one context-level route that decides each request by host:
  - a navigation request (main frame or iframe) to a host outside the Domain Allowlist is aborted;
  - a redirect whose target is outside the Domain Allowlist is aborted before it loads, and the page is recorded as a Skipped Page with reason `off-site-redirect`;
  - a changing request (POST, PUT, PATCH, DELETE) to a host outside the Domain Allowlist is aborted.
- Subresources (images, scripts, fonts, styles) to other hosts still load when they only read, since a page cannot render without them. They are counted as third-party requests, as today.
- The route reads the same allowlist the Plan Review edits.

## Tests (write the failing test first)

- A page that redirects to another host is not loaded; the Skipped Page reason is `off-site-redirect`.
- An iframe whose `src` is another host is not loaded.
- A POST to another host from a page script is aborted.
- A script from another host still loads.

## Done when

The tests pass, and no run loads a page, iframe or changing request outside the Domain Allowlist.
