# T-312: Certificate errors are ignored only for local and test hosts, and reported otherwise

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/browser.ts`
- `packages/core/src/navigate.ts`
- `packages/core/src/orchestrator.ts`
- `packages/core/src/discovery/discovery-agent.ts`
- `packages/runner/src/session/plan-store.ts`
- `packages/runner/src/session/checkup-run.ts`
- `packages/core/tests/certificate-errors.test.ts` (new)

**Do not build in parallel with:** T-251, T-307, T-308, T-358 (all edit `browser.ts`); T-251 (edits `navigate.ts`); T-296, T-308, T-313, T-331, T-355, T-358, T-360 (all edit `checkup-run.ts`); T-247, T-252, T-309, T-310, T-316, T-318, T-329, T-342, T-358 (all edit `orchestrator.ts`); T-240, T-332, T-358 (all edit `discovery-agent.ts`); T-352 (edits `plan-store.ts`).

## Problem

Every browser context the Check-up opens ignores certificate errors: `ignoreHTTPSErrors: true` in `BrowserManager.createContext` (`packages/core/src/browser.ts:154`). Two things follow:

- **An expired or wrong certificate on a live App never becomes a finding.** Visitors get a full-page browser warning instead of the site, but the report says the pages work. The runner's own requests do check certificates (Node's default), so the checker fetches fail quietly at the same time.
- **Secrets go over unverified TLS.** Custom bypass headers and tunnel auth (`browser.ts:177-190`), Role headers and tokens, and typed sign-in details are sent to whoever answers the TLS handshake, with no check of the certificate.

Ignoring certificate errors is right for this machine, a private network, and a Test Copy with a self-signed certificate. It is not right for a live App.

## Owner decision (open)

When should the browser ignore certificate errors?

- **A. Only for this machine, a private network, and a Test Copy (recommended default).** Everywhere else the browser checks the certificate. When a page's own address fails the check, the Check-up reports one Security finding ("The site's certificate is not valid", Blocker: visitors see a browser warning instead of the page), not a generic "couldn't run".
- **B. Keep ignoring them, and add a separate certificate check** (a Node TLS connection to the host that reports expiry, name and chain). Secrets still go over unverified TLS during the run.
- **C. Leave it.**

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`. Build after T-307 (same file: `browser.ts`).

`packages/core/src/browser.ts` (`grep -n "ignoreHTTPSErrors" packages/core/src/browser.ts`):

```ts
      baseURL: options.baseUrl,
      ignoreHTTPSErrors: true,
```

`packages/core/src/navigate.ts` (`grep -n "function classifyError" -A 17 packages/core/src/navigate.ts`): a certificate error (`net::ERR_CERT_DATE_INVALID`, `net::ERR_CERT_COMMON_NAME_INVALID`, `net::ERR_CERT_AUTHORITY_INVALID`...) falls into `kind: 'net'` with every other network error:

```ts
  if (/net::ERR_|connection refused|ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(message)) {
    return { kind: 'net' };
  }
```

`packages/core/src/orchestrator.ts` (`grep -n "Failed to load \${testCase.startPage}" packages/core/src/orchestrator.ts`) throws, and the catch builds a generic `couldNotRun` finding (`grep -n "const couldNotRun: Finding" packages/core/src/orchestrator.ts`; checker `bug-detection`, severity Major).

Test Copy status is known only in the runner: `const { readOnly, signInConsent: consent, testCopy: testHost } = authorization;` (`grep -n "testCopy: testHost" packages/runner/src/session/checkup-run.ts`). It is not stored in the run context (`StoredPlanRecord['context']`, `packages/runner/src/session/plan-store.ts:18-50`) and not passed to core. `readOnly` is not a substitute: with sign-in consent on the person's own computer (ADR 0022) a live App runs with `readOnly: false`.

## Change

1. `browser.ts`:
   - Add `trustInvalidCertificates?: boolean` to `BrowserOptions` (`/** The App is a Test Copy: a self-signed certificate is accepted (T-312). */`) and a public field `trustInvalidCertificates = false` on `BrowserManager`, used when the option is absent.
   - Add, import-free apart from `address-class.js`:

```ts
/** Certificate errors are ignored only on this machine, a private network, or a Test Copy. */
export function ignoresCertificateErrors(baseUrl: string | undefined, testCopy: boolean): boolean {
  if (testCopy) return true;
  try {
    const host = new URL(baseUrl ?? '').hostname;
    return isPrivateTextHost(host) || classifyAddress(host) !== null;
  } catch {
    return false;
  }
}
```

   - In `createContext`: `ignoreHTTPSErrors: ignoresCertificateErrors(options.baseUrl, options.trustInvalidCertificates ?? this.trustInvalidCertificates),`.

2. `navigate.ts`: add `'tls'` to the `error.kind` union of `NavigateResult` and to `classifyError`'s return type. Before the `net::ERR_` branch, add `if (/net::ERR_(CERT_|SSL_|BAD_SSL)/i.test(message)) return { kind: 'tls' };`. A certificate does not fix itself on a retry: in `navigate`'s catch, end at once for `'tls'` as for `'aborted'` (`if (errInfo.kind === 'aborted' || errInfo.kind === 'tls' || isLastAttempt)`). The Spider's skip code passes the kind through as the Skipped Page detail, so a start page with a bad certificate shows `tls` there with no change in the Spider.

