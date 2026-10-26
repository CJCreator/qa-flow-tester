# Runner API

The server in `packages/runner/src/server.ts` serves the wizard at `/` and a JSON API under `/api`. The wizard
calls it through `packages/wizard/src/api.ts`, which is the best worked example of each call. This page lists the
routes and what they are for; **request and response bodies are defined by the handler and the types in
`@qa/types`**, so read the handler before relying on a field.

## Access rules

- Requests must have a loopback `Host` header unless `RUNNER_ALLOWED_ORIGINS` is set. Browser requests from other origins are refused (CORS), so a web page cannot trigger runs.
- With `RUNNER_ACCESS_TOKEN`, every request must carry the key: open a page with `?access=<key>` (kept in a cookie) or send header `X-QA-Access`.
- Beta mode (`RUNNER_BETA=1`) closes the routes that change shared state (schedules, deleting runs and baselines) and keeps keys per session.
- `POST /api/runner/context/docx` stays open in beta mode (stateless; the size and ZIP caps bound the work).
- `POST /api/runner/domain-proof` stays open in beta mode (it changes nothing shared; the token and the throttle are per session). In beta mode a Test Copy needs a passing Verified Domain proof, checked at `POST /api/runner/run` and again when a waiting plan is approved (ADR 0014).
- Beta mode also limits starts per visitor session and per UTC day (`RUNNER_BETA_RUNS_PER_VISITOR`, `RUNNER_BETA_RUNS_PER_DAY`). Over a limit, `POST /api/runner/run` and `POST /api/runner/benchmark` answer `429 ERR_BETA_LIMIT` with `error`, `suggestion`, `scope` (`visitor` or `day`) and `resetsAt` (ISO time of the next 00:00 UTC). Preflight and the plan routes are not counted.
- `GET /healthz` needs no token and is used by the Docker `HEALTHCHECK`. Cloud Run's front end does not forward it, so the deploy checks `/` instead (ADR 0032).

### Closed on the shared beta copy

With `RUNNER_BETA=1` these answer `403 { code: 'ERR_BETA' }`. The list is `BETA_CLOSED_ROUTES` in `server.ts`; `beta-privacy.test.ts` verifies these write routes return 403 `ERR_BETA`.

- `non-GET /api/runner/schedules`
- `POST /api/runner/spec-override`
- `GET /api/runner/spec-overrides`
- `POST /api/settings/defaults`
- `POST /api/runs/<runId>/triage`
- `POST /api/runs/<runId>/accept-judgement`
- `DELETE /api/runs/<runId>`, and any other path under `/api/runs/`
- `DELETE /api/runner/baselines/<id>`

Everything not listed here stays open on beta. A beta visitor sees only their own comparisons (`/api/runner/benchmarks`, `/api/runner/benchmark/<id>`); `DELETE` of another visitor's comparison answers `404` and removes nothing, and deleting a running one of your own answers `409`.

## Check-up lifecycle

| Route                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/runner/preflight`             | Check an address (and sign-ins) before starting                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /api/runner/context/docx`          | One Word file as Markdown for the Product Context. Body `{ name, base64 }` (`name` ends `.docx`, file at most 2 MB); answers `200 { text, warnings, summary: { requirements, journeys, tables, rules } }`. Not a ZIP, over 2 MB, too many parts, or over 20 MB unpacked answers `400 { error, code: 'ERR_INVALID_CONTEXT' }`. Stateless: nothing is stored or logged; password values typed in the file are replaced with `[hidden]`. Open in beta mode |
| `POST /api/runner/domain-proof`          | Shared copy: body `{ targetUrl }`; answers `{ required, verified, origin, proofUrl, line, reason? }`. `line` is what to publish at `proofUrl`. One check per address per 10 s per session (`429 ERR_RATE`); a private address answers `400 ERR_PRIVATE_TARGET`; the fetched file is never returned. On your own computer: `required: false`                                                                                                             |
| `POST /api/runner/ai-estimate`           | Estimate AI requests for a scan                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /api/runner/run`                   | Start a check-up. Refused with `409 ERR_PLAN_WAITING` while an unapproved plan is waiting. Beta: `429 ERR_BETA_LIMIT` over a limit                                                                                                                                                                                                                                                                                                                      |
| `GET /api/runner/stream`                 | Server-sent events: progress of the current run                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /api/runner/status`                 | Phase (`idle`, `scanning`, `testing`...), whether a plan and report exist, last error                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/runner/abort` (alias `/stop`) | Stop the current run                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/runner/ai/finish`             | Finish AI work for the current run                                                                                                                                                                                                                                                                                                                                                                                                                      |

`POST /api/runner/preflight` answers `{ reachable, statusCode, ...about }`. A 4xx start address is still `reachable: true` and carries `startWarning: 'start-4xx'` (the same literal the core uses): the address answered, but not with the page the person expected, so the wizard shows it as a warning and still lets the Check-up start. A 401 or 403 is `reachable: true` with **no** warning — a site that asks for a sign-in is a real site. `reachable: false` carries `reason` (`unreachable` or `server-error`), `code` and a fixed `suggestion`.

