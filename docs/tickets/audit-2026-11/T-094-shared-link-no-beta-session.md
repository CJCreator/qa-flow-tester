# T-94: A Shared Link view must not create a beta session

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | built |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`
- `packages/runner/tests/audit-share-routes.test.ts`
- `packages/runner/tests/route-access-server.test.ts`

**Do not build in parallel with:** T-91, T-92, T-96, T-97, T-99, T-100, T-106, T-108, T-110, T-112 (all edit `server.ts`).

## Problem

On a beta copy every request except the scheduler row goes through `sessionFor`, which creates a visitor session and counts it against a per-IP limit. A `public` Shared Link page (`/s/:linkId`) strips its `Set-Cookie`, so the viewer never keeps the session.

Scenario: a client's office (one IP) opens a Shared Link. Each view creates a new session. The 21st view within 10 minutes gets a 429 `ERR_BETA_LIMIT` JSON reply instead of the page.

## Current code

`packages/runner/src/server.ts:1207-1216` (branch `worktree-audit-cleanup`)

```ts
          if (this.beta && matched?.route.access !== 'scheduler') {
            const proto = req.headers['x-forwarded-proto'];
            try {
              enterSession(sessionFor(req, res, (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ?? false));
            } catch (err) {
              if (!(err instanceof SessionRateLimited)) throw err;
              res.setHeader('Retry-After', '600');
              this.sendJson(res, 429, { error: err.message, code: 'ERR_BETA_LIMIT' });
              return;
            }
```

## Change

Replace the first line of that block with:

```ts
          // A 'public' row (a Shared Link page) needs no visitor session: its viewer keeps no cookie, so each
          // view would count as a new visitor and soon hit the per-address limit.
          if (this.beta && matched?.route.access !== 'scheduler' && matched?.route.access !== 'public') {
```

Change nothing else in the block.

## Tests

Edit `packages/runner/tests/audit-share-routes.test.ts` only if it already starts a beta `RunnerServer`. If it does, add a test that requests one valid Shared Link 25 times in a loop and expects status 200 every time.

If no test in that file starts a beta server, add the test to `packages/runner/tests/route-access-server.test.ts` instead (that file has a beta server on `BETA_PORT` and a `/s/${LINK_ID}` row): call `call(BETA_PORT, 'GET', \`/s/${LINK_ID}\`)` 25 times and expect status 200 each time. In that case add `packages/runner/tests/route-access-server.test.ts` to the files you may edit.

Run: `pnpm exec vitest run packages/runner/tests/route-access-server.test.ts packages/runner/tests/audit-share-routes.test.ts`, then `pnpm build`.

## Done when

- [x] A `public` row skips `sessionFor` on beta.
- [x] 25 views of one Shared Link from one address all answer 200.
- [x] Both test files pass.

## Notes

- The `closedInBeta` check that follows inside the same block is also skipped for `public` rows. That is intended: `authorizeRoute` already applies the row's own beta policy.
- Out of scope: the limit itself (`beta.ts`).