3. `discovery-agent.ts`: add `testCopy?: boolean` to `DiscoveryOptions` (`/** The App is a Test Copy (the runner decides): its certificate may be self-signed. */`). At the start of `discoverSite`, set `this.browserManager.trustInvalidCertificates = options.testCopy === true;`.

4. `orchestrator.ts`:
   - Add `testCopy?: boolean` to `RunOptions` (same comment). At the start of `runChecks`, set `this.browserManager.trustInvalidCertificates = options.testCopy === true;`.
   - In the catch that builds `couldNotRun`: when `startPageNavResult?.error?.kind === 'tls'`, build instead a Security finding, once per run per host (use the existing `siteWide` set with key `tls:<host>`; later test points on the same host get the usual `couldNotRun` with the reason "the site's certificate is not valid"):

```ts
{
  id: `F-TLS-${host}`,
  testCaseId: testCase.id,
  flowId: testCase.flowId,
  severity: 'Blocker',
  checker: 'security',
  title: 'The site’s certificate is not valid',
  where: { urlPath: testCase.startPage, role: testCase.role, breakpoint: bp },
  expectedVsActual: { expected: `A valid HTTPS certificate for ${host}`, actual: code }, // code: the net::ERR_… name only
  stepsToReproduce: [`Open ${testCase.startPage} in a browser`],
  evidence: {},
  resolution: 'Renew or fix the certificate (expired, wrong name, or not from a trusted authority). Browsers show a full-page warning instead of the page.',
}
```

   `code` is `/net::ERR_[A-Z_]+/.exec(startPageNavResult.error.detail ?? '')?.[0] ?? 'certificate error'`; never the full message.

5. `plan-store.ts`: add `testCopy?: boolean;` to `StoredPlanRecord['context']` next to `readOnly`.

6. `checkup-run.ts`: store `testCopy: testHost` in the run context (next to `readOnly`, `grep -n "signInConsent: consent && !readOnly" packages/runner/src/session/checkup-run.ts`), pass `testCopy: testHost` to `discoverWithSession(...)` (next to `readOnly,`), and `testCopy: context.testCopy` to the orchestrator's run options (next to `readOnly: context.readOnly`).

7. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/core/tests/certificate-errors.test.ts` (unit tier, no Chromium):

- `ignoresCertificateErrors`: true for `https://localhost:8443/`, `https://app.localhost/`, `https://127.0.0.1/`, `https://192.168.1.20/`, `https://[::1]/`; false for `https://example.com/` and `https://8.8.8.8/`; true for `https://staging.example.com/` when `testCopy` is true; false for `undefined` and a bad address.
- `BrowserManager.createContext` with Playwright mocked as in `safe-crawler-guard.test.ts` (`vi.mock('playwright', ...)`, a fake browser whose `newContext` records its options and returns `{ route: async () => {}, routeWebSocket: async () => {} }`): `baseUrl: 'https://example.com/'` → `ignoreHTTPSErrors: false`; `baseUrl: 'https://localhost:3000/'` → `true`; `baseUrl: 'https://example.com/'` with the manager's `trustInvalidCertificates = true` → `true`; the per-call option `trustInvalidCertificates: false` wins over the field.
- `navigate` classifies a certificate error: a fake `Page` (`goto`, `isClosed: () => false`, `url: () => ''`) whose `goto` rejects with `new Error('page.goto: net::ERR_CERT_DATE_INVALID at https://expired.example/')` → `result.ok === false`, `result.error.kind === 'tls'` and `result.attempts === 1` even with the default one retry. A rejection with `net::ERR_CONNECTION_REFUSED` still gives `'net'`.

Run: `pnpm exec vitest run packages/core/tests/certificate-errors.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "ignoreHTTPSErrors: true" packages/core/src/browser.ts` prints nothing.
- [ ] `grep -n "kind: 'tls'" packages/core/src/navigate.ts` finds the new kind.
- [ ] `grep -n "F-TLS-" packages/core/src/orchestrator.ts` finds the Security finding.
- [ ] `grep -n "testCopy" packages/runner/src/session/plan-store.ts packages/runner/src/session/checkup-run.ts` finds the stored and passed flag.
- [ ] The new test and the core and runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M7 (audit of 11 Nov 2026 on `d225418`).
- Size changed from S to M: Test Copy status has to travel from the runner to core (two options and one stored field) before the browser can use it.
- Other `BrowserManager`s (the runner's sign-in test, `server.ts`; the Plan routes' page loads, `routes/plan.ts`) keep the field's default and use only the local-address rule: a self-signed Test Copy on a public name fails its sign-in test with a certificate error. That is acceptable; T-296 reworks the sign-in test.
- The Website Audit's own browser also sets `ignoreHTTPSErrors: true` (`packages/core/src/audit/crawl/crawl.ts:362`). It only reads pages and sends no secrets; reporting certificate problems in a Website Audit is a separate decision.
- When the start page itself fails, the scan finds no pages and shows a Skipped Page with detail `tls`; a clearer scan message is a follow-up.
- T-307 and T-308 also edit `browser.ts`; T-309, T-310 and others edit `orchestrator.ts`.
