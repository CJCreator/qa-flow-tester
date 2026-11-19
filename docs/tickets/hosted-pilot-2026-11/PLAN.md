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
- `packages/wizard/vercel.json` is the Vercel project (Root Directory `packages/wizard`). Root `vercel.json` keeps only the git switch.
- Build runs `pnpm site-build`-equivalent so `%ORIGIN%` is filled (from `VERCEL_PROJECT_PRODUCTION_URL` or `SITE_ORIGIN`) and `version.json` exists; output the same files nginx served.
- Rewrites, in order: `/api/:path*` → `${RUNNER_URL}/api/:path*`, `/r/:path*`/other runner-only public paths (check `routes/audit-share-routes`) → runner, then the SPA catch-all. Rewrites cannot read env vars, so the runner URL is written into `vercel.json` (it is public: `https://qa-check-up-cnhl7suwnq-uc.a.run.app`).
- Headers: port `site/nginx.conf`'s CSP and cache headers to `vercel.json` `headers`; CSP must allow Firebase (`identitytoolkit`, `securetoken`, `apis.google.com`, the auth domain frame).
- Runner side (config only): the Vercel origin joins `RUNNER_ALLOWED_ORIGINS`; `RUNNER_TRUSTED_PROXY_HOPS=2`. Confirm the Host Vercel forwards passes the Host check (`server.ts` ~1024-1043; Cloud Run host passes via `K_SERVICE`).
- Wizard: when the runner is same-origin, the first `/api/runner/status` that is slow or 5xx shows a "Waking up, this takes up to a minute" state and retries for `VITE_WAKE_LIMIT_SECONDS` (`lib/online.ts`, `useWakeOnline.ts`).
- Absolute URLs: Shared Links, evidence URLs and redirects must not build from the runner's Host (would leak `run.app`); use the request's `x-forwarded-host` only when listed in allowed origins, or relative URLs.
- Proof (manual, on a Vercel preview, before Lane A builds on it): POST passes Origin check, `Set-Cookie` is first-party, SSE streams and resumes, a cold start answers inside 120 s. Record results in this file.

## T-434: A signed-in Google account is a way in
- Read ADR 0037 first. Add a route access level `account` (signed-in, verified Google email) to the route table; check-up routes (`/api/runner/run`, status, stream, plan review, runs, report, evidence, domain proof, AI key entry) accept it in beta. Route-inventory tests enforce it.
- `HelperAccess.enabled` must work for accounts; the sign-in cookie signing key comes from env `RUNNER_SESSION_SECRET` (Secret Manager `qa-session-secret`), falling back to the random key when unset (local). Cookie lifetime 7 days for accounts.
- Wizard: on the hosted copy, starting a Check-up without an account shows "Sign in with Google" (reuse `firebase-sign-in.ts`, `startHelperSession`).
- The shared access key keeps working for owner and CI.
- Tests beside `helper-access.test.ts`, `route-access-server.test.ts`, `route-inventory.test.ts`, `helper-session.test.ts`.

## T-435: Limits and Verified Domain proof follow the account, saved in the bucket
- Per-visitor run limit (`claimBetaRun`, `RUNNER_BETA_RUNS_PER_VISITOR`) keyed by account email (hashed key) instead of `qa_session`; counts stored through the audit store backend (like `UsageLedger`), key `usage/accounts/<day>/<hash>.json`.
- Keep the global daily cap (`RUNNER_BETA_RUNS_PER_DAY`).
- Verified Domain proof: once verified, store `{account, host, verifiedAt}` in the bucket (`proofs/<hash>/<host>.json`), re-check after 30 days; `host-policy.ts testCopyFor` reads it.
- Tests beside `beta-side-limits.test.ts`, `domain-proof.test.ts`, `host-policy.test.ts`, `usage-ledger.test.ts`.

## T-436: A waiting line for the Check-up slot, and runs finish after the tab closes
- Keep the single slot. `POST /api/runner/run` while busy (and the caller is an account) joins a FIFO line instead of 409; response `{queued: true, position}`. Status/SSE report `position`; the next start begins when the slot frees. Line max 10; leaving (DELETE) or a 10-minute absence of status polls drops the entry. Owner/CI keep today's 409.
- Wizard shows "You are number N in line".
- Keep-alive: while a run is active and `RUNNER_PUBLIC_URL` is set, the runner GETs `${RUNNER_PUBLIC_URL}/api/runner/ping` (new public, no-op route, not `/healthz`, which Cloud Run answers itself) every 4 minutes.
- Tests beside `run-slot.test.ts`, `status-and-run-events.test.ts`.

## T-437: Check-up reports saved in the bucket for 30 days
- After a run ends, copy the run folder (`session/report-store.ts`) to `reports/<account-hash>/<runId>/` in the audit store backend; `/api/runs`, `/api/runs/<id>/download/*`, `/api/report*`, `/api/evidence/*` fall back to the bucket when the local folder is gone. Only that account (or the owner) can read them.
- Lifecycle: `scripts/bucket-lifecycle.json` (delete, age 30, `matchesPrefix: ["reports/"]`); update ADR 0036 note and `docs/DEPLOYMENT.md` (lifecycle now set for `reports/` only).
- Tests beside `report-store-retention.test.ts`, `audit-store-routes.test.ts` (local backend).

## T-438: Safe mode for sites without proof
- Confirm (grep `packages/checkers`, `core/src/orchestrator.ts`) that security probing checkers, form submits and Sensitive Actions are off when Test Copy is false. Gate any checker that sends non-GET requests or attack payloads on Test Copy.
- The wizard says plainly which checks were skipped and how Verified Domain proof unlocks them.
- Tests beside `host-policy.test.ts` and the checker's tests.

## T-439: Deploy: a runner that sleeps; the site container retired
- `deploy.yml` runner step: `--memory 4Gi --cpu 2 --min-instances 0 --max-instances 1 --no-cpu-throttling --timeout 3600`; env adds `RUNNER_TRUSTED_PROXY_HOPS=2`, `RUNNER_PUBLIC_URL=$RUNNER_URL`, the Vercel origin (repo variable `VERCEL_SITE_URL`) in `RUNNER_ALLOWED_ORIGINS`; secrets add `RUNNER_SESSION_SECRET=qa-session-secret:latest`.
- Remove the `site` job, `SITE_URL`, `site/` (Dockerfile, nginx.conf) and the hardcoded URL in `scripts/deploy-cloud-run.mjs`. Do not delete the live service (owner step).
- Update tests that parse `deploy.yml` (`deploy-audit-store.test.ts`, `deploy-scheduler.test.ts`, `release-workflow.test.ts`) and docs (`README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/CONTAINER_DEPLOYMENT.md`) naming `qa-check-up-site` or the warm instance.

## T-440: Get-started page and invite message
- Wizard page `/get-started` (linked from the landing page): sign in with Google, paste your AI key (where to get one), run your first Check-up, what safe mode means, how to prove you own a site, reports kept 30 days, limits per day.
- `docs/PILOT_INVITE.md`: a ready-to-paste invite message with the Vercel link.
- Plain words; respect `CONTEXT.md` terms and their Avoid lists.
