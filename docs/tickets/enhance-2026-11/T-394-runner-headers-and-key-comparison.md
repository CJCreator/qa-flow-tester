# T-394: Runner response headers and access-key comparison

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | security | todo |

**Files you may edit (no others):** `packages/runner/src/security-headers.ts`, `packages/runner/src/server.ts` (`matchesSecret` only), `packages/runner/tests/security-headers.test.ts`, `packages/runner/tests/access-key-compare.test.ts` (new).

**Do not build in parallel with:** T-392, T-402 (runner chain).

## Problem (verify first)

- `security-headers.ts:41-46` is reported to set only X-Frame-Options, CSP and HSTS by default. `X-Content-Type-Options` and `Referrer-Policy` come from a few routes only (`audit-preview.ts:50-52`, `audit-export.ts:126`, `evidence-file.ts:50`).
- `matchesSecret` in `server.ts:250` is reported to compare lengths before `timingSafeEqual`, which leaks the key's length.

## Change

- Send `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` on every response.
- Compare SHA-256 digests of both values with `timingSafeEqual`.

## Tests

- Every route answers with both headers.
- Keys of different lengths go through the same code path.

## Done when

The tests pass, and `curl -I` against the hosted copy shows both headers.
