# T-347: The SRI check treats the site's own subdomains as first party

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/security-depth.ts`
- `packages/checkers/tests/security-depth.test.ts`

**Do not build in parallel with:** T-234 (edits `security-depth.ts`, `security-depth.test.ts`).

## Problem

The subresource integrity (SRI) check lists every script and stylesheet loaded from another origin that has no `integrity` attribute. It compares whole origins (`packages/checkers/src/security-depth.ts:72`, `u.origin !== pageOrigin`). A site's own `cdn.example.com` or `static.example.com` is a different origin from `www.example.com`, so the site's own asset host gets "Script from cdn.example.com loads without an integrity attribute". The advice ("host the file on your own site") is wrong for it: the site does host it. The finding is noise on most sites that split assets onto a subdomain.

A smaller point: the source-map probe reads `res.headers['sourcemap']` (`:232`) and assumes lower-case header names. That is true today (`core/src/safe-net.ts` passes Node's lower-cased `res.headers`), but nothing in the `FetchedResponse` type says so.

## Current code

Branch from `main`.

`packages/checkers/src/security-depth.ts` (`grep -n "export function findMissingSri" -A12 packages/checkers/src/security-depth.ts`):

```ts
export function findMissingSri(tags: ResourceTag[], pageOrigin: string): ResourceTag[] {
  return tags.filter((t) => {
    if (t.hasIntegrity) return false;
    try {
      const u = new URL(t.url);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== pageOrigin;
```

and the response type (`grep -n "interface FetchedResponse" -A5 packages/checkers/src/security-depth.ts`):

```ts
export interface FetchedResponse {
  status: number;
  headers: Record<string, string>;
```

`isSameSite` lives in `packages/core/src/same-site.ts` and treats only the `www` twin as the same site. The checkers package must not import core, and no public-suffix library is installed.

## Change

1. In `security-depth.ts`, add and export `isOwnSubdomain(resourceHost: string, pageHost: string): boolean`. Lower-case both, strip a leading `www.`, then return true when they are equal or the resource host ends with `.` plus the page's registrable domain. Compute the registrable domain as the last two labels, or the last three when the second-last label pair is in a small constant set (`co.uk`, `org.uk`, `ac.uk`, `com.au`, `co.nz`, `co.in`, `co.jp`, `com.br`). Add a comment that this is an approximation without a public-suffix list.
2. In `findMissingSri`, return false (not missing) when `isOwnSubdomain(u.hostname, new URL(pageOrigin).hostname)`. An own subdomain on a different scheme or port still counts as first party for this check.
3. Add a comment on `FetchedResponse.headers`: "Header names are lower-case (Node's `res.headers`)". Leave the `sourcemap` lookups as they are.
4. Run `pnpm exec prettier --write` on the two files, then `pnpm build`.

## Tests

In `packages/checkers/tests/security-depth.test.ts` (unit, no Chromium), in the `SRI` block:

- Page `https://www.example.com`: scripts from `https://cdn.example.com/a.js` and `https://static.example.com/b.css` without integrity are not reported.
- Page `https://app.example.com`: `https://cdn.example.com/a.js` is not reported either (same registrable domain).
- `https://cdn.other.com/lib.js` and `https://example.com.evil.net/x.js` are still reported (look-alike host).
- Page `https://shop.example.co.uk`: `https://cdn.example.co.uk/a.js` is not reported; `https://cdn.other.co.uk/a.js` is.
- The existing SRI tests still pass.

Run: `pnpm exec vitest run packages/checkers/tests/security-depth.test.ts`, then the checkers unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "isOwnSubdomain" packages/checkers/src/security-depth.ts` finds the helper and its use in `findMissingSri`.
- [ ] `cdn.example.com` on a `www.example.com` page gives no SRI finding (test); a look-alike host still does.
- [ ] The tests and `pnpm build` pass.

## Notes

- Audit finding L7 (audit of 11 Nov 2026 on `d225418`).
- Build after T-234: it edits the same file and its test.
- If the owner later wants exact registrable-domain handling, a public-suffix package is a separate decision; this ticket adds no dependency.
