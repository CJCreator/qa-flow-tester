# T-317: API spec checks use the guarded fetch, and the outbound grep catches aliased fetch

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/api-spec-checks.ts`
- `packages/core/tests/api-spec-checks.test.ts`
- `packages/core/tests/outbound-source-grep.test.ts`

**Do not build in parallel with:** none.

## Problem

ADR 0031 says page- and site-derived addresses are reached only through the pinned, checked client (`makeOutboundFetch` / `makeGuardedFetch` in `packages/core/src/safe-net.ts`). `runApiChecks` does not follow it:

- It defaults to Node's own fetch: `const doFetch = options.fetchImpl ?? fetch;` (`packages/core/src/api-spec-checks.ts:319`). Nothing checks the address first, so a private or metadata address is reached on a shared copy.
- Each check's address is `new URL(c.url, options.baseUrl)` (`:349`). `c.url` comes from a path key in the supplied OpenAPI file. A path such as `//other.example/collect` or `https://other.example/x` resolves to another host, and the request carries `authorization: options.authHeader` (`:346`), the person's sign-in header for their own API.

It is latent today: the runner calls `runApiChecks(generateApiChecks(undefined), ...)` (`packages/runner/src/server.ts:3133`), so no check is planned. It becomes live the day a spec is wired in.

The guard test that should have caught it, `packages/core/tests/outbound-source-grep.test.ts:19`, only matches a call `fetch(`. An alias (`?? fetch`, `= fetch`) passes unseen. Today the alias form appears in three files: `api-spec-checks.ts:319`, `packages/core/src/ai/openrouter.ts:70` (a fixed AI endpoint) and `packages/core/src/figma-sync.ts:103` (deleted by T-250).

## Current code

Branch from `main`. `packages/core/src/api-spec-checks.ts` (`grep -n "const doFetch\|res = await doFetch\|headers.authorization" packages/core/src/api-spec-checks.ts`):

```ts
  const doFetch = options.fetchImpl ?? fetch;
...
    if (options.authHeader && !c.omitAuth) headers.authorization = options.authHeader;
    let res: Response;
    try {
      res = await doFetch(new URL(c.url, options.baseUrl), {
        method: c.method,
```

`packages/core/src/safe-net.ts` (`grep -n "export function makeGuardedFetch\|export class GuardedFetchBlockedError" packages/core/src/safe-net.ts`): `makeGuardedFetch({ allowPrivate?, maxRedirects?, deps? })` returns a fetch-shaped function that sends **GET only**, pins each hop, and throws `GuardedFetchBlockedError` for a refused address.

`packages/core/tests/outbound-source-grep.test.ts` (`grep -n "name: 'node fetch'" packages/core/tests/outbound-source-grep.test.ts`):

```ts
  { name: 'node fetch', pattern: /(?:(?<![.\w$]|async |function )fetch|\bglobalThis\.fetch)\s*\(/ },
```

## Change

1. `api-spec-checks.ts`:
   - Import `makeGuardedFetch, GuardedFetchBlockedError` from `./safe-net.js`.
   - `RunApiChecksOptions`: add `/** The run's rule for private addresses (a local run only, ADR 0031). Never from request input. */ allowPrivate?: boolean;` and document `fetchImpl` as "Test seam, or a client the caller vouches for. When unset, GET checks go through the guarded fetch and checks that change data are not sent."
   - Replace `const doFetch = options.fetchImpl ?? fetch;` with
     `const doFetch = options.fetchImpl ?? makeGuardedFetch({ allowPrivate: options.allowPrivate, maxRedirects: 0 });`
     and `const base = new URL(options.baseUrl);`.
   - In the loop, before building headers:

     ```ts
     // The spec's path must stay on the API's own origin: `//host/x` or a full address would take the sign-in header elsewhere.
     let target: URL;
     try {
       target = new URL(c.url, base);
     } catch {
       target = new URL('about:blank');
     }
     if (target.origin !== base.origin) {
       offOrigin++;
       continue;
     }
     ```

     and use `target` in the fetch call. After the loop, when `offOrigin > 0`, push `` `${offOrigin} API checks were not sent: their path leaves ${base.origin}.` `` to `result.notChecked`.
   - Writes without a vouched client: when `c.sends && !options.fetchImpl`, count it in `result.skippedWrites` and `continue` (the guarded client sends GET only). Keep the existing `!options.allowWrites` skip.
   - In the `catch` around the fetch: when the error is a `GuardedFetchBlockedError`, push `'API checks were not sent: the API address is not a public web address.'` to `result.notChecked` once and `break` (every check goes to the same origin); otherwise keep today's "no answer" finding.
2. `outbound-source-grep.test.ts`:
   - Add a rule `{ name: 'fetch alias', pattern: /(?:\?\?|\|\||=)\s*(?:globalThis\.)?fetch\b(?!\s*\()/ }`: Node's fetch kept in a variable or used as a default.
   - Add the exception `{ file: 'packages/core/src/ai/openrouter.ts', rule: 'fetch alias', reason: 'OpenRouter API endpoint, fixed address; the constructor parameter is a test seam' }`.
   - In "flags each forbidden call form" add `'const doFetch = options.fetchImpl ?? fetch;'` and `'constructor(private f: typeof fetch = fetch) {}'` to `bad`, and `'const res = await fetchFn(url);'`, `'const x: typeof fetch = fetchFn;'` stay in `fine` (add the second).
3. Run `pnpm exec prettier --write` on the three files, then `pnpm build`.

## Tests

`packages/core/tests/api-spec-checks.test.ts`:

- Existing GET cases run against `127.0.0.1` without a `fetchImpl`: they now go through the guarded fetch, which allows private addresses when no browser guard is set, so they keep passing. Keep them as they are.
- "sends write checks only when writes are allowed": pass `fetchImpl: fetch` (the test vouches for the client) and keep the expectations.
- New "writes are not sent without a vouched client": `allowWrites: true`, no `fetchImpl`; the server sees only GET and `r.skippedWrites > 0`.
- New "a spec path that leaves the origin is not sent, and the sign-in header goes nowhere else": a spec with paths `/items` and `//other.example/steal`, a recording `fetchImpl` (`vi.fn` answering `new Response('[]', { status: 200 })`), `authHeader: 'Bearer s3cret-token-value'`. No recorded URL has host `other.example`; `r.notChecked` has a line containing `leaves`.
- New "a refused address sends nothing": `allowPrivate: false`, base `http://127.0.0.1:<port>` of the local test server; the server records no request and `r.notChecked` has a line containing `not a public web address`; `r.findings` is empty.

`packages/core/tests/outbound-source-grep.test.ts`: the new rule's `bad`/`fine` lines as above; the repository scan passes with only the OpenRouter exception added.

Run: `pnpm exec vitest run packages/core/tests/api-spec-checks.test.ts packages/core/tests/outbound-source-grep.test.ts packages/core/tests/guarded-fetch.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "?? fetch" packages/core/src/api-spec-checks.ts` prints nothing.
- [ ] `grep -n "fetch alias" packages/core/tests/outbound-source-grep.test.ts` finds the rule and the OpenRouter exception.
- [ ] The tests above and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M9 (audit of 11 Nov 2026 on `d225418`).
- Build after T-250. The new grep rule also matches `packages/core/src/figma-sync.ts:103`, which T-250 deletes. Do not touch `figma-sync.ts`, and do not add an exception for it: the scan's stale-exception check would then fail T-250.
- When a spec is wired into the runner later, it must pass `allowPrivate: wiring.localRun`-style run rules, never a value from the request.
