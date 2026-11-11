# T-300: One browser-launch limit and an event-stream cap on the hosted copy; sign-in tests and smoke runs count against the quota

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | runner | security | todo |

**Files you may edit (no others):**

- `packages/runner/src/browser-gate.ts` (new)
- `packages/runner/src/server.ts`
- `packages/runner/src/beta.ts`
- `docs/CONFIGURATION.md`
- `packages/runner/tests/beta-side-limits.test.ts` (new)

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-301, T-302, T-303, T-308, T-313, T-329, T-331, T-357 (all edit `server.ts`); T-259, T-299, T-301 (all edit `beta.ts`); T-301, T-302, T-313, T-373 (all edit `CONFIGURATION.md`).

## Problem

The hosted copy is one Cloud Run instance with 2 GiB and 1 CPU (`--memory 2Gi --cpu 1 --max-instances 1 --timeout 3600`, `.github/workflows/deploy.yml:200-201`). A Check-up, comparison or Website Audit holds the one run slot, so only one of them drives Chromium at a time. Three things sit outside that bound:

1. **Sign-in tests.** Every `POST /api/sites/<host>` with `addSignIn` or `testSignIn` starts its own Chromium (`new BrowserManager()`, `packages/runner/src/server.ts:2054`), with no slot and no quota. Any number of testers (or one tester in a loop) can start Chromiums in parallel and run the instance out of memory, which also kills the Check-up in progress.
2. **Event streams.** `GET /api/runner/stream` adds every response to `streamClients` with no limit (`server.ts:1134-1158`). Each open stream is a request Cloud Run counts against the instance's concurrent-request limit (the deploy sets no `--concurrency`, so Cloud Run's default applies). One visitor holding many streams open can leave no room for anyone else's requests.
3. **Smoke Check-ups.** The smoke preset runs and answers before the beta quota is checked (`server.ts:3117-3144`; `betaLimitHit` is called only later, at `server.ts:3240`). On the hosted copy a visitor can run Smoke Check-ups without limit.

## Current code

Branch from `main`.

`packages/runner/src/server.ts`, the sign-in test (`grep -n "const browser = new BrowserManager" packages/runner/src/server.ts`):

```ts
    const browser = new BrowserManager();
    let result: { ok: boolean; landingPath?: string; reason?: SignInFailureReason };
    try {
      const context = await browser.createContext({
        ...
      });
      result = await new PreFlightChecker().signIn(context, target, credential);
    } catch {
      result = { ok: false, reason: 'unreachable' };
    } finally {
      await browser.close();
    }
```

The stream (`grep -n "this.streamClients.add(res)" packages/runner/src/server.ts`):

```ts
          // GET /api/runner/stream (Server-Sent Events)
          if (pathname === '/api/runner/stream' && req.method === 'GET') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              ...
            this.streamClients.add(res);
            if (this.beta) this.streamSessions.set(res, currentSessionId());
```

The smoke preset (`grep -n "if (body.preset === 'smoke')" packages/runner/src/server.ts`):

```ts
    // Smoke Check-up: a few read-only GETs, no browser, no plan. Runs here and answers with the report.
    if (body.preset === 'smoke') {
      try {
        const result = await runPostDeploySmoke({
```

`betaLimitHit`'s doc comment (`grep -n "Beta only: counts this start" packages/runner/src/server.ts`) says "Counted: check-up and comparison starts."

`packages/runner/src/beta.ts:181`, the visitor's limit message: "You have used your ${limit} check-ups for today on this shared copy (a comparison counts as one)."

`docs/CONFIGURATION.md:19`, `RUNNER_BETA_RUNS_PER_VISITOR`: "most check-ups plus comparisons one visitor may start per UTC day".

## Change

1. New file `packages/runner/src/browser-gate.ts`:

```ts
/**
 * A limit on browsers started outside the run slot (today: the sign-in test, T-300). A Check-up, comparison or
 * Website Audit already holds the one run slot, so it is not counted here. One instance per runner process.
 */
export class BrowserGate {
  private inUse = 0;

  constructor(readonly limit: number) {}

  /** A release function when a place is free, or null when all are taken. Calling release twice frees one place. */
  tryAcquire(): (() => void) | null {
    if (this.inUse >= this.limit) return null;
    this.inUse++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse--;
    };
  }

  get active(): number {
    return this.inUse;
  }
}
```

2. `server.ts`: import `BrowserGate`; add `private sideBrowsers: BrowserGate;` beside `streamClients`, set in the constructor after `this.beta` is known: `this.sideBrowsers = new BrowserGate(this.beta ? 1 : 2);`. Add two module constants near `TICK_BUDGET_MS`:

```ts
/** Open event streams per visitor on a beta copy, and in total on any copy (T-300). Each one holds a Cloud Run request. */
const MAX_STREAMS_PER_VISITOR = 4;
const MAX_STREAMS = 40;
```

