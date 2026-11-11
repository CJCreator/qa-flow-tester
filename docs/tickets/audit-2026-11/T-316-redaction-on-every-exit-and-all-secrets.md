# T-316: Evidence is redacted on every exit, and redaction knows headers, tunnel auth and saved sessions

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/redact.ts`
- `packages/core/src/orchestrator.ts`
- `packages/core/tests/redaction.test.ts`
- `packages/core/tests/orchestrator-redact-every-exit.test.ts` (new)
- `docs/adr/0016-evidence-redaction.md`

**Do not build in parallel with:** T-356 (edits `redact.ts`); T-309, T-356 (all edit `redaction.test.ts`); T-247, T-252, T-309, T-310, T-312, T-318, T-329, T-342, T-358 (all edit `orchestrator.ts`).

## Problem

A Check-up writes evidence while it runs: a DOM snapshot (`page.content()`) and a screenshot after each step (`packages/core/src/evidence.ts:105-110`), repro scripts and logs. ADR 0016 promises that sign-in details are hidden in everything a Check-up keeps.

The orchestrator redacts the evidence folder in exactly one place: `await redactor.files(evidenceDir)` just before the report is built (`packages/core/src/orchestrator.ts:1673`). Every other exit skips it:

- Stop: `stopHere()` closes the browser and throws (`:497-502`, called again at `:648`, `:834`).
- A failed sign-in under consent to full testing (`:517-520`), and a session that cannot be restored mid-run (`:824`).
- Any other error thrown out of `runChecks`. `run()` only closes the browser in its `finally` (`:344-350`).

The runner does not cover these either: on a stop it returns at once (`packages/runner/src/session/checkup-run.ts:488`, `:1069`), and its own `Redactor(...).files(runDir)` runs on the finished path only (`checkup-run.ts:585`).

The orchestrator's `Redactor` is also built from the profile's Roles only (`orchestrator.ts:356`). The run's custom headers (bypass tokens), the tunnel auth value and the values of sessions the person supplied (`RunOptions.customHeaders`, `tunnelAuth`, `suppliedSessions`, `:253`, `:261`, `:315`) are sent with requests but are not hidden from events or evidence. A page that echoes a request header (debug pages, error pages) keeps the bypass token in its DOM snapshot.

## Current code

Branch from `main`. `packages/core/src/orchestrator.ts` (`grep -n "new Redactor\|redactor.files\|async run(options" packages/core/src/orchestrator.ts`):

```ts
  async run(options: RunOptions): Promise<ReleaseReport> {
    try {
      return await this.runChecks(options);
    } finally {
      await this.browserManager.close().catch(() => {});
    }
  }
...
    const redactor = new Redactor(options.profile?.roles || []);
...
    await redactor.files(evidenceDir);
    const report = withPortablePaths(redactor.deep(fullReport), outputDir);
```

`packages/core/src/redact.ts` (`grep -n "export interface RedactorOptions\|MIN_EXTRA_SECRET_LENGTH" packages/core/src/redact.ts`): `RedactorOptions` has only `minSecretLength`. A Role's `headers` and `localStorageEntries` are hidden when 8 characters or longer, with `Bearer `/`Basic `/`Token ` stripped too.

## Change

1. `redact.ts`:
   - Add to `RedactorOptions`: `/** More values to hide: a run's custom header values, tunnel auth, saved session values. Same 8-character floor as Role headers. */ extraSecrets?: string[];`. In the constructor, run each through the same code as a Role header value (strip `Bearer|Basic|Token`, keep values of at least `Math.max(minLength, MIN_EXTRA_SECRET_LENGTH)`). Factor the existing header loop into a small `addExtra(value)` closure and use it for both.
   - Export `storageStateSecrets(state: StorageStateData): string[]` (import the type from `@qa/types`): every cookie `value` and every `origins[].localStorage[].value` that is a string. Unknown shapes are skipped, never thrown on.
2. `orchestrator.ts`:
   - Add a module function:

     ```ts
     /** Everything this run must never write or stream: Role details, header values, tunnel auth, saved sessions. */
     function runRedactor(options: RunOptions): Redactor {
       return new Redactor(options.profile?.roles || [], {
         extraSecrets: [
           ...Object.values(options.customHeaders ?? {}),
           ...(options.tunnelAuth ? [options.tunnelAuth] : []),
           ...Object.values(options.suppliedSessions ?? {}).flatMap(storageStateSecrets),
         ],
       });
     }
     ```

     and `function evidenceDirOf(options: RunOptions): string` returning `path.join(options.outputDir || path.join(process.cwd(), '.qa-report'), 'evidence')`. Use both in `runChecks` in place of the inline `new Redactor(...)` and the inline `evidenceDir` (keep `outputDir` as it is).
   - `run()` builds the redactor and passes it in (`runChecks(options, redactor)`), and redacts in its `finally`, after the browser is closed so nothing writes any more:

     ```ts
     async run(options: RunOptions): Promise<ReleaseReport> {
       const redactor = runRedactor(options);
       let redacted = false;
       try {
         const report = await this.runChecks(options, redactor);
         redacted = true; // runChecks redacted the evidence before it built the report
         return report;
       } finally {
         await this.browserManager.close().catch(() => {});
         // Stop, sign-in failure or error: the evidence already on disk is redacted too (ADR 0016).
         if (!redacted) await redactor.files(evidenceDirOf(options)).catch(() => {});
       }
     }
     ```

   - Keep the existing `await redactor.files(evidenceDir)` before the report: the report must point at redacted files.
3. `docs/adr/0016-evidence-redaction.md`:
   - "Shipped: where it is applied": replace the two `orchestrator.ts` rows (their line numbers are stale) with rows that name the code: `runRedactor` (Roles, custom header values, tunnel auth, supplied session values) for every event; `files(evidenceDir)` before the report and again in `run()`'s `finally` on every other exit.
   - "Known limits": the bullet "A value in a `#fragment` ... is not" and "Base64, HTML entities and other encodings are not" are out of date (`redact.ts:15` matches after `#`, and `secretForms` covers HTML entities and JSON escapes). Rewrite them to say what is matched today; keep "Base64 is not".
