# Runner API

The server in `packages/runner/src/server.ts` serves the wizard at `/` and a JSON API under `/api`. The wizard
calls it through `packages/wizard/src/api.ts`, which is the best worked example of each call. This page lists the
routes and what they are for; **request and response bodies are defined by the handler and the types in
`@qa/types`**, so read the handler before relying on a field.

## Access rules

- Requests must have a loopback `Host` header unless `RUNNER_ALLOWED_ORIGINS` is set. Browser requests from other origins are refused (CORS), so a web page cannot trigger runs.
- With `RUNNER_ACCESS_TOKEN`, every request must carry the key: open a page with `?access=<key>` (kept in a cookie) or send header `X-QA-Access`.
- Beta mode (`RUNNER_BETA=1`) closes the routes that change shared state (schedules, deleting runs and baselines) and keeps keys per session.
- `GET /healthz` needs no token and is used by Render's health check.

## Check-up lifecycle

| Route                                    | Purpose                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /api/runner/preflight`             | Check an address (and sign-ins) before starting                                           |
| `POST /api/runner/ai-estimate`           | Estimate AI requests for a scan                                                           |
| `POST /api/runner/run`                   | Start a check-up. Refused with `409 ERR_PLAN_WAITING` while an unapproved plan is waiting |
| `GET /api/runner/stream`                 | Server-sent events: progress of the current run                                           |
| `GET /api/runner/status`                 | Phase (`idle`, `scanning`, `testing`...), whether a plan and report exist, last error     |
| `POST /api/runner/abort` (alias `/stop`) | Stop the current run                                                                      |
| `POST /api/runner/ai/finish`             | Finish AI work for the current run                                                        |

## Plan Review

| Route                                | Purpose                                 |
| ------------------------------------ | --------------------------------------- |
| `GET /api/runner/plan`               | The current Plan                        |
| `PATCH /api/runner/plan`             | Edit Plan Items (switch off, change)    |
| `GET /api/runner/plan/markdown`      | The Plan as markdown                    |
| `POST /api/runner/plan/approve`      | Approve; testing starts                 |
| `POST /api/runner/plan/interpret`    | Turn a typed request into a Plan change |
| `POST /api/runner/plan/replan`       | Ask the planner again for some items    |
| `POST /api/runner/plan/add-page`     | Add a page to the Plan                  |
| `POST /api/runner/plan/add-sign-in`  | Add a role's sign-in                    |
| `POST /api/runner/plan/include-host` | Include another host in scope           |
| `GET /api/runner/waiting-plans`      | Plans paused for review                 |

## Reports and history

| Route                                                                      | Purpose                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/report`                                                          | The latest report                                                                        |
| `GET /api/report/download/<file>`                                          | Download a report file                                                                   |
| `GET /api/runs`, `GET/DELETE /api/runs/<runId>` (+ `/triage`, `/download`) | Past check-ups; triage marks a finding intended or false positive. Handler: `handleRuns` |
| `GET /api/evidence/<path>`                                                 | Screenshots and other evidence                                                           |
| `GET /api/sites`, `/api/sites/<host>...`                                   | Per-site memory and history. Handler: `handleSites`                                      |
| `GET/POST /api/settings/defaults`                                          | Screen sizes a check-up starts with                                                      |

## Visual baselines

`GET /api/runner/baselines`, `POST /api/runner/baselines/accept`, `DELETE /api/runner/baselines/<id>`,
`GET /api/baselines/<path>` (the image).

## Benchmarks and schedules

- `POST /api/runner/benchmark`, `GET /api/runner/benchmarks`, `GET/DELETE /api/runner/benchmark/<id>`
- `GET/POST /api/runner/schedules`, `POST /api/runner/schedules/<id>/toggle`, `DELETE /api/runner/schedules/<id>`

## AI settings (`handleAiSettings`, `handleOpenRouter`)

Under `/api/ai/`: `settings` (GET/POST), `usage`, `test-model`, `validate`, `key` (GET/POST), and
`openrouter/free-models`. Keys are write-only from the UI's point of view: never log or return one in full.

## Adding or changing a route

1. Add it in `server.ts` next to its group, and decide whether beta mode must close it (see the beta route list near line 1100).
2. Add a test in `packages/runner/tests/` (`wizard-endpoints.test.ts` or `runner-server.test.ts`).
3. Add the client call in `packages/wizard/src/api.ts`.
4. Update this page.
