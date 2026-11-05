# Runner API

`packages/runner/src/server.ts` serves the wizard at `/` and a JSON API under `/api`. The wizard calls it through `packages/wizard/src/api.ts`. Request and reply bodies are defined by the handlers and `@qa/types` (`checkup-api.ts`, `website-audit.ts`, `ai.ts`); this page lists the endpoints and who may call them. Configuration: `CONFIGURATION.md`. Hosting: `DEPLOYMENT.md`. Design: `ARCHITECTURE.md`.

## Access

Levels are declared per route row (`Route.access` in `routes/route.ts`, ADR 0037). A row with no level is refused.

| Level | Who |
| --- | --- |
| `owner` | The access key (cookie, `?access=` on first visit, or header `X-QA-Access`). With no key set, a request from the local machine. Never a Helper. |
| `view`, `edit`, `export` | The owner, or a signed-in Helper holding that permission on the audit named by `:id`. |
| `sign-in` | Helper sign-in, before any access. |
| `public` | Anyone (Shared Links). |
| `scheduler` | Cloud Scheduler only: `Authorization: Bearer <Google OIDC token>`; the key is not accepted (ADR 0039). |

Inline endpoints (not yet table rows) are all `owner`.

Refusals: `401 ERR_ACCESS_KEY`, `401 ERR_SCHEDULER_AUTH`, `403 ERR_FORBIDDEN` (Helper without the permission), `403 ERR_ROUTE_CLOSED`, `403 ERR_BETA`. Audit refusals are `{ error, code }` with `code` from `AUDIT_ERROR_CODES`.

Every request: a non-loopback `Host` is refused unless it matches `RUNNER_ALLOWED_ORIGINS` (or `*.run.app` on Cloud Run); browser requests from other origins are refused.

### Beta copy (`RUNNER_BETA=1`)

- Table rows are served only when their beta policy is `allow`. Every Website Audit row is closed, except `public` rows and Helper rows (`sign-in`, and `view`, `edit`, `export` for a signed-in Helper with a grant). Plan and schedule rows are `allow`.
- Each visitor sees only their own run: status, stream, report, evidence and plan answer as empty or not found for anyone else. Visual baselines are not offered.
- Closed with `403 ERR_BETA`: `POST /api/runner/spec-override`, `POST /api/settings/defaults`, `POST /api/runs/:runId/triage`, `POST /api/runs/:runId/accept-judgement`, `DELETE /api/runs/:runId`, `DELETE /api/runner/baselines/:id` (`closedInBeta` in `server.ts`).
- `POST /api/runner/run` and `POST /api/runner/benchmark` answer `429 ERR_BETA_LIMIT` over the per-visitor or per-day limit. Private addresses are refused.

## Health

- `GET /healthz`: `200 ok`, no key, no data. Cloud Run's front end does not forward it; the deploy checks `/`.

## Check-up (inline, owner)

| Endpoint | Returns |
| --- | --- |
| `POST /api/runner/preflight` | Whether the address answers (`reachable`, `statusCode`, `startWarning`). No browser, no run. |
| `POST /api/runner/ai-estimate` | About how many AI requests a scan needs, against what is left today. |
| `POST /api/runner/context/docx` | A Word file (`{ name, base64 }`) as Markdown. Stateless; open in beta. |
| `POST /api/runner/domain-proof` | The Verified Domain line to publish, and whether it is there now (ADR 0014). Open in beta. |
| `POST /api/runner/run` | Starts a Check-up. `409 ERR_PLAN_WAITING` while an unapproved Plan waits; `409 ERR_RUN_IN_PROGRESS` when the run slot is busy. |
| `GET /api/runner/stream` | Server-sent events of the current run, replaying earlier events on reconnect. |
| `GET /api/runner/status` | Phase, `isRunning`, whether a Plan and report exist, last error. A Helper session without the key gets a reduced reply with `helper: true`. |
| `POST /api/runner/abort`, `/stop` | Stops the current run. |
| `POST /api/runner/ai/finish` | Finishes the visual review on remaining screens. |

## Plan Review (table rows, owner, beta allow)

- `GET /api/runner/plan`, `PATCH /api/runner/plan`
- `POST /api/runner/plan/approve`, `/interpret`, `/replan`, `/add-page`, `/add-sign-in`, `/include-host`
- `GET /api/runner/plan/markdown`, `/export`
- any method on `/api/runner/waiting-plans`: Plans kept aside for other sites, and bringing one back

## Reports and history (inline, owner)

- `GET /api/report`: the last completed report (404 before any). `GET /api/report/download/<file>`.
- `GET /api/runs`, `GET /api/runs/:runId`, `DELETE /api/runs/:runId`, `POST /api/runs/:runId/triage`, `POST /api/runs/:runId/accept-judgement`, `GET /api/runs/:runId/download/<file>`. Downloadable files: `report.html`, `report.md`, `findings.json`, `issues.md`, `issues.html`.
- `GET /api/evidence/<path>`: files under the runner's output folder (saved sessions refused).
- `GET /api/sites`, `GET /api/sites/<host>`, `POST /api/sites/<host>`: per-site choices and saved sign-ins.
- `GET/POST /api/settings/defaults`: default screen sizes.
- `GET /api/runner/baselines`, `POST /api/runner/baselines/accept`, `DELETE /api/runner/baselines/:id`, `GET /api/baselines/<path>` (image).
- `POST /api/runner/benchmark`, `GET /api/runner/benchmarks`, `GET/DELETE /api/runner/benchmark/:id`.
- `POST /api/runner/spec-override`, `GET /api/runner/spec-overrides`.

