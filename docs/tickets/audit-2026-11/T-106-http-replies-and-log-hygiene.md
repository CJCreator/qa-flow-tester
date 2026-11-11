# T-106: Consistent 401 code, CORS methods, bad `%` escapes, and a redacted crash log

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | runner | inconsistency | built |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`
- `packages/runner/src/cli.ts`
- `packages/runner/tests/route-access-server.test.ts`

**Do not build in parallel with:** T-91, T-92, T-94, T-96, T-97, T-99, T-100, T-108, T-110, T-112 (all edit `server.ts`).

## Problem

Four small reply and logging defects.

A. The access-key gate answers 401 without a `code`. Table rows answer `code: 'ERR_ACCESS_KEY'` and `docs/API.md` promises it.

B. CORS: `Access-Control-Allow-Methods` leaves out `PUT`, which the audit settings, shortlist, helper and audit AI model rows use. `Access-Control-Allow-Headers` leaves out `Idempotency-Key`, which Plan approval reads.

C. Inline handlers call `decodeURIComponent` on the path. A malformed escape (for example `/api/sites/%E0%A4%A`) throws `URIError`, and the caller gets a 500 "URI malformed".

D. `cli.ts` logs the raw rejection reason on an unhandled promise rejection. Its message and stack can contain addresses with tokens or header values.

## Current code

`packages/runner/src/server.ts` (branch `worktree-audit-cleanup`)

A. In `grantAccess` (find with `grep -n "private grantAccess" packages/runner/src/server.ts`):

```ts
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'This QA Tool is shared privately: send its access key.' }));
```

B. Lines 1138-1139:

```ts
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-QA-Access');
```

C. Lines 1349, 1408, 1422, 1437, 1457 (line 1640 is already inside a try; line 242 is a cookie parser, leave both):

```ts
              decodeURIComponent(pathname.slice('/api/sites'.length).replace(/^\//, '')),
            await this.handleServeBaseline(decodeURIComponent(pathname.replace('/api/baselines/', '')), res);
            await this.handleDeleteBaseline(decodeURIComponent(pathname.replace('/api/runner/baselines/', '')), res);
              decodeURIComponent(pathname.slice('/api/runner/benchmark/'.length)),
            const relPath = decodeURIComponent(pathname.replace('/api/evidence/', ''));
```

D. `packages/runner/src/cli.ts:76-79`:

```ts
process.on('unhandledRejection', (reason) => {
  console.error('[Release check-up] Unhandled promise rejection:', reason);
  void shutdown('Unhandled promise rejection', 1);
});
```

`server.ts` exports `redactedMessage` (`export { redactedMessage };` at line 209).

## Change

A. Replace the `res.end(...)` line with:

```ts
      res.end(JSON.stringify({ error: ACCESS_KEY_REFUSAL, code: 'ERR_ACCESS_KEY' }));
```

`ACCESS_KEY_REFUSAL` is exported from `./routes/route.js` and has the same text. If `server.ts` does not import it yet, add it to the existing import from `./routes/route.js` (or `./routes/index.js`, whichever already imports `authorizeRoute`).

B. Replace the two lines with:

```ts
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            res.setHeader(
              'Access-Control-Allow-Headers',
              'Content-Type, Authorization, X-QA-Access, Idempotency-Key'
            );
```

C. Add this function near the other top-level helpers in `server.ts` (for example directly above `function isRunId`):

```ts
/** decodeURIComponent that answers null for a malformed escape instead of throwing (the caller sends 400). */
function decodePath(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}
```

At each of the five lines listed under C, decode first and refuse a bad escape. Pattern (shown for `/api/sites`; do the same for the other four, keeping each handler call otherwise unchanged):

```ts
            const sitePath = decodePath(pathname.slice('/api/sites'.length).replace(/^\//, ''));
            if (sitePath === null) {
              this.sendJson(res, 400, { error: 'The address is not valid.', code: 'ERR_INVALID_REQUEST' });
              return;
            }
            await this.handleSites(sitePath, req, res);
            return;
```

D. In `cli.ts`, change the first import to `import { RunnerServer, redactedMessage } from './server.js';` and replace the log line with:

```ts
  console.error('[Release check-up] Unhandled promise rejection:', redactedMessage(reason));
```

## Tests

Edit `packages/runner/tests/route-access-server.test.ts`. Copy the setup of the existing test that calls `call(KEYED_PORT, ...)` without the key and expects 401.

Add:

1. `'the access-key gate answers ERR_ACCESS_KEY'`: `call(KEYED_PORT, 'GET', '/api/runner/status')` with no key. Expect status 401 and `JSON.parse(body).code === 'ERR_ACCESS_KEY'`.
2. `'a malformed % escape answers 400, not 500'`: `call(KEYED_PORT, 'GET', '/api/sites/%E0%A4%A', { 'x-qa-access': KEY })`. Expect status 400 and `code === 'ERR_INVALID_REQUEST'`.

Run: `pnpm exec vitest run packages/runner/tests/route-access-server.test.ts packages/runner/tests/cli-bind-host.test.ts`, then `pnpm build`.

## Done when

- [x] The gate's 401 JSON has `code: 'ERR_ACCESS_KEY'`.
- [x] CORS allows `PUT` and `Idempotency-Key`.
- [x] The five path decodes answer 400 on a malformed escape.
- [x] The crash log prints a redacted message.
- [x] Tests and `pnpm build` pass.

## Notes

- If a wizard test asserts the exact 401 body without `code`, update that expectation only.
- If Node itself rejects the malformed path before the handler runs (status 400 already), keep test 2 as written; it still passes.
