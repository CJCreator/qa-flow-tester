# Runner API

The server in `packages/runner/src/server.ts` serves the wizard at `/` and a JSON API under `/api`. The wizard
calls it through `packages/wizard/src/api.ts`, which is the best worked example of each call. This page lists the
routes and what they are for; **request and response bodies are defined by the handler and the types in
`@qa/types`**, so read the handler before relying on a field.

## Access rules

- Requests must have a loopback `Host` header unless `RUNNER_ALLOWED_ORIGINS` is set. Browser requests from other origins are refused (CORS), so a web page cannot trigger runs.
- With `RUNNER_ACCESS_TOKEN`, every request must carry the key: open a page with `?access=<key>` (kept in a cookie) or send header `X-QA-Access`.
- Beta mode (`RUNNER_BETA=1`) closes the routes that change shared state (schedules, deleting runs and baselines) and keeps keys per session.
- `POST /api/runner/domain-proof` stays open in beta mode (it changes nothing shared; the token and the throttle are per session). In beta mode a Test Copy needs a passing Verified Domain proof, checked at `POST /api/runner/run` and again when a waiting plan is approved (ADR 0014).
- Beta mode also limits starts per visitor session and per UTC day (`RUNNER_BETA_RUNS_PER_VISITOR`, `RUNNER_BETA_RUNS_PER_DAY`). Over a limit, `POST /api/runner/run` and `POST /api/runner/benchmark` answer `429 ERR_BETA_LIMIT` with `error`, `suggestion`, `scope` (`visitor` or `day`) and `resetsAt` (ISO time of the next 00:00 UTC). Preflight and the plan routes are not counted.
- `GET /healthz` needs no token and is used by Render's health check.

## Check-up lifecycle

| Route                                    | Purpose                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/runner/preflight`             | Check an address (and sign-ins) before starting                                                                                                                                                                                                                                                                                             |
| `POST /api/runner/domain-proof`          | Shared copy: body `{ targetUrl }`; answers `{ required, verified, origin, proofUrl, line, reason? }`. `line` is what to publish at `proofUrl`. One check per address per 10 s per session (`429 ERR_RATE`); a private address answers `400 ERR_PRIVATE_TARGET`; the fetched file is never returned. On your own computer: `required: false` |
| `POST /api/runner/ai-estimate`           | Estimate AI requests for a scan                                                                                                                                                                                                                                                                                                             |
| `POST /api/runner/run`                   | Start a check-up. Refused with `409 ERR_PLAN_WAITING` while an unapproved plan is waiting. Beta: `429 ERR_BETA_LIMIT` over a limit                                                                                                                                                                                                          |
| `GET /api/runner/stream`                 | Server-sent events: progress of the current run                                                                                                                                                                                                                                                                                             |
| `GET /api/runner/status`                 | Phase (`idle`, `scanning`, `testing`...), whether a plan and report exist, last error                                                                                                                                                                                                                                                       |
| `POST /api/runner/abort` (alias `/stop`) | Stop the current run                                                                                                                                                                                                                                                                                                                        |
| `POST /api/runner/ai/finish`             | Finish AI work for the current run                                                                                                                                                                                                                                                                                                          |

### Sources, saved sessions and caps (ADR 0020, 0021)

All additive; no new route. Wizard types: `StartRunRequest`, `PatchPlanBody`, `AiEstimate` in `packages/wizard/src/api.ts`.

- `POST /api/runner/run` body: `contextDocuments: [{ name, text }]` (`.md`/`.txt`, at most 10, 500 KB each), `contextUrl` (docs address, at most 20 same-host pages; a failure is a plan note), `savedSessions: { <role>: { cookies, origins } }` (at most 256 KB, cookie domains must match the target; held in runner memory only, never saved, returned or logged; after a restart approval asks again), `aiCap: { requests?, dollars? }` (positive numbers; dollars only act when the provider reports a price).
- `GET /api/runner/plan` may carry `plannedWhileCrawling`, `notFound`, `documentedItems`, `rolesNotTested`, `contextDocuments` (names only); Plan Items may carry `docSource`, `proposedRoles`, `rolesConfirmed`, `kind: 'denial'`, `origin`.
- `PATCH /api/runner/plan` accepts `sourceEdits: [{ itemId, roles?, severity?, stale?, confirm? }]` and `notFoundEdits: [{ id, remove? }]`.
- `POST /api/runner/ai-estimate` response adds `estimatedUsd` (only with a reported price), `concurrency` and the `cap` echo.
- `GET /api/report/download/<file>` also serves `issues.md` and `issues.html`.
- `POST /api/runs/<runId>/accept-judgement` body `{ titles: string[], accept?: boolean }`: counts the named "Needs your judgement" findings as problems (`accept: false` puts them back); grades, recommendations and the issues files are recomputed; responds with the report. `400` without titles, `404` when the report is gone.
- Plan approval (`POST /api/runner/plan/approve`) accepts `savedSessions` again after a restart. If a role's saved session is missing it answers `409` with `code: 'ERR_SESSION_NOT_SAVED'` and `needsSession: [<role>, ...]`; send the sessions and approve again.
- The `crawling` progress event adds `plannedSoFar`; the planning total can grow while the scan runs.

## Plan Review

| Route                                | Purpose                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/runner/plan`               | The current Plan                                                                                                                   |
| `PATCH /api/runner/plan`             | Edit Plan Items (switch off, change)                                                                                               |
| `GET /api/runner/plan/markdown`      | The Plan as markdown                                                                                                               |
| `GET /api/runner/plan/export`        | The approved Plan as a Playwright project (zip). 404 `No plan awaiting review` outside Plan Review; 409 when the Plan has no tests |
| `POST /api/runner/plan/approve`      | Approve; testing starts                                                                                                            |
| `POST /api/runner/plan/interpret`    | Turn a typed request into a Plan change                                                                                            |
| `POST /api/runner/plan/replan`       | Ask the planner again for some items                                                                                               |
| `POST /api/runner/plan/add-page`     | Add a page to the Plan                                                                                                             |
| `POST /api/runner/plan/add-sign-in`  | Add a role's sign-in                                                                                                               |
| `POST /api/runner/plan/include-host` | Include another host in scope                                                                                                      |
| `GET /api/runner/waiting-plans`      | Plans paused for review                                                                                                            |