### Sources, saved sessions and caps (ADR 0020, 0021)

All additive; no new route. Wizard types: `StartRunRequest`, `PatchPlanBody`, `AiEstimate` in `packages/wizard/src/api.ts`.

- `POST /api/runner/run` body:
  - `contextDocuments: [{ name, text }]` (`.md`/`.txt`/`.docx`, at most 10, 500 KB of text each; a `.docx` is sent as the Markdown text from `POST /api/runner/context/docx`; PDF and `.doc` are refused).
  - `contextUrl` (docs address, at most 20 same-host pages; a failure is a plan note).
  - `savedSessions: { <role>: { cookies, origins } }` (at most 256 KB, cookie domains must match the target; held in runner memory only, never saved, returned or logged; after a restart approval asks again).
  - `aiCap: { requests?, dollars? }` (positive numbers; dollars only act when the provider reports a price).
  - `customHeaders`: `Record<string, string>` or raw string (`"Name: value\nOther: val"`). Up to 20 headers (`MAX_CUSTOM_HEADERS`). Sent only to the target host and allowlisted hosts. Values are secrets; never stored in plans or reports. Invalid headers return 400 `{ code: 'ERR_INVALID_HEADERS' }`.
  - `crawlConcurrency`: 1 to 5 concurrent page evaluations (default 2 per FR-1.7).
  - `crawlDelayMs`: 0 to 2000 ms pacing delay between page navigations (default 100 ms per FR-1.7).
  - `maxPages`: maximum pages to crawl (clamped to 1..1000, default 50 in CI check-up, 200 in discovery engine).
  - `skipReview`: boolean. Default differs per caller: `true` in headless `checkup.ts` (runs straight through); `false` in interactive Wizard (pauses for Plan Review).
  - `roles`: `[{ role, username, password?, token?, loginPath?, usernameSelector?, passwordSelector?, submitSelector?, postLoginSelector?, postLoginUrl? }]`. Up to 10 roles, fields under 500 characters. Invalid role format or duplicate roles return 400 `{ code: 'ERR_INVALID_ROLES' }`. `loginPath` must stay on the target origin; invalid paths return 400 `{ code: 'ERR_INVALID_LOGIN_PATH' }`.
- `POST /api/runner/run` takes `roles` and `signInConsent: true`. The headless check-up (`checkup.ts`) sends them when `QA_USERNAME` and `QA_PASSWORD` are set in its environment. Without `signInConsent` the sign-in details do not unlock full testing ([ADR 0022](adr/0022-test-sign-in-as-consent.md)).
  - Consent needs all of: `owner: true` sent explicitly (an omitted `owner` is never consent), `signInConsent: true`, at least one role with both `username` and `password`, and not the shared online copy (beta ignores it). Otherwise the run is read-only unless the address is a Test Copy. Consent is for that run only and is not saved to site memory.
  - A failed sign-in stops the run before the crawl: `RUN_FAILED` carries `code: 'ERR_SIGN_IN_FAILED'` and `signInReason` (`wrong-details`, `no-form`, `unreachable`, `needs-more` or `session-expired`). `error` is fixed text for the reason and never contains the username or password.
  - The consent is kept with the saved Plan. `POST /api/runner/plan/approve` answers `409` with `code: 'ERR_SIGN_IN_REQUIRED'` when that Plan was made with consent but credentials are missing, returning `needsSignIn: string[]` and `needsSignInDetails: Array<{ role: string, loginPath?: string }>`.
  - If custom headers are missing on plan approval after a runner restart, answers `409` with `code: 'ERR_HEADERS_NOT_SAVED'` and `needsHeaders: string[]`.
  - If saved sessions are missing on plan approval after a runner restart, answers `409` with `code: 'ERR_SESSION_NOT_SAVED'` and `needsSession: string[]`.