3. `server.ts`, `handleSignInChange`: directly before `const browser = new BrowserManager();` (after T-296's header check when that ticket is in):

```ts
    // One sign-in test browser at a time on the hosted copy, two locally; a run's browser has its own slot (T-300).
    const release = this.sideBrowsers.tryAcquire();
    if (!release) {
      res.setHeader('Retry-After', '30');
      this.sendJson(res, 429, {
        error: 'Another sign-in test is running on this copy. Try again in a minute.',
        code: 'ERR_BUSY',
      });
      return;
    }
    // On the hosted copy a sign-in test opens a browser, so it counts like a check-up start.
    if (this.betaLimitHit(res)) {
      release();
      return;
    }
```

   and change the existing `finally { await browser.close(); }` to `finally { await browser.close(); release(); }`.

4. `server.ts`, the smoke preset: make `if (this.betaLimitHit(res)) return;` the first line inside `if (body.preset === 'smoke') {`. `refuseTarget` and the scheme check run before it, as `betaLimitHit` asks.

5. `server.ts`, the stream: add a private method

```ts
  /** True when this request may not open another event stream: too many on the copy, or (beta) for this visitor. */
  private streamRefused(): boolean {
    if (this.streamClients.size >= MAX_STREAMS) return true;
    if (!this.beta) return false;
    const me = currentSessionId();
    let mine = 0;
    for (const owner of this.streamSessions.values()) if (owner === me) mine++;
    return mine >= MAX_STREAMS_PER_VISITOR;
  }
```

   and, as the first lines inside `if (pathname === '/api/runner/stream' && req.method === 'GET') {`:

```ts
            if (this.streamRefused()) {
              res.setHeader('Retry-After', '30');
              this.sendJson(res, 429, {
                error: 'Too many progress streams are open. Close another tab of this page and try again.',
                code: 'ERR_TOO_MANY_STREAMS',
              });
              return;
            }
```

6. `server.ts`, `betaLimitHit`'s doc comment: change "Counted: check-up and comparison starts." to "Counted: check-up and comparison starts, sign-in tests (each opens a browser) and Smoke Check-ups."

7. `beta.ts:181`: change "(a comparison counts as one)" to "(a comparison, a sign-in test and a Smoke Check-up each count as one)".

8. `docs/CONFIGURATION.md`, the `RUNNER_BETA_RUNS_PER_VISITOR` row: change "most check-ups plus comparisons one visitor may start per UTC day" to "most check-ups, comparisons, sign-in tests and Smoke Check-ups one visitor may start per UTC day".

9. Run `pnpm exec prettier --write` on the changed files and the new test, then `pnpm build`.

## Tests

New file `packages/runner/tests/beta-side-limits.test.ts` (unit tier: no Chromium, no outside network).

`BrowserGate`:

- With `limit: 1`, the first `tryAcquire()` returns a function, the second returns `null`; after calling the release, `tryAcquire()` works again; calling one release twice leaves `active` at 0, not -1.

A `RunnerServer` with `beta: true`, `port: await freePort()`, `hostChecks: { lookup: async () => ['93.184.216.34'], connect: async () => Promise.reject(new Error('no')) }` and `betaLimits: { perVisitor: 2, perDay: 40 }`. Stub the browser with `vi.spyOn(BrowserManager.prototype, 'createContext')` (from `@qa/core`) so nothing launches. Call `resetBetaUsage()` (`../src/beta.js`) in `beforeEach`. Each visitor keeps the `qa_session` cookie of its first answer (see `newSession()` in `beta-privacy.test.ts`).

- **Smoke counts.** Use up the visitor's count with `claimBetaRun(id, { limits: { perVisitor: 2, perDay: 40 } })` twice. `POST /api/runner/run` with `{ targetUrl: 'https://example.com/', preset: 'smoke' }` answers 429 with `code: 'ERR_BETA_LIMIT'` (nothing is fetched: the limit is checked first).
- **Sign-in test counts.** With the count used up, `POST /api/sites/example.com` with `{ addSignIn: { username: 'u', password: 'p' } }` answers 429 `ERR_BETA_LIMIT`, and `createContext` is not called.
- **One sign-in browser at a time.** Make `createContext` wait on a gate promise, then throw. Start one sign-in test (do not await it), wait until `createContext` has been called, then a second visitor's sign-in test answers 429 with `code: 'ERR_BUSY'` and a `retry-after` header. Release the gate: the first answers 422 (`reason: 'unreachable'`), and a third sign-in test reaches `createContext` again.
- **Stream cap.** Open 4 streams with one visitor's cookie (status 200 each); the 5th answers 429 with `code: 'ERR_TOO_MANY_STREAMS'`. Another visitor still gets a stream. Close every stream at the end (`req.destroy()`).

Run: `pnpm exec vitest run packages/runner/tests/beta-side-limits.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm exec vitest run packages/runner/tests/beta.test.ts packages/runner/tests/beta-privacy.test.ts` (browser tier: both open streams and count starts), then `pnpm build`.

## Done when

- [ ] `grep -n "sideBrowsers.tryAcquire" packages/runner/src/server.ts` finds the sign-in test's acquire.
- [ ] `grep -n "streamRefused" packages/runner/src/server.ts` finds the method and its use in the stream handler.
- [ ] Inside the smoke branch, `betaLimitHit` comes before `runPostDeploySmoke`.
- [ ] The new test, the runner unit tests and the two beta browser tests pass; `pnpm build` passes.

## Notes

- Audit finding M1 (audit of 11 Nov 2026 on `d225418`).
- A Smoke Check-up's own refusal (`result.refused`) now comes after the count, so a refused smoke run costs one start. `refuseTarget` already refuses private addresses before the count, which is the usual case.
- With 5 starts per visitor a tester who adds two Roles and tests each spends four. If that proves tight, raise `RUNNER_BETA_RUNS_PER_VISITOR`; it needs no code change.
- The Plan routes that open a browser while a Plan waits (`crawlMore` and add-sign-in in `packages/runner/src/routes/plan.ts:610`, `:798`) are not gated here: only the run's owner reaches them, one Plan at a time. Their known gap is already written in `betaLimitHit`'s comment.
- Related: T-296 (the sign-in test sends only its own headers) edits the same lines of `handleSignInChange`; T-301 (quotas survive a restart) edits `beta.ts` and the same `docs/CONFIGURATION.md` row.