`findings.json` contract: [ADR 0017](adr/0017-findings-contract.md), [`findings.schema.json`](findings.schema.json).

## Schedules (table rows)

| Endpoint | Access | Returns |
| --- | --- | --- |
| `GET /api/runner/schedules` | owner | The schedules. |
| `POST /api/runner/schedules` | owner | Adds one. |
| `POST /api/runner/schedules/:id/toggle` | owner | Pauses or resumes (`{ enabled }`). |
| `DELETE /api/runner/schedules/:id` | owner | Deletes. |
| `POST /api/runner/schedules/tick` | scheduler | Runs due schedules, holding the request until each finishes; replies `{ started, failed, skipped, busy }`. |

All served in beta (ADR 0039).

## AI settings (inline, owner)

- `GET /api/ai/settings`, `POST /api/ai/settings`: provider, models, key (never returned).
- `GET /api/ai/usage`, `POST /api/ai/test-model`, `GET /api/ai/gemini/models`.
- `POST /api/ai/openrouter/validate`, `GET|POST /api/ai/openrouter/key`, `GET /api/ai/openrouter/free-models` (key from `Authorization: Bearer`, else the saved key).

## Website Audit (table rows)

Declared once in `AUDIT_API` and `AUDIT_AI_API` (`packages/types`), which also hold each route's query, body and reply types. `:id` is an audit id, `:linkId` a Shared Link id; a malformed id is a 404. Closed on beta except the `public`, `sign-in` and Helper rows noted above.

| Endpoint | Access | Returns |
| --- | --- | --- |
| `POST /api/audits` | owner | `202`: starts a version. `400 ERR_INVALID_AUDIT`, `ERR_PRIVATE_ADDRESS`; `422 ERR_UNREACHABLE`, `ERR_SITE_BLOCKED`, `ERR_DNS`; `409 ERR_RUN_IN_PROGRESS`. |
| `GET /api/audits` | view | The audits the caller may see, with versions. |
| `GET /api/audits/:id` | view | One audit. |
| `DELETE /api/audits/:id` | owner | Deletes every version, edit, file, Shortlist entry, Shared Link and Helper grant. |
| `GET /api/audits/:id/stream` | view | Server-sent `AuditProgressEvent` (`progress`, `page`, `status`, `done`, `failed`). A finished version sends its final event and closes. |
| `POST /api/audits/:id/rerun` | owner | `202`: new version, same address and limits. |
| `GET /api/audits/:id/content` | view | Page Content for `?path=`. |
| `GET /api/audits/:id/file` | view | A screenshot by `?path=` (download). |
| `GET /api/audits/:id/edits` | view | The edit overlay. |
| `PATCH /api/audits/:id/edits` | edit | Updates it. |
| `GET /api/audit-settings` | owner | Audit settings. |
| `PUT /api/audit-settings` | owner | Updates them (including the PageSpeed key). |
| `GET /api/audits/:id/export` | export | Document bundle (download). |
| `GET /api/audits/:id/pitch` | export | Pitch Glimpse (download). |
| `GET /api/audits/:id/owner` | export | Owner-facing audit (download). |
| `POST /api/audits/:id/preview` | owner | Writes the improved homepage with AI; `409 ERR_NO_AI_KEY` without a key. |
| `GET /api/audits/:id/preview` | view | The preview page (HTML). |
| `GET /api/audits/:id/share` | view | Shared Links of the audit. |
| `POST /api/audits/:id/share` | owner | Makes a Shared Link. |
| `DELETE /api/audits/:id/share/:linkId` | owner | Revokes it. |
| `GET /s/:linkId` | public | The shared snapshot (HTML). `noindex`, strict CSP, `no-store`; `410` when expired, revoked or deleted. Any other `/s/...` path is 404. |
| `GET /api/audits/:id/rewrite` | view | Rewrite state per Section. |
| `POST /api/audits/:id/rewrite/approve` | edit | Approves a Section. |
| `POST /api/audits/:id/rewrite` | owner | Writes copy for an approved Section; `409 ERR_NOT_APPROVED`, `ERR_NO_AI_KEY`; `502 ERR_AI_FAILED`. |
| `POST /api/audits/:id/rewrite/accept` | edit | Puts the copy in the edit overlay; `422 ERR_OVERLAP`. |
| `GET /api/audits/:id/shortlist`, `PUT` | view, edit | The Shortlist entry. |
| `GET /api/shortlist` | view | The Shortlist across audits. |
| `GET /api/audits/:id/helpers`, `PUT`, `DELETE` | owner | List, grant, remove Helpers. |
| `GET /api/helper/status` | sign-in | Whether Helper sign-in is set up (`404 ERR_HELPERS_OFF` when not). |
| `POST /api/helper/session` | sign-in | Verifies a Google ID token and sets the Helper session cookie. |
| `GET /api/helper/session`, `DELETE` | sign-in | Current Helper session; sign out. |
| `GET /api/audit-ai/models` | owner | Model chosen per AI stage. |
| `PUT /api/audit-ai/models` | owner | Changes it. |

Not yet built (ADR 0042, T-86): owner sign-in on the hosted copy (`AUDIT_OWNER_EMAILS`).

## Adding a route

Add a row to the table in `routes/` with `access` and `beta`. For an audit route add the entry to `AUDIT_API` (and its shape in `AuditApi`) first; the build fails without it. Do not add inline routes to `server.ts`.
