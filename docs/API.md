# Runner API

`packages/runner/src/server.ts` serves the wizard at `/` and a JSON API under `/api`. The wizard calls it through `packages/wizard/src/api.ts`. Request and reply bodies are defined by the handlers and `@qa/types` (`checkup-api.ts`, `website-audit.ts`, `ai.ts`); this page lists the endpoints and who may call them. Configuration: `CONFIGURATION.md`. Hosting: `DEPLOYMENT.md`. Design: `ARCHITECTURE.md`.

## Access

Levels are declared per route row (`Route.access` in `routes/route.ts`, ADR 0037). A row with no level is refused.

| Level                    | Who                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`                  | The access key (cookie, `?access=` on first visit, or header `X-QA-Access`). With no key set, a request from the local machine. Never a Helper. |
| `view`, `edit`, `export` | The owner, or a signed-in Helper holding that permission on the audit named by `:id`.                                                           |
| `sign-in`                | Helper sign-in, before any access.                                                                                                              |
| `public`                 | Anyone (Shared Links).                                                                                                                          |
| `scheduler`              | Cloud Scheduler only: `Authorization: Bearer <Google OIDC token>`; the key is not accepted (ADR 0039).                                          |

Inline endpoints (not yet table rows) are all `owner`.

Refusals: `401 ERR_ACCESS_KEY`, `401 ERR_SCHEDULER_AUTH`, `403 ERR_FORBIDDEN` (Helper without the permission), `403 ERR_ROUTE_CLOSED`, `403 ERR_BETA`. Audit refusals are `{ error, code }` with `code` from `AUDIT_ERROR_CODES`.

Every request: a non-loopback `Host` is refused unless it matches `RUNNER_ALLOWED_ORIGINS` (or `*.run.app` on Cloud Run); browser requests from other origins are refused.

### Beta copy (`RUNNER_BETA=1`)

- Table rows are served only when their beta policy is `allow`. Every Website Audit row is closed, except `public` rows and Helper rows (`sign-in`, and `view`, `edit`, `export` for a signed-in Helper with a grant). Plan rows are `allow`. The four schedule rows are not: on a beta copy only an owner signed in with an `AUDIT_OWNER_EMAILS` Google account reaches them, and the access key alone is refused (`403 ERR_BETA`, T-298).
- Each visitor sees only their own run: status, stream, report, evidence and plan answer as empty or not found for anyone else. Visual baselines are not offered.
- Closed with `403 ERR_BETA`: `POST /api/runner/spec-override`, `POST /api/settings/defaults`, `POST /api/runs/:runId/triage`, `POST /api/runs/:runId/accept-judgement`, `DELETE /api/runs/:runId`, `DELETE /api/runner/baselines/:id` (`closedInBeta` in `server.ts`).
- `POST /api/runner/run` and `POST /api/runner/benchmark` answer `429 ERR_BETA_LIMIT` over the per-visitor or per-day limit. Private addresses are refused.

## Health

- `GET /healthz`: `200 ok`, no key, no data. Cloud Run's front end does not forward it; the deploy checks `/`.
- `GET /health`: `200` JSON `{ "status": "ok", "uptimeSeconds": <number> }`, `no-store`, no key. `HEAD` answers the headers only.

## Check-up (inline, owner)

| Endpoint                          | Returns                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/runner/preflight`      | Whether the address answers (`reachable`, `statusCode`, `startWarning`). No browser, no run.                                                |
| `POST /api/runner/ai-estimate`    | About how many AI requests a scan needs, against what is left today.                                                                        |
| `POST /api/runner/context/docx`   | A Word file (`{ name, base64 }`) as Markdown. Stateless; open in beta.                                                                      |
| `POST /api/runner/domain-proof`   | The Verified Domain line to publish, and whether it is there now (ADR 0014). Open in beta.                                                  |
| `POST /api/runner/run`            | Starts a Check-up. `409 ERR_PLAN_WAITING` while an unapproved Plan waits; `409 ERR_RUN_IN_PROGRESS` when the run slot is busy.              |
| `GET /api/runner/stream`          | Server-sent events of the current run, replaying earlier events on reconnect.                                                               |
| `GET /api/runner/status`          | Phase, `isRunning`, whether a Plan and report exist, last error. A Helper session without the key gets a reduced reply with `helper: true`. |
| `POST /api/runner/abort`, `/stop` | Stops the current Check-up, or the running Website Audit when there is one (then `finish` and `discard` are ignored).                       |
| `POST /api/runner/ai/finish`      | Finishes the visual review on remaining screens.                                                                                            |

