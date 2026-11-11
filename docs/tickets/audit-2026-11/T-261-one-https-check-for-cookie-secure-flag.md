# T-261: One "was this visit https" check for the cookie Secure flag

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | inconsistency | todo |

**Files you may edit (no others):**

- `packages/runner/src/server.ts`
- `packages/runner/tests/access-token.test.ts`

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-265, T-267 (all edit `server.ts`, about 3,900 lines).

## Problem

Four places decide whether a visit came over https. Each is written differently:

| Where | What it checks |
|---|---|
| `helpers/helper-session.ts` `isHttpsRequest` | Socket is TLS, or the first token of `X-Forwarded-Proto` is `https`, or `CF-Visitor` contains `"https"`. Used for the Helper cookie. |
| `server.ts` access-key cookie (`?access=`) | `X-Forwarded-Proto` (first value) _contains_ `https`, or `CF-Visitor` contains `https`, or any allowed origin starts with `https://`. |
| `server.ts` beta session cookie (`enterSession(sessionFor(...))`) | Only: `X-Forwarded-Proto` (first value) contains `https`. No socket check, no `CF-Visitor`. |
| `ui-static.ts` `publicOrigin` | First token of `X-Forwarded-Proto` equals `https` (builds links, not a cookie). |

The results differ. Example: behind Cloudflare with no `X-Forwarded-Proto`, the beta session cookie is set without `Secure` while the Helper cookie is set with it. `X-Forwarded-Proto: http,https` counts as https for the two `server.ts` checks (substring match) but not for the others.

## Owner decision (settled)

**Settled by the owner on 2026-11-11:** use the shared `isHttpsRequest` check in both places. Build the Change below as written; the options are kept for the record.

The `Secure` flag is a security setting, so the rule should be one rule. Options:

- Option A (recommended default): both cookie checks in `server.ts` use `isHttpsRequest(req)`. The access-key cookie keeps its extra fallback "or an allowed origin is https" (the owner told the runner its public address is https). Effect: the beta session cookie gains `Secure` when the visit shows TLS or `CF-Visitor` https (safer); a header like `http,https` is no longer enough on its own. `publicOrigin` in `ui-static.ts` stays as it is (it builds absolute links, not a cookie flag).
- Option B: leave the four checks as they are and only document the difference. Choose this if some tunnel the owner uses sends a header shape that `isHttpsRequest` would read as http.

The change below is Option A.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "x-forwarded-proto" packages/runner/src/server.ts`.

Access-key cookie (in the method that answers `?access=<key>`):

```ts
// Secure only when the visit was https (a tunnel says so): plain-http localhost would drop the cookie.
const proto = req.headers['x-forwarded-proto'];
const isHttps =
  (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ||
  (typeof req.headers['cf-visitor'] === 'string' && req.headers['cf-visitor'].includes('https')) ||
  Array.from(this.allowedOrigins).some((o) => o.startsWith('https://'));
const secure = isHttps ? '; Secure' : '';
```

Beta session cookie:

```ts
            const proto = req.headers['x-forwarded-proto'];
            try {
              enterSession(sessionFor(req, res, (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ?? false));
            } catch (err) {
```

`packages/runner/src/helpers/helper-session.ts`:

```ts
export function isHttpsRequest(req: http.IncomingMessage): boolean {
  if ((req.socket as { encrypted?: boolean } | undefined)?.encrypted) return true;
  const proto = req.headers['x-forwarded-proto'];
  const first = Array.isArray(proto) ? proto[0] : proto;
  if (first?.split(',')[0]?.trim().toLowerCase() === 'https') return true;
  const cfVisitor = req.headers['cf-visitor'];
  return typeof cfVisitor === 'string' && cfVisitor.includes('"https"');
}
```

## Change

1. Add `import { isHttpsRequest } from './helpers/helper-session.js';` to `server.ts` with the other relative imports.

2. Access-key cookie: replace the `const proto = ...; const isHttps = ...;` statements (keep the comment above, and keep the `const secure = ...` line) with:

```ts
const isHttps = isHttpsRequest(req) || Array.from(this.allowedOrigins).some((o) => o.startsWith('https://'));
```

3. Beta session cookie: delete the `const proto = req.headers['x-forwarded-proto'];` line and change the call to:

```ts
enterSession(sessionFor(req, res, isHttpsRequest(req)));
```

4. Check `proto` has no other use left in those two blocks. `grep -n "x-forwarded-proto" packages/runner/src/server.ts` must print nothing afterwards. Run `pnpm exec prettier --write packages/runner/src/server.ts` and `pnpm build`.

## Tests

Edit `packages/runner/tests/access-token.test.ts` (already in the `runner` list of `BROWSER_TESTS`; it starts a `RunnerServer`). The file has a `get(port, path, headers)` helper and a keyed server on `KEYED_PORT`. Add three tests in the `describe` that contains the existing `?access=` test (the one that reads `set-cookie`):

- `'the access cookie is Secure when X-Forwarded-Proto is https'`: `get(KEYED_PORT, \`/?access=${KEY}\`, { 'x-forwarded-proto': 'https' })`; expect status 303 and `String(res.headers['set-cookie'])`toContain`'Secure'`.
- `'the access cookie is Secure when CF-Visitor says https'`: same call with `{ 'cf-visitor': '{"scheme":"https"}' }`; expect `Secure`.
- `'the access cookie is not Secure on plain http'`: same call with `{ 'x-forwarded-proto': 'http' }`; expect `String(res.headers['set-cookie'])` not toContain `'Secure'`.

Run: `pnpm exec vitest run packages/runner/tests/access-token.test.ts packages/runner/tests/helper-session.test.ts packages/runner/tests/beta.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "x-forwarded-proto" packages/runner/src/server.ts` prints nothing.
- [ ] `grep -c "isHttpsRequest" packages/runner/src/server.ts` shows 3.
- [ ] The three test files pass and `pnpm build` passes.

## Notes

- `ui-static.ts` `publicOrigin` is not changed. If the owner picks Option A and also wants it aligned, that is a separate small ticket (it affects canonical links and the sitemap).
- Do not touch `helpers/helper-session.ts`.
