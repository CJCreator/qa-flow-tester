# T-339: The security header checks parse HSTS, frame-ancestors and the CSP

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/security.ts`
- `packages/checkers/tests/security-headers-parse.test.ts` (new)

**Do not build in parallel with:** T-234 (edits `security.ts`).

## Problem

`SecurityChecker.checkHeaders` (`packages/checkers/src/security.ts:381`) only looks whether a header is there, so weak values pass as good.

- HSTS (`:456`): any value counts. `Strict-Transport-Security: max-age=0` switches HSTS off and still passes.
- Clickjacking (`:422`): `content-security-policy?.includes('frame-ancestors')` is a substring test. `frame-ancestors *` allows every site to frame the page, and the word inside a `report-uri` or a comment also passes.
- CSP (`:393`): only the presence is checked. A policy with `script-src 'unsafe-inline'` passes although it gives almost no protection against XSS.

A site owner reading a clean report is told these are fine.

## Current code

Branch from `main`.

`packages/checkers/src/security.ts` (`grep -n "frame-ancestors')\|strict-transport-security'\]\|normalized\['content-security-policy'\]" packages/checkers/src/security.ts`):

```ts
    if (!normalized['content-security-policy']) {
...
    const hasFrameAncestors = normalized['content-security-policy']?.includes('frame-ancestors');
...
    if (context.isHttps && !normalized['strict-transport-security']) {
```

## Change

1. Add three small exported pure helpers in `security.ts` (above the class):
   - `parseCsp(value: string): Map<string, string[]>`: split on `;`, trim, first token (lower-cased) is the directive name, the rest are its tokens (keep the case of values, compare with `.toLowerCase()`). First occurrence of a directive wins, as in browsers.
   - `hstsMaxAge(value: string): number | undefined`: find the `max-age` directive (case-insensitive, optional quotes), return the integer or `undefined` if missing or not a number.
   - `frameAncestorsAllowsAll(csp: Map<string, string[]>): boolean`: true when the `frame-ancestors` directive is missing, is empty, or contains `*`, `http:`, or `https:` as a token.
2. Clickjacking: `hasFrameAncestors` becomes "the CSP has a `frame-ancestors` directive and `frameAncestorsAllowsAll` is false". The `X-Frame-Options` branch stays as is. Change the `actual` text to say "frame-ancestors allows any site" when the directive exists but is open.
3. HSTS: when HTTPS and the header is there, parse `max-age`. If missing or below 15552000 (180 days), add one Minor finding `F-SEC-<id>-HSTS-WEAK` with title `Strict-Transport-Security max-age is too short or missing`, expected `max-age of at least 15552000 seconds`, actual quoting the header value. Keep the existing Major finding for a missing header unchanged.
4. CSP: when the header exists, parse it. Take `script-src`, or `default-src` if there is no `script-src`. If its tokens include `'unsafe-inline'` (and no `'nonce-...'` or `'strict-dynamic'` token, which make browsers ignore it) or `'unsafe-eval'`, add one Minor finding `F-SEC-<id>-CSP-UNSAFE`, title `Content-Security-Policy allows unsafe script sources`, with the offending tokens in `actual`. Use the same `this.finding(...)` shape as the neighbours.
5. Run `pnpm exec prettier --write` on both files.

## Tests

New `packages/checkers/tests/security-headers-parse.test.ts` (unit tier, no browser: `checkHeaders` is pure; `security.test.ts` is a browser-tier file listed under `security` in `BROWSER_TESTS`, so the new cases do not go there). Build the checker and the context object the way `security.test.ts` does for its `checkHeaders` cases. Cases:

- HSTS `max-age=0` on https gives the `HSTS-WEAK` finding; `max-age=31536000; includeSubDomains` gives none; `max-age=100` gives it.
- `content-security-policy: frame-ancestors *` still gets the clickjacking finding; `frame-ancestors 'self'` does not; `default-src 'self'; report-uri /frame-ancestors-report` gets it (the word is not a directive).
- `script-src 'self' 'unsafe-inline'` gives `CSP-UNSAFE`; `script-src 'self' 'nonce-abc' 'unsafe-inline'` does not; `default-src 'self'` alone does not.
- Unit-test `parseCsp` and `hstsMaxAge` directly with odd spacing and upper-case names.

Run: `pnpm exec vitest run packages/checkers/tests/security.test.ts`, then `pnpm exec vitest run --project unit packages/checkers/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "includes('frame-ancestors')" packages/checkers/src/security.ts` finds nothing.
- [ ] `grep -n "HSTS-WEAK\|CSP-UNSAFE" packages/checkers/src/security.ts` finds both ids.
- [ ] The new cases pass; `pnpm build` passes.

## Notes

- Audit finding M19 (audit of 11 Nov 2026 on `d225418`).
- `security.test.ts` is browser-tier, so it is not edited. If it has `checkHeaders` cases that expect the old behaviour they still pass: the new findings appear only for weak values.
- Related: T-234 (CSRF and security-depth, same files), T-303 and T-304 (the tool's own headers).
