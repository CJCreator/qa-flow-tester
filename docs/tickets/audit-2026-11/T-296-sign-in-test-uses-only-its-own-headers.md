# T-296: The sign-in test sends only its own request's headers, and run secrets are cleared when a run ends

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | security | todo |

**Files you may edit (no others):**

- `packages/runner/src/server.ts`
- `packages/runner/src/session/checkup-run.ts`
- `packages/runner/tests/sign-in-test-headers.test.ts` (new)
- `packages/runner/tests/run-secrets-cleared.test.ts` (new)

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-297, T-298, T-299, T-300, T-301, T-302, T-303, T-308, T-313, T-329, T-331, T-357 (all edit `server.ts`); T-308, T-312, T-313, T-331, T-355, T-358, T-360 (all edit `checkup-run.ts`).

## Problem

The hosted copy is one runner process with one Check-up Session (`session`, declared at `packages/runner/src/server.ts:549`, built once at `:667`). Beta visitors are told apart only by an AsyncLocalStorage id (`packages/runner/src/beta.ts:29`, `enterSession` at `:252`). The custom headers, tunnel sign-in, header hosts and user agent a tester sends with a Check-up go into `session.secrets` (`packages/runner/src/session/checkup-run.ts:1053`) and stay there after the run ends: `RunSecrets.clear()` (`packages/runner/src/session/run-secrets.ts:65`) has no caller anywhere in `packages/`.

The sign-in test (`POST /api/sites/<host>` with `addSignIn` or `testSignIn`, `handleSignInChange` at `server.ts:1987`) opens its browser context with those leftover values (`server.ts:2056-2063`, read through the getters at `server.ts:620-634`). `BrowserManager.createContext` adds them to every request to the same site as `baseUrl` (`packages/core/src/browser.ts:158-186`), and `baseUrl` is the `<host>` from the caller's own path. So on the hosted copy tester B can POST `/api/sites/attacker.example` with any username and password, and the browser sends tester A's bypass headers and tunnel `Authorization` to `attacker.example`. Nothing beyond the shared access key is needed.

On a local runner the same code means a sign-in test silently uses whatever headers the last Check-up left behind.

## Current code

Branch from `main`.

`packages/runner/src/server.ts` (`grep -n "currentHeaderHosts\|currentUserAgent" packages/runner/src/server.ts`), the getters:

```ts
  private get currentHeaderHosts(): string[] | undefined {
    return this.session.secrets.headerHosts;
  }

  private get currentUserAgent(): string | undefined {
    return this.session.secrets.userAgent;
  }
```

and in `handleSignInChange` (`grep -n "const browser = new BrowserManager" packages/runner/src/server.ts`):

```ts
    const browser = new BrowserManager();
    let result: { ok: boolean; landingPath?: string; reason?: SignInFailureReason };
    try {
      const context = await browser.createContext({
        baseUrl: target,
        customHeaders: this.currentCustomHeaders,
        userAgent: this.currentUserAgent,
        tunnelAuth: this.currentTunnelAuth,
        headerHosts: this.currentHeaderHosts,
      });
```

The request body types in `handleSites` (`grep -n "testSignIn?: string;" packages/runner/src/server.ts`, two places: the body in `handleSites` and the parameter of `handleSignInChange`) have no `customHeaders` field. The wizard already sends one when it has it: `testSiteSignIn` in `packages/wizard/src/api.ts:784` posts `{ testSignIn, customHeaders? }` (a header text string).

`packages/runner/src/session/checkup-run.ts` (`grep -n "session.secrets.set({" packages/runner/src/session/checkup-run.ts`):

```ts
      session.secrets.set({
        headers: customHeadersChecked.ok ? customHeadersChecked.value : undefined,
        tunnelAuth: body.tunnelAuth,
        headerHosts: body.headerHosts,
        userAgent: body.userAgent,
      });

      const runPromise = executeRun(
        ...
      ).catch((err: unknown) => {
        if (generation !== session.run.generation || isAbortError(err)) return;
```

`stopRun`, after teardown (`grep -n "const planKept = " packages/runner/src/session/checkup-run.ts`):

```ts
      if (planKept) {
        ...
      } else {
        session.run.setIsRunning(false);
        session.run.setPhase('idle');
        session.run.setTargetUrl(null);
        await session.plan.clear(runId ?? undefined);
      }
```

The `executeTesting` wrapper that Plan approval uses (`grep -n "executeTesting: (...args" packages/runner/src/session/checkup-run.ts`):

```ts
    executeTesting: (...args: Parameters<typeof executeTesting>) => {
      const run = executeTesting(...args);
      currentRunPromise = run.then(
```

## Change

1. `server.ts`, `handleSites`: add `customHeaders?: unknown;` to the POST body type next to `testSignIn?: string;`. Add the same field to the `body` parameter type of `handleSignInChange`.

2. `server.ts`, `handleSignInChange`: just before `const browser = new BrowserManager();`, check the request's own headers with the existing `checkCustomHeaders` (already imported from `./run-inputs.js`):

```ts
    // The sign-in test sends only the headers its own request carries (T-296): never another run's secrets.
    const ownHeaders = checkCustomHeaders(body.customHeaders);
    if (!ownHeaders.ok) {
      this.sendJson(res, 400, { error: ownHeaders.problem.error, code: ownHeaders.problem.code });
      return;
    }
```

   and replace the `createContext` call with:

```ts
      const context = await browser.createContext({ baseUrl: target, customHeaders: ownHeaders.value });
```