`FINDINGS_UPDATED` on the stream (T-389): `totalFindings` (raw findings so far), `summary` (`countSummary` of the merged findings:
`raw`, `merged`, `dismissed`, `advisory`, `toConfirm`, `problems`, `findings`; `problems` is the live "Problems that count", and
`dismissed` stays 0 because suppressions are applied after the run), and `latest` (this Test point's findings: `id`, `title`,
`severity`, `checker`, `urlPath`, `breakpoint`, and when set `issueKey`, `advisory`, `needsConfirmation`, `triageStatus`). One
more event, with `afterTests: true` and no `latest`, follows the access checks.

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

| Endpoint                                | Access    | Returns                                                                                                                                                                                                                                          |
| --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/runner/schedules`             | owner     | The schedules.                                                                                                                                                                                                                                   |
| `POST /api/runner/schedules`            | owner     | Adds one. On a beta copy at most 10 schedules (`429 ERR_SCHEDULE_LIMIT`).                                                                                                                                                                        |
| `POST /api/runner/schedules/:id/toggle` | owner     | Pauses or resumes (`{ enabled }`).                                                                                                                                                                                                               |
| `DELETE /api/runner/schedules/:id`      | owner     | Deletes.                                                                                                                                                                                                                                         |
| `POST /api/runner/schedules/tick`       | scheduler | Runs due schedules, holding the request until each finishes; replies `{ started, failed, skipped, busy }`.                                                                                                                                       |
| `POST /api/runner/sessions/cleanup`     | scheduler | Cloud Scheduler cleanup (ADR 0039, M3): forgets visitor sessions and their folders idle for 24 hours. Needs the same Google token as the tick (`SCHEDULER_SERVICE_ACCOUNT`); anything else is 401. Replies `{ sessions, folders }`, counts only. |

All served in beta (ADR 0039).

## AI settings (inline, owner)

- `GET /api/ai/settings`, `POST /api/ai/settings`: provider, models, key (never returned).
- `GET /api/ai/usage`, `POST /api/ai/test-model`, `GET /api/ai/gemini/models`.
- `POST /api/ai/openrouter/validate`, `GET|POST /api/ai/openrouter/key`, `GET /api/ai/openrouter/free-models` (key from `Authorization: Bearer`, else the saved key).

## Website Audit (table rows)

Declared once in `AUDIT_API` and `AUDIT_AI_API` (`packages/types`), which also hold each route's query, body and reply types. `:id` is an audit id, `:linkId` a Shared Link id; a malformed id is a 404. Closed on beta except the `public`, `sign-in` and Helper rows noted above.

| Endpoint                                       | Access     | Returns                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/audits`                             | owner      | `202`: starts a version. `400 ERR_INVALID_AUDIT`, `ERR_PRIVATE_ADDRESS`; `422 ERR_UNREACHABLE`, `ERR_SITE_BLOCKED`, `ERR_DNS`; `409 ERR_RUN_IN_PROGRESS`; `429 ERR_BETA_LIMIT` when `AUDIT_DAILY_LIMIT` starts are used up for the day.                                                                                                                           |
| `GET /api/audits`                              | view       | The audits the caller may see, with versions.                                                                                                                                                                                                                                                                                                                     |
| `GET /api/audits/:id`                          | view       | One audit.                                                                                                                                                                                                                                                                                                                                                        |
| `DELETE /api/audits/:id`                       | owner      | Deletes every version, edit, file, Shortlist entry, Shared Link and Helper grant.                                                                                                                                                                                                                                                                                 |
| `GET /api/audits/:id/stream`                   | view       | Server-sent `AuditProgressEvent` (`progress`, `page`, `status`, `done`, `failed`). A finished version sends its final event and closes.                                                                                                                                                                                                                           |
| `POST /api/audits/:id/rerun`                   | owner      | `202`: new version, same address and limits. `409 ERR_AUDIT_RUNNING`, `ERR_RUN_IN_PROGRESS`; `429 ERR_BETA_LIMIT`.                                                                                                                                                                                                                                                |
| `POST /api/audits/:id/stop`                    | owner      | Stops that audit's running version only, never a Check-up. `202 { stopped: true }`; `200 { stopped: false, message }` when it is not running.                                                                                                                                                                                                                     |
| `GET /api/audits/:id/content`                  | view       | Page Content for `?path=`.                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/audits/:id/file`                     | view       | A screenshot by `?path=` (download).                                                                                                                                                                                                                                                                                                                              |
| `GET /api/audits/:id/edits`                    | view       | The edit overlay.                                                                                                                                                                                                                                                                                                                                                 |
| `PATCH /api/audits/:id/edits`                  | edit       | Updates it.                                                                                                                                                                                                                                                                                                                                                       |
| `GET /api/audit-settings`                      | owner      | Audit settings.                                                                                                                                                                                                                                                                                                                                                   |
| `PUT /api/audit-settings`                      | owner      | Updates them (including the PageSpeed key).                                                                                                                                                                                                                                                                                                                       |
| `GET /api/audits/:id/export`                   | export     | Audit Documents as md, html, pdf, docx or the bundle (download); `?language=` other than the version's translates the text with the owner's key (cached per version and language), else changes labels only and says so. The Improved version joins every format.                                                                                                 |
| `GET /api/audits/:id/pitch`                    | export     | Pitch Glimpse (download).                                                                                                                                                                                                                                                                                                                                         |
| `GET /api/audits/:id/owner`                    | export     | Owner-facing audit (download).                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/audits/:id/preview`                 | owner      | Writes the improved homepage: AI wording when a key works, template text when it does not.                                                                                                                                                                                                                                                                        |
| `GET /api/audits/:id/preview`                  | view       | The preview page (HTML).                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/audits/:id/improve`                 | owner      | Improved version (ADR 0049): `{ version?, pages, variants, only? }` makes pages × variants design variants, one AI request each (`only`: one variant again). 409 `ERR_NO_AI_KEY` without a key. Replies `{ requests, variants }`.                                                                                                                                 |
| `GET /api/audits/:id/improve`                  | view       | The Improved version's pages (homepage plus one Sample Page per Layout Group), the variants made, and `estimate.usdPerRequest` (null when the model's price is not known).                                                                                                                                                                                        |
| `GET /api/audits/:id/improve/:page/:variant`   | view       | One design variant (HTML), with the Shared Link page headers.                                                                                                                                                                                                                                                                                                     |
| `PUT /api/audits/:id/improve-best`             | edit       | `{ version?, page, variant }`: stars one shown variant; its thumbnail goes in the Pitch Glimpse. `404` when that variant is not shown. Replies `{ best }`.                                                                                                                                                                                                        |
| `GET /api/audits/:id/improve-export`           | export     | Every variant that passed the checks, as a zip of HTML files with a README naming the findings each answers. `404` when none passed.                                                                                                                                                                                                                              |
| `GET /api/audits/:id/fix-options`              | view       | `{ options, ai }`: 2 or 3 fix options for each of the top 10 findings, by finding id. With the owner's key the AI adds site-specific options (stage `documents`, one request per 5 findings, counted by the AI Request Budget) and the answer is stored for the version; a Helper or a missing key gets the stored answer or the rule options (`source: 'rule'`). |
| `GET /api/audits/:id/export-translation`       | export     | `?language=`: `{ needed, sourceLanguage, aiKey, requests, labelsOnly }`, the cost of an export in that language before it starts.                                                                                                                                                                                                                                 |
| `GET /api/audits/:id/share`                    | view       | Shared Links of the audit.                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/audits/:id/share`                   | owner      | Makes a Shared Link.                                                                                                                                                                                                                                                                                                                                              |
| `DELETE /api/audits/:id/share/:linkId`         | owner      | Revokes it.                                                                                                                                                                                                                                                                                                                                                       |
| `GET /s/:linkId`                               | public     | The shared snapshot (HTML). `noindex`, strict CSP, `no-store`; `410` when expired, revoked or deleted. A malformed `/s/...` path matches no row: `401` when an access key is set, the wizard page otherwise.                                                                                                                                                      |
| `GET /api/audits/:id/rewrite`                  | view       | Rewrite state per Section.                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/audits/:id/rewrite/approve`         | edit       | Approves a Section.                                                                                                                                                                                                                                                                                                                                               |
| `POST /api/audits/:id/rewrite`                 | owner      | Writes copy for an approved Section; `409 ERR_NOT_APPROVED`, `ERR_NO_AI_KEY`; `502 ERR_AI_FAILED`.                                                                                                                                                                                                                                                                |
| `POST /api/audits/:id/rewrite/accept`          | edit       | Puts the copy in the edit overlay; `422 ERR_OVERLAP`.                                                                                                                                                                                                                                                                                                             |
| `GET /api/audits/:id/shortlist`, `PUT`         | view, edit | The Shortlist entry.                                                                                                                                                                                                                                                                                                                                              |
| `GET /api/shortlist`                           | view       | The Shortlist across audits.                                                                                                                                                                                                                                                                                                                                      |
| `GET /api/audits/:id/helpers`, `PUT`, `DELETE` | owner      | List, grant, remove Helpers.                                                                                                                                                                                                                                                                                                                                      |
| `GET /api/helper/status`                       | sign-in    | Whether Helper sign-in is set up (`404 ERR_HELPERS_OFF` when not).                                                                                                                                                                                                                                                                                                |
| `POST /api/helper/session`                     | sign-in    | Verifies a Google ID token and sets the Helper session cookie.                                                                                                                                                                                                                                                                                                    |
| `GET /api/helper/session`, `DELETE`            | sign-in    | Current Helper session; sign out.                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/audit-ai/models`                     | owner      | Model chosen per AI stage.                                                                                                                                                                                                                                                                                                                                        |
| `PUT /api/audit-ai/models`                     | owner      | Changes it.                                                                                                                                                                                                                                                                                                                                                       |