- `GET /api/runner/plan` may carry `plannedWhileCrawling`, `notFound`, `documentedItems`, `rolesNotTested`, `contextDocuments` (names only); Plan Items may carry `docSource`, `proposedRoles`, `rolesConfirmed`, `kind: 'denial'`, `origin`.
- `PATCH /api/runner/plan` accepts `sourceEdits: [{ itemId, roles?, severity?, stale?, confirm? }]` and `notFoundEdits: [{ id, remove? }]`.
- Intent ([ADR 0024](adr/0024-intent-and-refusal-rule.md)): journey and form Plan Items carry `intent` (`works`, `rejects`, `limits` or `denied`; replaces the old `kind: 'denial'`, which saved Plans still load as `denied`) and, for forms inside a modal, drawer or tab, `openingSteps` (steps flagged `opening: true`). `PATCH /api/runner/plan` also accepts `intentsOff: Intent[]` (whole Intents switched off as a Scope Exclusion; all on by default; unknown values or a non-list are refused with 400 `{ code: 'ERR_INVALID_INTENTS' }`; duplicates are removed). `GET /api/runner/plan` summary adds `intents` (`{ <intent>: { items, tests } }`) and `overCap` (Tests switched off by the Test cap), and the plan adds `testCap`. No new route.
- `POST /api/runner/run` takes optional `testCap`: a positive whole number, the most Tests the Check-up may run (default 2000). Items over it stay in the Plan, switched off with "Over the Test cap.". Fractions are floored and the value is clamped to 1..100000. Anything invalid is ignored and the default is used.
- `POST /api/runner/ai-estimate` response adds `estimatedUsd` (only with a reported price), `concurrency` and the `cap` echo.
- `GET /api/report/download/<file>` also serves `issues.md` and `issues.html`.
- `POST /api/runs/<runId>/accept-judgement` body `{ titles: string[], accept?: boolean }`: counts the named "Needs your judgement" findings as problems (`accept: false` puts them back); grades, recommendations and the issues files are recomputed; responds with the report. `400` without titles, `404` when the report is gone.
- The `crawling` progress event adds `plannedSoFar`; the planning total can grow while the scan runs.

## Plan Review

The eleven routes below are the first rows in the runner's route table (`packages/runner/src/routes/plan.ts` and `routes/index.ts`), implemented as functions over the Check-up Session ([ADR 0027](adr/0027-checkup-session-module-and-route-table.md)). Other areas below remain in the `RunnerServer.start()` dispatch chain until the follow-up plan.

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

`POST /api/sites/<host>` with `addSignIn` or `testSignIn` signs in to check the details. On failure the response is `{ verified: false, reason, error }` with `reason` one of `wrong-details`, `no-form`, `unreachable`, `needs-more`, `session-expired`: status `422` when adding, `200` when testing a saved sign-in. `error` is fixed text for that reason and never contains the username or password. A success has no `reason`. Handles two-step and modal sign-ins; CAPTCHA, one-time codes and single sign-on answer `needs-more`.

The report carries `pageCoverage: { found, reached, skipped: [{ urlPath, why, status?, finalPath?, detail? }], routes?: RouteTelemetry[] }`: pages found while exploring, how many were reached, and why the rest were skipped (`why` is `page-limit`, `did-not-load`, `robots`, `sign-in`, `http-error`, `timeout`, `off-site-redirect`, `time-limit`, `trap-limit`, `session-lost`, or `duplicate`). `routes` provides per-route traversal telemetry with requestedPath, status, finalPath, redirectChain, attempts, and durationMs.

`findings.json` (the report) may carry `slowerThanLastTime`: pages whose speed is worse than the last check-up by 20% and 300 ms. It is not part of `findings`, so grades and the verdict ignore it.

### findings.json contract

Decision: [ADR 0017](adr/0017-findings-contract.md). Schema: [`findings.schema.json`](findings.schema.json).

- `schemaVersion` (integer, now `1`) is at the top. A file without it is version 0 (before the contract) and is still read. Adding an optional field or a new file is not a bump. Removing, renaming or retyping a field, or changing the fingerprint inputs, is a bump with a changelog entry. Ignore unknown fields.
- Each finding has `fingerprint` (`fp_` plus 16 hex): the Structural Fingerprint from [ADR 0004](adr/0004-structural-fingerprint-deduplication.md). Inputs: `productId`, `where.urlPath`, `checker`, `title`, and `cssSelector` or `dataTestId`. Not run id, time, host, breakpoint or role. It is not unique in `findings`: the same problem at several widths or roles shares one. Rewording a title changes it.
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

The runner is migrating from a dispatch chain in `server.ts` to a data-driven route table (`packages/runner/src/routes/`, [ADR 0027](adr/0027-checkup-session-module-and-route-table.md)). The eleven plan routes (`/api/runner/plan*` and `/api/runner/waiting-plans`) are in the route table today; remaining routes are still in `server.ts:start()`'s dispatch chain until the follow-up plan.

1. **Register the route**: Add a `Route` entry in `packages/runner/src/routes/index.ts` (or the area's module, such as `routes/plan.ts`), specifying `{ method, path, handle }` (with `prefix: true` or `anyMethod: true` if needed).
2. **Implement the handler**: Write a handler function taking the route context (`RouteContext` / `PlanRouteContext`) that operates over the `CheckupSession`. The session owns state and operations; transport and policy stay in `server.ts`.
3. **Respect the gate order**: All incoming requests pass security gates in `server.ts` before route matching: access token / cookie, allowed origin check, beta closed routes, and beta visitor scoping. Do not bypass or reorder these gates.
4. **Update the client**: Add or update the client method and shared contracts in `packages/wizard/src/api.ts` (using shared types from `@qa/types`).
5. **Pin reachability**: Add or update test coverage in `packages/runner/tests/route-inventory.test.ts` (to pin reachability) and in the area's test suite (e.g. `packages/runner/tests/plan-routes.test.ts`).
6. **Update this page**.
