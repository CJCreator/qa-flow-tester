# T-302: Sign-in rows create no beta session, and canonical URLs use PUBLIC_URL

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | security | todo |

**Files you may edit (no others):**

- `packages/runner/src/server.ts`
- `packages/runner/src/ui-static.ts`
- `scripts/tunnel.mjs`
- `docs/CONFIGURATION.md`
- `packages/runner/tests/route-access-server.test.ts`
- `packages/runner/tests/seo-static.test.ts`

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-300, T-301, T-303, T-308, T-313, T-329, T-331, T-357 (all edit `server.ts`); T-259 (edits `ui-static.ts`); T-300, T-301, T-313, T-373 (all edit `CONFIGURATION.md`).

## Problem

1. **Sign-in rows make visitor sessions.** On a beta copy, dispatch gives every request a visitor session (`enterSession(sessionFor(...))`, `packages/runner/src/server.ts:1087-1092`), except `scheduler` and `public` rows. The Helper sign-in rows (`access: 'sign-in'`: `GET /api/helper/status`, `POST`/`GET`/`DELETE /api/helper/session`) need no key and no visitor session: their handlers use only the Helper cookie. So anyone, without the key, can create visitor sessions by calling them. The copy keeps at most 50 sessions and, over the cap, drops the least recently seen ones that hold no AI key, sign-in or run (`forgetOldSessions`, `packages/runner/src/beta.ts:62-73`). A tester's idle session can be pushed out that way, and with it the folder of sites they remembered (`siteDir` is per session). The per-address limit (20 new sessions per 10 minutes) slows this down but does not stop it from several addresses.
2. **Canonical URLs trust `X-Forwarded-Host`.** `publicOrigin` uses `PUBLIC_URL` when set, otherwise `X-Forwarded-Host`, then `Host` (`packages/runner/src/ui-static.ts:78-90`, the header at `:81`). Dispatch checks the `Host` header against the runner's own names (`server.ts:983-996`), but nothing checks `X-Forwarded-Host`, which any client can send. The value is written into the canonical link, the JSON-LD and `og:` tags of `index.html`, `sitemap.xml`, `robots.txt` and `llms.txt` (`ui-static.ts:160`, `:181`). The format check (`/^[\w.-]+(:\d+)?$/`) stops markup injection but not a foreign host name. Any shared cache in front of the runner would then serve another site's address as canonical.

## Current code

Branch from `main`.

`packages/runner/src/server.ts` (`grep -n "A 'public' row (a Shared Link page) needs no visitor session" packages/runner/src/server.ts`):

```ts
          // A 'public' row (a Shared Link page) needs no visitor session: its viewer keeps no cookie, so each
          // view would count as a new visitor and soon hit the per-address limit.
          if (this.beta && matched?.route.access !== 'scheduler' && matched?.route.access !== 'public') {
            const proto = req.headers['x-forwarded-proto'];
            try {
              enterSession(sessionFor(req, res, (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ?? false));
```

`packages/runner/src/ui-static.ts` (`grep -n "x-forwarded-host" packages/runner/src/ui-static.ts`):

```ts
/**
 * The public address of this server, for absolute URLs in canonical links, structured data and the
 * sitemap. PUBLIC_URL wins (set it when serving behind a domain or tunnel); otherwise the request's
 * own host is used, which the server has already checked to be its own.
 */
export function publicOrigin(req: http.IncomingMessage): string {
  const configured = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (configured && /^https?:\/\/[\w.-]+(:\d+)?$/.test(configured)) return configured;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
```

`scripts/tunnel.mjs` (`grep -n "RUNNER_ALLOWED_ORIGINS: origin" scripts/tunnel.mjs`) starts the runner with `RUNNER_ALLOWED_ORIGINS: origin` and no `PUBLIC_URL`. A tunnel reaches the runner with a `localhost` `Host` header (the `accessToken` doc comment, `server.ts:357-361`), so after this change a tunnelled copy needs `PUBLIC_URL` for its canonical links.

