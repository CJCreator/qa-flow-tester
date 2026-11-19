# Hosted Pilot (2026-11)

Source: [ADR 0050](../../adr/0050-hosted-pilot-vercel-front-door.md), owner's grilling answers, 2026-11-19.
Goal: outside testers open the Vercel site, sign in with Google, paste their own AI key and run a Check-up on the
`qa-check-up` Cloud Run runner, which sleeps when idle.

## Lanes
`server.ts` is shared by most runner tickets, so they run in one serial lane.

- **Lane A (runner, serial):** T-434 → T-435 → T-436 → T-437 → T-438.
- **Lane B (front door and deploy, parallel to A):** T-433 → T-439 → T-440. Lane B owns `vercel.json` files,
  `.github/workflows/deploy.yml`, `scripts/deploy-cloud-run.mjs`, `site/`, deploy docs, the wizard landing/online
  files and the three tests that parse `deploy.yml`. Lane A must not touch those; Lane B must not touch
  `packages/runner/src/**` except `cli.ts` env reading if T-433 needs it (coordinate in the ticket).

## T-433: Vercel forwards the runner's paths (prove the proxy first)
- Root `vercel.json` is the Vercel project `qa-flow-tester` (https://qa-flow-tester.vercel.app; Root Directory `.`, Build `pnpm run site-build`, Output `public`). `packages/wizard/vercel.json` is deleted (unused project).
- Build runs `pnpm site-build`-equivalent so `%ORIGIN%` is filled (from `VERCEL_PROJECT_PRODUCTION_URL` or `SITE_ORIGIN`) and `version.json` exists; output the same files nginx served.
- Rewrites, in order: `/api/:path*` → `${RUNNER_URL}/api/:path*`, `/r/:path*`/other runner-only public paths (check `routes/audit-share-routes`) → runner, then the SPA catch-all. Rewrites cannot read env vars, so the runner URL is written into `vercel.json` (it is public: `https://qa-check-up-cnhl7suwnq-uc.a.run.app`).
- Headers: port `site/nginx.conf`'s CSP and cache headers to `vercel.json` `headers`; CSP must allow Firebase (`identitytoolkit`, `securetoken`, `apis.google.com`, the auth domain frame).
- Runner side (config only): the Vercel origin joins `RUNNER_ALLOWED_ORIGINS`; `RUNNER_TRUSTED_PROXY_HOPS` left at its default 1 (review, see T-439). Confirm the Host Vercel forwards passes the Host check (`server.ts` ~1024-1043; Cloud Run host passes via `K_SERVICE`).
- Wizard: when the runner is same-origin, the first `/api/runner/status` that is slow or 5xx shows a "Waking up, this takes up to a minute" state and retries for `VITE_WAKE_LIMIT_SECONDS` (`lib/online.ts`, `useWakeOnline.ts`).
- Absolute URLs: Shared Links, evidence URLs and redirects must not build from the runner's Host (would leak `run.app`); use the request's `x-forwarded-host` only when listed in allowed origins, or relative URLs.
- Proof (manual, on a Vercel preview, before Lane A builds on it): POST passes Origin check, `Set-Cookie` is first-party, SSE streams and resumes, a cold start answers inside 120 s. Record results in this file.

**Built (Lane B, 2026-11-19).**
- Root `vercel.json` (keeps its git switch; `packages/wizard/vercel.json` deleted): `buildCommand` `pnpm run site-build`, `outputDirectory` `public`. `scripts/site-output.mjs` got `resolveOrigin` (and an unused-here `--in-place` option): `SITE_ORIGIN`, else `https://$VERCEL_PROJECT_PRODUCTION_URL`; `version.json` commit from `GITHUB_SHA` or `VERCEL_GIT_COMMIT_SHA`). Rewrites: `/api/:path*` and `/s/:path*` (the Shared Link page, the only runner-only public page path; `/version.json` is the site's own) to `https://qa-check-up-cnhl7suwnq-uc.a.run.app`, then the SPA catch-all. `/healthz` is not forwarded. Headers ported from `site/nginx.conf` (CSP enforced, plus Firebase: `apis.google.com` script, `identitytoolkit`/`securetoken`/`www.googleapis.com` connect, `*.firebaseapp.com`/`*.web.app`/`accounts.google.com` frames). The page headers skip `/api/` and `/s/`, so the runner keeps its own headers (the `/s/` CSP is per response).
- Wizard: `probeStatus` (api.ts), `lib/wake.ts`, `useRunnerConnection` `wake` state, `components/WakingScreen.tsx` ("Waking up, this can take up to a minute"): shown when `/api/runner/status` fails with 5xx, or gives no answer in 4 s on a non-localhost host; polls every 3 s; after `VITE_WAKE_LIMIT_SECONDS` the same screen says it is taking longer, and polling continues.
- Absolute URLs: no runner change needed. Evidence URLs are relative (`evidence-url.ts`), redirects use relative `Location`, the Shared Link address is built in the wizard from `window.location.origin` (`share-api.ts`), and `publicOrigin` (`ui-static.ts`) is used only for pages the runner itself serves (not served through Vercel). `x-forwarded-host` is not read anywhere.
- Runner-side config (done in T-439): the Vercel origin joins `RUNNER_ALLOWED_ORIGINS`, `RUNNER_TRUSTED_PROXY_HOPS` left at its default 1 (review, see T-439). Host check read at `server.ts` ~1024-1050: Vercel's rewrite sends the run.app host, which passes via `K_SERVICE` + `.run.app`; the browser's `Origin` (the Vercel site) is not the Host, so it passes only through `RUNNER_ALLOWED_ORIGINS`: set `vars.VERCEL_SITE_URL` before the first deploy or every POST is refused with 403. The `Secure` cookie flag is set because an allowed origin starts with `https://`.
- Tests: `packages/wizard/tests/vercel-config.test.ts`, `wake-state.test.ts`; `packages/runner/tests/site-output.test.ts` (extended).

**Manual proof checklist (owner, on a Vercel preview).**
1. Vercel project `qa-flow-tester` (Root Directory `.`, Build `pnpm run site-build`, Output `public`; origin https://qa-flow-tester.vercel.app): env `VITE_FIREBASE_*` (see `docs/DEPLOYMENT.md`), no `VITE_ONLINE_APP_URL`. Deploy a preview (git deploys for `lane/*` and `worktree-*` are off: deploy that branch from the CLI or rename it).
2. The page loads; view-source shows no `%ORIGIN%`; `/version.json` answers with a commit.
3. Add the preview's origin to `RUNNER_ALLOWED_ORIGINS` on the runner (one-off `gcloud run services update`), `RUNNER_TRUSTED_PROXY_HOPS` left at its default 1 (review, see T-439).
4. Open `/api/runner/status` on the preview: JSON from the runner (not index.html).
5. Start a Check-up: the POST passes the Origin check (no 403); DevTools shows `Set-Cookie` on the preview's own host, then the cookie sent on the next call.
6. Live progress (SSE `/api/runner/stream`) streams; cut the network for a few seconds: it resumes.
7. Cold start: let the runner idle to zero, open the preview: the "Waking up" screen shows, then the app loads, inside 120 s.
8. Shared Link `/s/<id>` opens through the preview and shows no `run.app` address in the page or its links.
9. Record each result below.

Results: (owner to fill in)

## T-434: A signed-in Google account is a way in
- Read ADR 0037 first. Add a route access level `account` (signed-in, verified Google email) to the route table; check-up routes (`/api/runner/run`, status, stream, plan review, runs, report, evidence, domain proof, AI key entry) accept it in beta. Route-inventory tests enforce it.
- `HelperAccess.enabled` must work for accounts; the sign-in cookie signing key comes from env `RUNNER_SESSION_SECRET` (Secret Manager `qa-session-secret`), falling back to the random key when unset (local). Cookie lifetime 7 days for accounts.
- Wizard: on the hosted copy, starting a Check-up without an account shows "Sign in with Google" (reuse `firebase-sign-in.ts`, `startHelperSession`).
- The shared access key keeps working for owner and CI.
- Tests beside `helper-access.test.ts`, `route-access-server.test.ts`, `route-inventory.test.ts`, `helper-session.test.ts`.

**Built (T-434).** Route access level `account` (`routes/route.ts`, `RouteCaller.account`, 401 `ERR_ACCOUNT_REQUIRED`); the 11 plan rows are now `account`. Inline Check-up paths an account may reach: `routes/account-paths.ts` (default closed). Account mode = `RUNNER_SESSION_SECRET` (32+ chars) + `FIREBASE_PROJECT_ID` (`HelperAccess.accounts`): sign-in works without the key, cookie key = SHA-256 of the secret, 7 days; without it, random key, 8 h, Helper behaviour unchanged. Beta only. Anonymous `GET /api/runner/status` answers a reduced reply with `accounts: true, account: null` (no visitor session made); signed-in gets the real scoped status plus `account` email. Wizard: `AccountSignInScreen` replaces the new check-up form while `status.accounts && !status.account`. Tests: new `account-access.test.ts` (unit + beta server); `route-access.test.ts` plan-row expectation changed owner to account (contract change). Env: `.env.example`, `docs/CONFIGURATION.md`.

**Review fixes (T-434).** Key holders get `viaKey: true` on status and the wizard skips the sign-in screen for them; account-reachable AI paths cut to `/api/ai/settings`, `/api/ai/openrouter/key` and `/api/ai/openrouter/validate` (the real names of the key and validate routes; validate checks only the key sent in the body); a `qa_session` bound to one account is never reused for another account, a signed-out visitor or the key (`sessionFor` gets a fresh session); probe test removed. Tests in `account-access.test.ts`.

## T-435: Limits and Verified Domain proof follow the account, saved in the bucket
- Per-visitor run limit (`claimBetaRun`, `RUNNER_BETA_RUNS_PER_VISITOR`) keyed by account email (hashed key) instead of `qa_session`; counts stored through the audit store backend (like `UsageLedger`), key `usage/accounts/<day>/<hash>.json`.
- Keep the global daily cap (`RUNNER_BETA_RUNS_PER_DAY`).
- Verified Domain proof: once verified, store `{account, host, verifiedAt}` in the bucket (`proofs/<hash>/<host>.json`), re-check after 30 days; `host-policy.ts testCopyFor` reads it.
- Tests beside `beta-side-limits.test.ts`, `domain-proof.test.ts`, `host-policy.test.ts`, `usage-ledger.test.ts`.

**Built (T-435).** `account-usage.ts` (`usage/accounts/<day>/<hash>.json`, hash = SHA-256 of lower-cased email, cached, written through the audit store backend); `server.ts startLimitHit` counts an account by email (check, day cap via `claimBetaRun({ignoreVisitor})`, then increment), other callers keep the session count (`betaLimitHit(res)` unchanged). `account-proofs.ts` (`proofs/<hash>/<host>.json`, valid 30 days); `testCopyFor({saved})` uses a valid saved proof instead of the fetch and saves a passing live proof; `handleDomainProof` does the same. `beta.ts`: `setSessionAccount`/`currentAccount`, `visitorHit`. Tests: new `account-limits-proofs.test.ts`; existing limit/proof/ledger tests pass unchanged.

## T-436: A waiting line for the Check-up slot, and runs finish after the tab closes
- Keep the single slot. `POST /api/runner/run` while busy (and the caller is an account) joins a FIFO line instead of 409; response `{queued: true, position}`. Status/SSE report `position`; the next start begins when the slot frees. Line max 10; leaving (DELETE) or a 10-minute absence of status polls drops the entry. Owner/CI keep today's 409.
- Wizard shows "You are number N in line".
- Keep-alive: while a run is active and `RUNNER_PUBLIC_URL` is set, the runner GETs `${RUNNER_PUBLIC_URL}/api/runner/ping` (new public, no-op route, not `/healthz`, which Cloud Run answers itself) every 4 minutes.
- Tests beside `run-slot.test.ts`, `status-and-run-events.test.ts`.

**Built (T-436).** `checkup-queue.ts` (FIFO, max 10, one place per account, 10-minute absence drop). `server.ts`: an account (not the key) starting while busy, behind others, or while another visitor's plan waits gets `202 {queued:true, position}`; a timer (3 s, only while the line is non-empty) starts the head inside its own visitor session with a stand-in request (saved body and cookie); a start that fails (no AI key, limit) is kept and shown once as `queue.failed` on that account's next status. Status carries `queue.position` and asking it keeps the place. `DELETE /api/runner/queue` leaves. Owner/CI keep 409. Keep-alive: `RUNNER_PUBLIC_URL` (option `publicUrl`) GETs `/api/runner/ping` every 4 min while a run is active or waiting; `/api/runner/ping` is a no-op route in `routes/health.ts`. SSE does not carry the position (status polling does). Wizard: `QueuedError`, "You are in line" notice with Leave, 5 s status poll. Tests: new `checkup-queue.test.ts`. Also: `audit-helpers.test.tsx` importer expectation now lists `AccountSignInScreen.tsx` too.

## T-437: Check-up reports saved in the bucket for 30 days
- After a run ends, copy the run folder (`session/report-store.ts`) to `reports/<account-hash>/<runId>/` in the audit store backend; `/api/runs`, `/api/runs/<id>/download/*`, `/api/report*`, `/api/evidence/*` fall back to the bucket when the local folder is gone. Only that account (or the owner) can read them.
- Lifecycle: `scripts/bucket-lifecycle.json` (delete, age 30, `matchesPrefix: ["reports/"]`); update ADR 0036 note and `docs/DEPLOYMENT.md` (lifecycle now set for `reports/` only).
- Tests beside `report-store-retention.test.ts`, `audit-store-routes.test.ts` (local backend).

**Built (T-437).** `account-reports.ts` (`AccountReports`: archive, list, has, locate, read; `reports/<hash>/<runId>/<file>`, files over 25 MB, unsafe names and `auth/` folders skipped, `summary.json` written last). `DefaultReportStore.onKept` hook; the server copies a finished run of a signed-in account (`runAccounts`). `/api/runs` merges the account's saved runs; `/api/runs/<id>` and `/download/*` and `/api/evidence/runs/<id>/*` fall back to the bucket when the local folder is gone or the run is not in memory; only the owning account or the owner (key / AUDIT_OWNER_EMAILS) reads them. `/api/report` (the in-memory last report) has no bucket fallback: the Past check-ups list is the way back. `scripts/bucket-lifecycle.json` (delete, age 30, `reports/`); ADR 0036 amended in place, `docs/DEPLOYMENT.md` bucket step now applies it. Deviation: `deploy-audit-store.test.ts` (Lane B's file) asserted "no lifecycle rule"/`--clear-lifecycle`; its expectations now match the new rule. Tests: new `account-reports.test.ts`.

## T-438: Safe mode for sites without proof
- Confirm (grep `packages/checkers`, `core/src/orchestrator.ts`) that security probing checkers, form submits and Sensitive Actions are off when Test Copy is false. Gate any checker that sends non-GET requests or attack payloads on Test Copy.
- The wizard says plainly which checks were skipped and how Verified Domain proof unlocks them.
- Tests beside `host-policy.test.ts` and the checker's tests.

**Built (T-438).** Audit result: checkers are passive (`security.ts` says so; no write method in `packages/checkers/src`); `api-spec-checks` sends writes only with `allowWrites`, which the runner never sets; the orchestrator already skips form submits and Sensitive Actions when `readOnly`; on the shared copy `readOnly = !(owner && provenTestCopy)` and sign-in consent never applies. So no checker needed a new gate. Added `SAFE_MODE_REASON` (`session/checkup-run.ts`), the plan's existing read-only line, now naming skipped forms, Sensitive Actions and Security Probes and the Verified Domain way out. `resolveAuthorization({saved})` now carries the account's saved proof into the real run start (was only in `testCopyOf`). Tests: new `safe-mode.test.ts` (authorization cases + source audit of checkers).

## T-439: Deploy: a runner that sleeps; the site container retired
- `deploy.yml` runner step: `--memory 4Gi --cpu 2 --min-instances 0 --max-instances 1 --no-cpu-throttling --timeout 3600`; env adds `RUNNER_TRUSTED_PROXY_HOPS` left at its default 1 (review, see T-439), `RUNNER_PUBLIC_URL=$RUNNER_URL`, the Vercel origin (repo variable `VERCEL_SITE_URL`) in `RUNNER_ALLOWED_ORIGINS`; secrets add `RUNNER_SESSION_SECRET=qa-session-secret:latest`.
- Remove the `site` job, `SITE_URL`, `site/` (Dockerfile, nginx.conf) and the hardcoded URL in `scripts/deploy-cloud-run.mjs`. Do not delete the live service (owner step).
- Update tests that parse `deploy.yml` (`deploy-audit-store.test.ts`, `deploy-scheduler.test.ts`, `release-workflow.test.ts`) and docs (`README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/CONTAINER_DEPLOYMENT.md`) naming `qa-check-up-site` or the warm instance.

**Review change (2026-11-19).** `RUNNER_TRUSTED_PROXY_HOPS=2` removed from `deploy.yml` and `scripts/deploy-cloud-run.mjs`: a direct run.app request has one hop, so with 2 a caller-supplied `X-Forwarded-For` would choose the client address. With 1, every visitor arriving through Vercel shares Vercel's address for the new-session cap (20 per 10 minutes), which fits a 5-10 tester pilot; revisit with a secret header from Vercel or closed run.app ingress before opening wider.

## T-440: Get-started page and invite message
- Wizard page `/get-started` (linked from the landing page): sign in with Google, paste your AI key (where to get one), run your first Check-up, what safe mode means, how to prove you own a site, reports kept 30 days, limits per day.
- `docs/PILOT_INVITE.md`: a ready-to-paste invite message with the Vercel link.
- Plain words; respect `CONTEXT.md` terms and their Avoid lists.

**T-439 Built (Lane B, 2026-11-19).** `deploy.yml`: runner step `--memory 4Gi --cpu 2 --min-instances 0 --max-instances 1 --no-cpu-throttling --timeout 3600`; env adds `RUNNER_TRUSTED_PROXY_HOPS` left at its default 1 (review, see T-439), `RUNNER_PUBLIC_URL=$RUNNER_URL`, `$VERCEL_SITE_URL` in `RUNNER_ALLOWED_ORIGINS` (the step fails fast if `vars.VERCEL_SITE_URL` is unset; `^#^` separator kept); secret `RUNNER_SESSION_SECRET=qa-session-secret:latest`. `site` job, `SITE_URL`, site artifact upload, `site/` (Dockerfile, nginx.conf) removed; `docker-compose.yml` `site` service removed (it built `site/Dockerfile`). `scripts/deploy-cloud-run.mjs` is runner-only, same flags. Tests updated: `deploy-audit-store.test.ts`, `deploy-scheduler.test.ts` (`release-workflow.test.ts` needed no change). Docs: README, ARCHITECTURE, DEPLOYMENT (not the bucket lifecycle paragraph), CONTAINER_DEPLOYMENT; ADR 0032 and 0038 marked "Amended by 0050". Not done: deleting the live `qa-check-up-site` service (owner). `RUNNER_PUBLIC_URL` and `RUNNER_SESSION_SECRET` are read by Lane A's tickets (T-434, T-436); document them in `.env.example` and `CONFIGURATION.md` there.

**T-440 Built (Lane B, 2026-11-19).** `/get-started` (`screens/GetStartedScreen.tsx`, route `get-started`, loads without the app code like the landing page via `LandingRoot`/`main.tsx`), linked as "Get started" in the landing navigation and footer; `robots.txt` disallows it. `docs/PILOT_INVITE.md` holds the invite with `https://qa-flow-tester.vercel.app/get-started`. Test: `packages/wizard/tests/get-started.test.tsx`.
