# 0039: Owner Check-up Schedules on the Hosted Copy Run from Cloud Scheduler, Authenticated by a Google OIDC Token

Status: Accepted, 2026-11-04 (owner's answers in chat). Builds on [0027](0027-checkup-session-module-and-route-table.md) (route table), [0032](0032-google-cloud-only-hosting.md) (Cloud Run hosting), [0036](0036-hosted-audit-storage-and-shared-links.md) (audit bucket) and [0038](0038-warm-runner-instance.md) (warm instance). Amends [0037](0037-route-access-levels.md).

## Context

Scheduled Check-ups were an in-process 60 second timer plus a `schedules.json` file under `RUNNER_DATA_DIR`. On the hosted copy that did not work:

- The schedule routes were closed in beta (0037), so nobody could create one.
- The data folder is `/tmp` and is wiped on every redeploy (0036).
- The timer is not started in beta, and Cloud Run only gives CPU to a container while it is serving a request.

The owner wants to create, pause and delete schedules on the hosted copy, and have them fire. Cloud Scheduler is the clock. The owner ruled out sending the runner's access key from the job: the key would sit in the job configuration.

## Decision

- **Store.** `ScheduleStore` has two implementations. `FileScheduleStore` keeps today's `<RUNNER_DATA_DIR>/schedules.json`. `BackendScheduleStore` keeps one object, `schedules/schedules.json`, in the audit store backend, and is chosen when that backend is Cloud Storage (`AUDIT_STORE_BUCKET` set, 0036). A failed bucket read propagates as an error and is never treated as an empty list, so the next save cannot wipe the schedules. The local file is not migrated.
- **Schedule routes are table rows.** The four schedule routes move out of `server.ts` into `routes/schedules.ts` with `access: 'owner'`, `beta: 'allow'`, and the schedules line leaves `closedInBeta`. This amends 0037's beta list: the owner (access key) can manage schedules in beta; Helpers and visitors are refused (403 for a Helper session, 401 without a key).
- **A route-only access level `scheduler`.** `Route.access` is `AuditAccess | 'scheduler'`. `AuditAccess` in `@qa/types` is unchanged, so 0037's six levels stay six for audit access; this amends 0037 only for route rows. Only `POST /api/runner/schedules/tick` has it. The request must carry `Authorization: Bearer <Google OIDC token>`. The runner checks the signature against Google's published keys (RS256 only), `iss` is Google, `aud` is one of the runner's URLs (`RUNNER_ALLOWED_ORIGINS`), `email_verified` is true, and `email` equals `SCHEDULER_SERVICE_ACCOUNT`. Without that variable the tick route is closed. The access key is not accepted on this route. The tick request skips the beta session and visitor quota (it has no cookie and is not a visitor).
- **The tick holds the request open.** It runs due, enabled schedules one at a time and waits for each run to finish (per-run cap 28 minutes, tick budget 29 minutes), so Cloud Run keeps CPU allocated and no `--cpu`, `--no-cpu-throttling` or `--timeout` change is needed (0032, 0038). The job sets `--attempt-deadline 1800s` and `--max-retry-attempts 0`. `nextRunAt` is saved before the run starts, so a repeat tick does not run it twice. The reply is only `{ started, failed, skipped, busy }`.
- **No in-process timer in beta.** `this.beta` skips `setInterval`; a local copy keeps its 60 second timer, which now also waits for each run to finish.
- **Same safety as a manual Check-up.** In beta the private-address guard is applied when a schedule is created and again when it runs. Scheduled runs stay read-only, without AI (`useAI: false`, `owner: false`).

## Consequences

- On the hosted copy `hour` is UTC (the runner's clock).
- A run longer than 30 minutes ends the tick with that schedule `failed`; the run keeps going, possibly with throttled CPU. The fallback, `--no-cpu-throttling`, costs money and needs a new ADR amendment.
- `--max-instances 1` (0036, 0038) means no distributed lock is needed. A tick overlapping another answers `busy: true`.
- The access key is never stored in Cloud Scheduler. The service account email in `SCHEDULER_SERVICE_ACCOUNT` is a public value.
- The OIDC audience reuses `RUNNER_ALLOWED_ORIGINS`, so the static-site origin is also an accepted audience. This is harmless: only tokens minted for the configured service account pass.
- Without `AUDIT_STORE_BUCKET` the hosted schedules sit in `/tmp` and are lost on redeploy.
- The deploy's `--set-env-vars` separator changes from `^@^` to `^#^`, because the service account email contains `@`.
- Cloud Scheduler is one job on the free tier (3 jobs per billing account); see `docs/DEPLOYMENT.md`.
- Rollback: unset the repository variable and redeploy (the tick closes), or pause the job. The stored `schedules/schedules.json` is inert.

## Alternatives considered

- **Access key in an `X-QA-Access` header on the job.** Rejected by the owner: the key would sit in the job configuration.
- **A seventh level in `AuditAccess`.** Rejected: wider blast radius across `@qa/types` and the wizard for a route that is not an audit route.
- **An inline handler before the gate.** Rejected: 0027 and 0037 say no inline routes, and the table test would not see it.
- **Keep the in-process timer and run with `--no-cpu-throttling` or always-on CPU.** Rejected: monthly cost, and 0038 chose a warm instance only.
- **A Cloud Run Job per schedule.** Rejected: a second deploy target and image for one small feature.