3. `server.ts`: delete the `currentHeaderHosts` and `currentUserAgent` getters (their only reader was the call above). Keep `currentCustomHeaders` and `currentTunnelAuth`: `redactedMessage` still reads them.

4. `checkup-run.ts`, inside `createCheckupRun`, next to `waitForTeardown`, add:

```ts
  /**
   * A run that ended (done, failed or stopped) leaves no custom headers, tunnel sign-in or user agent behind
   * (T-296). A Plan waiting for review keeps them: its testing still needs them.
   */
  const forgetRunSecrets = (generation: number): void => {
    if (generation === session.run.generation && session.run.phase !== 'awaiting-review') session.secrets.clear();
  };
```

5. `checkup-run.ts`, `startRun`: chain `.finally(() => forgetRunSecrets(generation))` after the existing `.catch(...)` of `const runPromise = executeRun(...)`. This covers the safe-public path, a run that finishes, and a run that fails. The redaction at the end of `executeTesting` (`new Redactor([...creds, ...headerSecrets]).files(runDir)`) runs inside `executeRun`, so it still sees the headers.

6. `checkup-run.ts`, the `executeTesting` wrapper: change `const run = executeTesting(...args);` to `const run = executeTesting(...args).finally(() => forgetRunSecrets(args[3]));` (`args[3]` is the generation).

7. `checkup-run.ts`, `stopRun`: in the `else` branch above (no Plan kept), add `session.secrets.clear();` after `await session.plan.clear(runId ?? undefined);`. A stop bumps the generation first, so step 5 does not clear for a stopped run; this line does.

8. Run `pnpm exec prettier --write` on the two source files and the two new tests, then `pnpm build`.

## Tests

New file `packages/runner/tests/sign-in-test-headers.test.ts` (unit tier: no Chromium). Start a `RunnerServer` with `beta: true` on `await freePort()` (`./helpers/free-port.js`), `outputDir`/`dataDir` in a scratch folder, and no access key. Stub the browser so nothing launches:

```ts
const seen: Array<Record<string, unknown>> = [];
vi.spyOn(BrowserManager.prototype, 'createContext').mockImplementation(async (opts) => {
  seen.push({ ...(opts ?? {}) });
  throw new Error('no browser in unit tests');
});
```

(`BrowserManager` from `@qa/core`: the test and the server resolve the same module through `sharedResolve`.) Before the cases, put another tester's secrets in the session: `server.session.secrets.set({ headers: { 'X-Alice-Bypass': 'alice-secret-1' }, tunnelAuth: 'alice:pw-2', headerHosts: ['alice.example'], userAgent: 'AliceAgent' })`.

- `POST /api/sites/attacker.example` with `{ addSignIn: { username: 'u', password: 'p' } }` answers 422 with `reason: 'unreachable'`; `JSON.stringify(seen[0])` contains none of `alice-secret-1`, `alice:pw-2`, `alice.example`, `AliceAgent`; `seen[0].customHeaders` is undefined.
- The same request with `customHeaders: 'X-Own: mine'` reaches `createContext` with `customHeaders` equal to `{ 'X-Own': 'mine' }`, and still nothing of Alice's.
- `customHeaders: 'no colon here'` answers 400 with `code: 'ERR_INVALID_HEADERS'`, and `createContext` is not called for it.

New file `packages/runner/tests/run-secrets-cleared.test.ts` (unit tier). Copy the set-up of `packages/runner/tests/checkup-run-teardown.test.ts`: `createCheckupSession` on a `.tmp-…` scratch folder and `createCheckupRun(session, { siteDir, prepareAI })`, so no browser starts. Body: `{ targetUrl: 'https://a.example/', useAI: true, customHeaders: { 'X-Bypass': 'secret-value' }, tunnelAuth: 'user:pass' }`.

- A run whose `prepareAI` throws `new Error('boom')`: after `await run.waitFor(5000)`, `session.secrets.headers` and `session.secrets.tunnelAuth` are undefined and `session.run.phase` is `'failed'`.
- A run parked in `prepareAI` (a gate promise) and then stopped with `run.stop()`: after the gate is released and `stop()` resolves, `session.secrets.headers` is undefined.
- Right after `run.start(...)` (before the run ends) `session.secrets.headers` still equals `{ 'X-Bypass': 'secret-value' }`: the values are there while the run needs them.

Run: `pnpm exec vitest run packages/runner/tests/sign-in-test-headers.test.ts packages/runner/tests/run-secrets-cleared.test.ts packages/runner/tests/checkup-run-teardown.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "currentHeaderHosts\|currentUserAgent" packages/runner/src/server.ts` prints nothing.
- [ ] `grep -n "secrets.clear()" packages/runner/src/session/checkup-run.ts` finds the `forgetRunSecrets` helper and the `stopRun` line.
- [ ] `handleSignInChange` passes only `baseUrl` and the request's own `customHeaders` to `createContext`.
- [ ] Both new tests pass; the runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding H1 (audit of 11 Nov 2026 on `d225418`).
- Behaviour change on a local runner: a sign-in test no longer reuses the last Check-up's headers. A site behind a bypass header needs the header in the request. The wizard's `testSiteSignIn` already accepts a `customHeaders` text; Settings does not pass one yet, and `addSiteSignIn` sends none. A header field for the Settings sign-in form is a separate wizard change, not in this ticket.
- Not in this ticket: the sign-in test's quota and browser limit on the hosted copy (T-300).
- `routes/plan.ts` also reads `session.secrets` (`record.context.customHeaders || session.secrets.headers`), but only for the current run's own Plan, behind `isMine`. Those reads are unchanged.
