# Website Audit reliability plan: an audit that reads the real site, in parallel, and says what went wrong

Scope: the two open tickets, T-86 (hosted audits for the signed-in owner) and T-89 (proving the audit works). Everything else in the plan is built; the code is the record. Decisions: [ADR 0042](../adr/0042-website-audit-reliability-and-access.md) (reliability and access) and [ADR 0043](../adr/0043-parallel-page-fetching-in-the-website-audit.md) (parallel fetch). Terms: [`CONTEXT.md`](../../CONTEXT.md), including **Interstitial Page**.

## Open findings

| # | Finding | Evidence | Sev | Status |
|---|---|---|---|---|
| A8 | The hosted copy closes every audit row, and hides Website Audits from its navigation | `.github/workflows/deploy.yml:160` (`RUNNER_BETA=1`); `runner/src/routes/route.ts:181`; `wizard/src/components/AreaNav.tsx:52-55`, `TopBar.tsx:121` | major (hosted) | open: T-86 |
| A12 | No automated test covers the real crawl-to-documents path (ADR 0040) | `docs/TESTING.md`; no `audit-crawl-browser.test.ts` or `audit-flow-browser.test.ts` | minor | open: T-89 |

**Owner actions, outside the code:**
- Give the audit a working AI key: an OpenRouter key; a Gemini key saved with "Choose automatically"; or, on a local runner, `adc` for Google sign-in.
- For the fullest results, audit a production build: a dev server behind a tunnel loads the same page in anywhere from 0.65 s to 24 s.

## Waves and parallel safety

Both tickets are wave 4; T-86 shares `server.ts` with built T-85. Each ticket lists the files it may change. Run `pnpm build` after touching `packages/types`, and the ticket's tests and `pnpm format:check` before marking it `built`.

---

## T-86: Hosted audits for the signed-in owner

Findings: A8. Priority P1, size M, wave 4, depends on T-85 (shares `server.ts`). Status after build: `human` (one GitHub variable to set).

**Files:**
- runner: `packages/runner/src/routes/route.ts`, `packages/runner/src/helpers/helper-access.ts`, `helpers/helper-session.ts`, `packages/runner/src/server.ts` (owner on beta; `auditOwner` in `/api/runner/status`);
- wizard: `packages/wizard/src/screens/audit/BetaAuditNotice.tsx`, `packages/wizard/src/App.tsx`, `packages/wizard/src/components/AreaNav.tsx`, `packages/wizard/src/components/TopBar.tsx`;
- deploy: `.github/workflows/deploy.yml`, `docs/CONFIGURATION.md`, `docs/DEPLOYMENT.md`;
- tests: `packages/runner/tests/adr-0037-0015.test.ts`, `route-access.test.ts`, `helper-access.test.ts`, and `packages/wizard/tests/audit-nav.test.tsx`.

**Scope:**
- **Owner on a beta copy:** whoever holds the access key, or a Google sign-in (the existing Helper sign-in) whose email is in `AUDIT_OWNER_EMAILS`. Such a caller passes `owner` audit rows on the beta copy. Everyone else is refused as today.
- **`AUDIT_DAILY_LIMIT`:** audit starts per owner email per UTC day. Unset means unlimited. Reaching it answers `ERR_BETA_LIMIT`.
- **Wizard:**
  - `/api/runner/status` gains `auditOwner`;
  - `showsBetaAuditNotice` (`BetaAuditNotice.tsx:38-41`) and the beta-hidden Website Audits area (`TopBar.tsx:121`, `AreaNav.tsx:52-68`, the `beta` props in `App.tsx`) show the area to an owner;
  - the notice gets a "Sign in with Google" action that reuses `HelperSignInScreen` and `firebase-sign-in.ts`.
- **`deploy.yml`:** passes `AUDIT_OWNER_EMAILS` from a GitHub variable. CPU stays request-based.

**Tests:** an allow-listed email is allowed and another is refused; Helper grants are unchanged; the limit; the notice and the area are shown or hidden.

**Human step:** set the repository variable `AUDIT_OWNER_EMAILS` to the owner's Google email, then deploy.

---

## T-89: Proving the audit works

Findings: A12. Priority P1, size M, wave 4, depends on T-84, T-85, T-87, T-88.

**Files:** `packages/core/tests/audit-crawl-browser.test.ts` (new), `packages/runner/tests/audit-flow-browser.test.ts` (new), `vitest.workspace.ts` (add both to the browser list), `scripts/smoke-audit.mjs` (new), root `package.json` (the `smoke:audit` script), `docs/TESTING.md`.

**Scope:**
- **Browser tier** (ADR 0040: `context.route().fulfill()` pages only), through the existing `deps.browserManager` and `deps.launchBrowser` seams:
  - a 12-page site is recorded in full, with at most 3 pages in flight;
  - a robots Crawl-delay drops it to 1 in flight;
  - a 503-then-200 page is retried and recorded;
  - a 500 page becomes a Skipped Page and a finding;
  - a run of network failures pauses the crawl, which then resumes;
  - a challenge page that never clears gives `ERR_SITE_BLOCKED`;
  - the runner flow from start to stored documents.
- **`pnpm smoke:audit <url> [--pages N]`:** starts an audit on a running runner, then prints:
  - each stage with its time;
  - pages recorded, and pages skipped by reason;
  - the AI status, the speed source, and the documents written.
  It exits non-zero on `failed`, or on `done` with an `only-one-page` note.
- **`docs/TESTING.md`**, "Website Audit by hand":
  - `example.com`;
  - `htmx.org` (`--pages 10`);
  - a Vite dev server on `localhost`, which listens on `::1` only;
  - a dev tunnel;
  - a bot-protected site, expected to give the blocked message;
  - with and without a working AI key;
  - the hosted copy, signed in.

**Tests:** both browser files pass under `pnpm test:browser`; `pnpm test` stays browser-free.