`docs/CONFIGURATION.md:22`, `PUBLIC_URL`: "Unset: the request's own host".

## Change

1. `server.ts`: add `&& matched?.route.access !== 'sign-in'` to the `if (this.beta && ...)` condition above, and change its comment to: "A 'public' row (a Shared Link page) and a 'sign-in' row (Helper sign-in) need no visitor session: a Shared Link viewer keeps no cookie, and Helper sign-in uses only the Helper cookie. Making a session there would let anyone, without the key, push testers' idle sessions out (T-302)."

2. `ui-static.ts`, `publicOrigin`: read only the `Host` header:

```ts
  // Host has been checked by dispatch against this server's own names. X-Forwarded-Host has not, and any client can send it.
  const host = String(req.headers.host || 'localhost');
```

   and change the doc comment's last sentence to "otherwise the request's own Host header, which the server has already checked to be its own (never X-Forwarded-Host)."

3. `scripts/tunnel.mjs`, `startRunner`: in the runner's `env`, after `RUNNER_ALLOWED_ORIGINS: origin,` add `PUBLIC_URL: process.env.PUBLIC_URL || origin,`.

4. `docs/CONFIGURATION.md`, the `PUBLIC_URL` row: change "Unset: the request's own host" to "Unset: the request's own `Host` header (never `X-Forwarded-Host`). `pnpm tunnel` sets it to the tunnel's address".

5. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

`packages/runner/tests/seo-static.test.ts`, `describe('publicOrigin')`, new case:

```ts
  it('ignores X-Forwarded-Host: any client can send it', () => {
    expect(
      publicOrigin(req({ host: 'qa.example.com', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }))
    ).toBe('https://qa.example.com');
  });
```

`packages/runner/tests/route-access-server.test.ts`, next to "T-94: 25 views of a Shared Link from one address all answer 200 (no beta session created)", new case on the beta server with the test-only sign-in row `POST /api/t/helper/session`:

- "T-302: 25 sign-in calls from one address all answer 200 and set no visitor session": each answer is 200 (today the calls start failing with 429 `ERR_BETA_LIMIT` once the per-address session limit of 20 is reached), and `res.headers['set-cookie']` holds no entry starting with `qa_session=` (the `call` helper already returns the headers). Do not add a control call that expects a new `qa_session`: the per-address counter is shared by every case in the file, so it may already be used up.

Run: `pnpm exec vitest run packages/runner/tests/seo-static.test.ts`, then `pnpm exec vitest run packages/runner/tests/route-access-server.test.ts` (browser tier: it starts runners), then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "x-forwarded-host" packages/runner/src/ui-static.ts` prints nothing.
- [ ] `grep -n "matched?.route.access !== 'sign-in'" packages/runner/src/server.ts` finds the dispatch condition.
- [ ] `grep -n "PUBLIC_URL" scripts/tunnel.mjs` finds the new env line.
- [ ] The changed tests and the runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding L11 (audit of 11 Nov 2026 on `d225418`).
- The hosted copy is unaffected by step 2: Cloud Run passes the service's own host name in `Host`, which dispatch accepts (`K_SERVICE` and `*.run.app`). Setting `PUBLIC_URL` in `.github/workflows/deploy.yml` would make the two `run.app` names give one canonical address; that is optional and not in this ticket (other tickets edit `deploy.yml`).
- Seen, not changed (a separate decision): the one shared access key travels in `?access=` on the first visit (`server.ts:932`) and is stored as is in the `qa_access` cookie (`server.ts:942`). Every tester of the hosted copy holds the same key. Per-tester tokens, or a cookie holding a derived value instead of the key, would need their own ticket and an ADR.
- Related: T-299 changes the `enterSession(sessionFor(...))` line right below this condition (it adds `markSessionOwner`), so build one after the other. T-301 changes `clientAddress` in `beta.ts`, which `sessionFor` uses for the per-address limit.
