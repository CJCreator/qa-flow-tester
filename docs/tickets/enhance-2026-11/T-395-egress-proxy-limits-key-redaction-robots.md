# T-395: Egress proxy limits, key-shaped redaction, robots 5xx

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | security | todo |

**Files you may edit (no others):** `packages/core/src/egress-proxy.ts`, `packages/core/src/redact.ts`, `packages/core/src/competitive/robots.ts`, and their tests in `packages/core/tests/` (`redaction.test.ts`, plus a new `egress-proxy-limits.test.ts` and `robots-5xx.test.ts`).

## Problem (verify first)

- **Proxy ports:** `egress-proxy.ts:44` accepts any port from 1 to 65535.
- **Proxy timeout:** the plain-http path (around line 134) has no timeout, while CONNECT has `CONNECT_TIMEOUT_MS`.
- **Redaction:** `redact.ts` removes secrets only by parameter name, `Authorization` or `Bearer`. A provider error that echoes `sk-…`, `AIza…` or `ghp_…` is not caught.
- **robots.txt:** in `competitive/robots.ts:113-116`, a fetch error, a timeout or a 5xx means allow-all.

## Change

- **Proxy:** allow ports 80 and 443, plus a port the target address names explicitly. Add an idle timeout to the plain-http path.
- **Redaction:** add patterns for the key shapes of the four supported providers and for GitHub tokens.
- **robots.txt:** a 5xx means "disallow for this run". A 404 still means allow-all.

## Tests

- The proxy refuses a CONNECT to port 22.
- A fake `sk-ant-…` inside an error message comes out as `[redacted]`.
- A robots.txt 503 skips every page, with the reason `robots`.

## Done when

All three tests pass.