4. Run `pnpm exec prettier --write` on the edited files, then `pnpm build`.

## Tests

`packages/core/tests/redaction.test.ts`, new cases:

- `new Redactor([], { extraSecrets: ['bypass-0123456789', 'Bearer tunnel-abcdefgh', 'short'] }).text(...)` hides `bypass-0123456789`, `tunnel-abcdefgh` (bare token) and keeps `short` (under 8 characters).
- `storageStateSecrets({ cookies: [{ name: 'sid', value: 'cookie-value-12345' }, { name: 'x' }], origins: [{ origin: 'https://a.test', localStorage: [{ name: 't', value: 'ls-value-67890' }] }] })` returns both values and skips the cookie with no value.

New file `packages/core/tests/orchestrator-redact-every-exit.test.ts` (no browser; same pattern as `orchestrator-teardown.test.ts`, spying on `BrowserManager.prototype.close` and `PreFlightChecker.prototype.runPreFlight`):

- "a failed pre-flight leaves no secret in the evidence": the mocked `runPreFlight` writes `<outputDir>/evidence/step-1.html` holding the Role password `Hunter2-password!`, the custom header value `bypass-0123456789` and the tunnel value `tunnel-abcdefgh`, then returns `{ ok: false, error: 'boom', ... }`. `run()` rejects with `Pre-flight check failed: boom`; the file no longer contains any of the three values and contains `***`.
- "a stop leaves no secret in the evidence": the mocked `runPreFlight` writes the same file and returns `ok: true` with empty role maps; `signal` is an already-aborted `AbortController`'s signal. `run()` rejects with an AbortError; the file is redacted.
- "a supplied session value is hidden": `suppliedSessions: { member: { cookies: [{ name: 'sid', value: 'cookie-value-12345' }], origins: [] } }` and the evidence file holds `cookie-value-12345`; after the rejected run it does not.

Run: `pnpm exec vitest run packages/core/tests/redaction.test.ts packages/core/tests/orchestrator-redact-every-exit.test.ts packages/core/tests/orchestrator-teardown.test.ts packages/core/tests/visual-redaction.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "redactor.files(evidenceDirOf(options))" packages/core/src/orchestrator.ts` finds the call in `run()`'s `finally`.
- [ ] `grep -n "extraSecrets" packages/core/src/redact.ts packages/core/src/orchestrator.ts` finds the option and its use.
- [ ] `grep -n "is not, because the pattern needs" docs/adr/0016-evidence-redaction.md` prints nothing.
- [ ] The tests above and the core and runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M8 (audit of 11 Nov 2026 on `d225418`).
- The runner's own pass on the finished path (`checkup-run.ts:570-585`, headers and tunnel auth with a 3-character floor) stays; it is now a second layer. Not in this ticket: making the runner use `runRedactor`'s rule.
- Screenshots and videos are still not redacted (ADR 0016 "Known limits"); unchanged.
- Related: T-336 adds orchestrator stop and retry tests in the browser tier; this ticket's tests stay in the unit tier.