## Reports and history

| Route                                                                      | Purpose                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/report`                                                          | The latest report                                                                        |
| `GET /api/report/download/<file>`                                          | Download a report file                                                                   |
| `GET /api/runs`, `GET/DELETE /api/runs/<runId>` (+ `/triage`, `/download`) | Past check-ups; triage marks a finding intended or false positive. Handler: `handleRuns` |
| `GET /api/evidence/<path>`                                                 | Screenshots and other evidence                                                           |
| `GET /api/sites`, `/api/sites/<host>...`                                   | Per-site memory and history. Handler: `handleSites`                                      |
| `GET/POST /api/settings/defaults`                                          | Screen sizes a check-up starts with                                                      |

`POST /api/sites/<host>` with `addSignIn` or `testSignIn` signs in to check the details. On failure the response is `{ verified: false, reason, error }` with `reason` one of `wrong-details`, `no-form`, `unreachable`, `needs-more`: status `422` when adding, `200` when testing a saved sign-in. `error` is fixed text for that reason and never contains the username or password. A success has no `reason`. Handles two-step and modal sign-ins; CAPTCHA, one-time codes and single sign-on answer `needs-more`.

`findings.json` (the report) may carry `slowerThanLastTime`: pages whose speed is worse than the last check-up by 20% and 300 ms. It is not part of `findings`, so grades and the verdict ignore it.

### findings.json contract

Decision: [ADR 0017](adr/0017-findings-contract.md). Schema: [`findings.schema.json`](findings.schema.json).

- `schemaVersion` (integer, now `1`) is at the top. A file without it is version 0 (before the contract) and is still read. Adding an optional field or a new file is not a bump. Removing, renaming or retyping a field, or changing the fingerprint inputs, is a bump with a changelog entry. Ignore unknown fields.
- Each finding has `fingerprint` (`fp_` plus 16 hex): the Structural Fingerprint from [ADR 0004](adr/0004-structural-fingerprint-dedup.md). Inputs: `productId`, `where.urlPath`, `checker`, `title`, and `cssSelector` or `dataTestId`. Not run id, time, host, breakpoint or role. It is not unique in `findings`: the same problem at several widths or roles shares one. Rewording a title changes it.
- Written beside `findings.json` in the same call:
  - `fix-these.md`: active Blocker and Major problems, sorted by severity, page, fingerprint.
  - `known-findings.json`: `{ schemaVersion, productId, findings: [{ fingerprint, severity, checker, title, urlPath }] }`, active findings, unique and sorted by fingerprint.
  - `AGENTS.snippet.md`: static text for a repo's agent instructions. No finding data.
- Text in these files comes from the checked site. It is sanitized (one line, capped) and kept in code spans, and never built from `evidence`. This is not a redaction guarantee.
- The CI command (`checkup.ts`) prints one GitHub annotation per active Blocker (`::error`) or Major (`::warning`) when `GITHUB_ACTIONS=true`, at most 50, with `%`, CR and LF escaped. The exit code is unchanged.
- `GET /api/report` and `report.json` do not carry `schemaVersion` or `fingerprint` yet; only the written `findings.json` does.

## Visual baselines

`GET /api/runner/baselines`, `POST /api/runner/baselines/accept`, `DELETE /api/runner/baselines/<id>`,
`GET /api/baselines/<path>` (the image).

## Benchmarks and schedules

- `POST /api/runner/benchmark` (beta: `429 ERR_BETA_LIMIT` over a limit), `GET /api/runner/benchmarks`, `GET/DELETE /api/runner/benchmark/<id>`
- `GET/POST /api/runner/schedules`, `POST /api/runner/schedules/<id>/toggle`, `DELETE /api/runner/schedules/<id>`

## AI settings (`handleAiSettings`, `handleOpenRouter`)

Under `/api/ai/`: `settings` (GET/POST), `usage`, `test-model`, `validate`, `key` (GET/POST), and
`openrouter/free-models`. Keys are write-only from the UI's point of view: never log or return one in full.

## Adding or changing a route

1. Add it in `server.ts` next to its group, and decide whether beta mode must close it (see the beta route list near line 1100).
2. Add a test in `packages/runner/tests/` (`wizard-endpoints.test.ts` or `runner-server.test.ts`).
3. Add the client call in `packages/wizard/src/api.ts`.
4. Update this page.