### Similar sites (T-416, `AUDIT_COMPETITOR_API`)

Started from the Improved version screen after the audit; not a pipeline stage.

| Route                                       | Access | What it does                                                                                                                                                                            |
| ------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/audits/:id/competitors`           | view   | The stored similar sites of a version (`?version=`); 404 before any were found.                                                                                                         |
| `POST /api/audits/:id/competitors/discover` | owner  | One AI request (counted by the AI Request Budget) names 3 similar public sites; each passes the public-address check, private ones are refused. `409 ERR_NO_AI_KEY` without a key.      |
| `POST /api/audits/:id/competitors/crawl`    | owner  | `{ hosts }`: reads the kept candidates only, homepage plus up to 10 key pages each, GET only, paced, robots.txt followed. On the hosted copy these pages count toward the 200-page cap. |

### Copy variants in batches (T-419)

`POST /api/audits/:id/rewrite/approve` (edit) and `POST /api/audits/:id/rewrite` (owner) also take a list of Sections instead of one `urlPath` and `sectionId`. Approval stays per Section; the batch only saves clicks.

Body (`RewriteBatchBody`): `{ version?, sections: [{ urlPath, sectionId }], language? }`. `sections` lists 1 to `REWRITE_BATCH_MAX_SECTIONS` (10) distinct Sections. Any other field, a bad `version` or `language`, or a list outside that range is `400 ERR_INVALID_REQUEST` with `errors` per field. `409 ERR_AUDIT_RUNNING` while the version runs.

Reply (`RewriteBatchReply`, always `200` once the body is valid):

```json
{
  "rewrites": [
    {
      "urlPath": "/",
      "sectionId": "s2",
      "approvedAt": "...",
      "proposal": {
        "text": "...",
        "language": "en",
        "overlaps": [],
        "createdAt": "...",
        "variants": [{ "text": "...", "overlaps": [] }]
      },
      "acceptedAt": null
    }
  ],
  "failures": [{ "urlPath": "/", "sectionId": "s3", "code": "ERR_NOT_APPROVED", "error": "..." }]
}
```

- `rewrites`: the `RewriteState` of each Section that worked; for a run, `proposal.text` is the first draft and `proposal.variants` all of them, each with its own overlap flags; they are drafts that still need accepting.
- `failures`: one entry per Section that was refused or got no drafts, with `code` `ERR_NOT_APPROVED`, `ERR_NO_AI_KEY`, `ERR_AI_FAILED` or `ERR_INVALID_REQUEST` and a fixed sentence (no provider text).
- A run with no approved Section makes no request and looks up no key: every Section is a `ERR_NOT_APPROVED` failure. A run with at least one approved Section and no working key is `409 ERR_NO_AI_KEY`. Each draft request counts toward the AI Request Budget.

### Improved version and alternatives (ADR 0049, T-413, T-415, T-417)

Rows in `AUDIT_API` (`packages/types/src/website-audit.ts`); the Improved version never changes the live site.

- `POST /api/audits/:id/improve` (owner): body `ImproveCreateBody` `{ version?, pages, variants, only? }`; `pages` are keys from the list, `variants` is 1 to 5 per page, `only` makes one variant again (one request). Reply `ImproveCreateReply` `{ requests, variants }`: `requests` AI requests sent; each `ImproveVariant` has `page`, `variant`, `style`, `status` (`made` or `failed`, with `problem` `budget-spent` or `failed`), `cites` (finding and Section ids) and `gate` (the automatic checks: `passed`, `failed` check names, `reasons`). A variant whose gate failed is stored but not shown. `409 ERR_NO_AI_KEY` without a key.
- `GET /api/audits/:id/improve` (view): `ImproveListReply` `{ version, language, pages, variants, best?, estimate }`. `pages` is the homepage plus one Sample Page per Layout Group (`key`, `urlPath`, `title`, `layoutGroup`, `screenshotPath`); `estimate.usdPerRequest` is null when the model's price is not known.
- `GET /api/audits/:id/improve/:page/:variant` (view): the variant page (HTML) with the Shared Link page headers.
- `PUT /api/audits/:id/improve-best` (edit): body `{ version?, page, variant }`, reply `{ best: { page, variant } }`.
- `GET /api/audits/:id/improve-export` (export): zip of the shown variants.
- `GET /api/audits/:id/fix-options` (view): reply `FixOptionsReply` `{ options: { [findingId]: FixOptionReply[] }, ai }`. Each option has `id` (`<finding id>-<letter>`), `findingId`, `title`, `effort` (`S`, `M`, `L`), `tradeOff` and `source` (`rule`: fixed text labelled "decided by rule", works without a key; `ai`: written for the site, cites its finding). The Findings document and the Improvement Roadmap show the same options.
- `GET /api/audits/:id/export-translation` (export): reply `ExportTranslationReply` `{ needed, sourceLanguage, aiKey, requests, labelsOnly }`; `requests` is 0 when the text was translated before.

### Similar-site examples (T-418)

`GET /api/audits/:id/competitors` and `POST /api/audits/:id/competitors/crawl` reply `CompetitorsReply` `{ competitors, examples? }`. `examples` is `CompetitorExample[]`, one per fact a read site shows for a top finding: `{ findingId, host, urlPath, text }`. It cites the site and page, comes from the stored comparison facts (no AI request), and is left out of the `discover` reply, which has no read pages yet. When examples exist, `POST /api/audits/:id/improve` passes them to the variant prompt as optional ideas, each still citing its finding id.

Owner sign-in on the hosted copy (ADR 0042, T-86): a Google account whose email is in `AUDIT_OWNER_EMAILS` is an audit owner. On a beta copy only that sign-in opens owner and audit rows; the access key alone does not. `AUDIT_DAILY_LIMIT` caps audit starts per owner email per UTC day.

## Adding a route

Add a row to the table in `routes/` with `access` and `beta`. For an audit route add the entry to `AUDIT_API` (and its shape in `AuditApi`) first; the build fails without it. Do not add inline routes to `server.ts`.
