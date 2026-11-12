# Configuration

Every setting the code reads. Put them in the shell or in a `.env` file at the repo root (never commit it); `pnpm start`
loads `.env`. `.env.example` lists every name. `packages/runner/tests/config-docs.test.ts` keeps this page, `.env.example`
and the code in step.

## Runner (the server)

| Variable                        | Default             | Meaning                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNNER_PORT`                   | `3001`              | Port. Where `K_SERVICE` is set, `PORT` is used instead                                                                                                                                                                                               |
| `RUNNER_HOST`                   | `localhost`         | Bind address. Use `0.0.0.0` only in a container or behind a proxy. The runner refuses to start on a non-loopback host without `RUNNER_ACCESS_TOKEN`                                                                                                  |
| `RUNNER_DATA_DIR`               | `.qa-data/`         | Site memory, history, waiting Plans, saved model choices, local audit store, schedules                                                                                                                                                               |
| `RUNNER_OUTPUT_DIR`             | `.qa-runner-report` | Where reports are written                                                                                                                                                                                                                            |
| `RUNNER_ACCESS_TOKEN`           | none                | A key every request must carry (`?access=<key>` sets a cookie; scripts send `X-QA-Access`). Required whenever the server is reachable beyond this computer                                                                                           |
| `RUNNER_ALLOWED_ORIGINS`        | none                | Comma-separated extra origins allowed to call the API. Warns if set without an access token                                                                                                                                                          |
| `RUNNER_LOCALHOST_ALIAS`        | none                | Host name that stands for localhost when the runner runs in a container                                                                                                                                                                              |
| `RUNNER_BETA`                   | off                 | `1` turns on shared-beta mode: keys and sign-ins live in memory per session, only public sites can be checked, some routes are closed; a Test Copy needs a Verified Domain proof, and addresses that resolve or redirect to private ones are refused |
| `RUNNER_BETA_RUNS_PER_VISITOR`  | `5`                 | Beta only: most check-ups, comparisons, sign-in tests and Smoke Check-ups one visitor may start per UTC day. A value that is not a whole number of at least 1 uses the default. Memory only; a restart resets it (a restart also forgets the visitor's session) |
| `RUNNER_BETA_RUNS_PER_DAY`      | `40`                | Beta only: the same limit for the whole shared copy. Kept in the audit store (`limits/usage.json`; Cloud Storage on the hosted copy), so a restart or redeploy keeps the day's count |
| `RUNNER_TRUSTED_PROXY_HOPS`     | `1`                 | How many trusted proxies in front of the runner add to `X-Forwarded-For`. `1` is Cloud Run's own front end; set `2` with a load balancer in front of Cloud Run; `0` ignores the header. Used for the per-address limit on new visitor sessions on a beta copy. Whole number 0 to 5; anything else uses the default |
| `RUNNER_STEP_TIMEOUT_MS`        | `10000`             | Most time one test step may spend finding and acting on its element, in ms, across retries. Invalid or non-positive values use the default; maximum 300000. Also the `stepTimeoutMs` orchestrator option                                             |
| `RUNNER_RUN_RETENTION_DAYS`     | `30`                | Days to keep completed check-up run folders before deleting them. `0` disables retention cleanup.                                                                                                                                                    |
| `PUBLIC_URL`                    | none                | Public address (for example `https://qa.example.com`) when served behind a domain or tunnel. Used for absolute links, canonical tags and the sitemap. Unset: the request's own host                                                                  |
| `K_SERVICE`                     | none                | Set by Cloud Run. With it, `PORT` sets the port, and the service's own `*.run.app` host counts as an allowed origin                                                                                                                                  |
| `PORT`                          | none                | Set by the hosting platform. Read only where `K_SERVICE` (or `RENDER`) is set, so a `PORT` in your shell cannot move a local runner                                                                                                                  |
| `RENDER`, `RENDER_EXTERNAL_URL` | none                | Not used by the supported deployment ([ADR 0032](adr/0032-google-cloud-only-hosting.md)). `cli.ts` still reads them: with `RENDER`, `PORT` sets the port; `RENDER_EXTERNAL_URL` is added to the allowed origins                                      |

**Beta copy (`RUNNER_BETA=1`).** Its only protection is the address guard: private addresses are refused, and every
outbound request uses the pinned, redirect-checked resolver ([ADR 0031](adr/0031-every-outbound-request-uses-pinned-resolver.md)).
There are no accounts. Its data is temporary: the hosted copy has no persistent disk, so check-ups, Plans and
comparisons are lost on a restart or redeploy.

**Browser.** Chromium runs with `--no-sandbox` (`packages/core/src/browser.ts`). Each target host gets its own browser
process. There is no setting for this.

## Run options set in code

No environment variable. These are options of the orchestrator (`packages/core/src/orchestrator.ts`):

- `breakpoints`: the orchestrator's own default is `1440px`; a run started through the runner without sizes uses `375px`, `768px` and `1440px` (`packages/runner/src/session/checkup-run.ts`).
- `flakyReruns`: `3` reruns of a failed test point, stopping at the first pass. Link checks are never rerun.
- `recordVideo`: on by default. Video is kept only for failed test points.

## Evidence (screenshots and video)

- Screenshots are taken for failed steps only. Sign-in fields are masked in them: password inputs, username inputs (`autocomplete="username"`) and email inputs.

## Visual baselines (Perceptual Visual Diff)

Profile fields (`ProductProfile` JSON; no environment variables):

- `visualBaselineDir`: where baselines are kept (default `.qa-baselines`).
- `visualDiffMaxPercent`: fraction of pixels allowed to differ.
- `visualMaskSelectors`: extra CSS selectors painted over in newly recorded baselines. Stored in the baseline's `.visual.json` file beside the PNG. Invalid selectors are skipped.

New baselines mask dates and times, well-known ad slots and password fields ([ADR 0019](adr/0019-visual-diff-stabilising-and-masking.md)).

## Saved Website Audits and Helper sign-in

All optional and empty in `.env.example`.

| Variable                    | Default                                 | Meaning                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUDIT_STORE_BUCKET`        | none                                    | Cloud Storage bucket for saved Website Audits ([ADR 0036](adr/0036-hosted-audit-storage-and-shared-links.md)). Unset: audits are kept as local files under `RUNNER_DATA_DIR`                                                                                                                                                                     |
| `SCHEDULER_SERVICE_ACCOUNT` | none                                    | Email of the Cloud Scheduler service account whose Google token may call `POST /api/runner/schedules/tick` and `POST /api/runner/sessions/cleanup` ([ADR 0039](adr/0039-cloud-scheduler-owner-schedules.md)). Public value, not a secret. Unset: the tick route is closed. The token's audience must be one of the `RUNNER_ALLOWED_ORIGINS` URLs |
| `AUDIT_OWNER_EMAILS`        | none                                    | Comma-separated Google account emails whose owner audit rows pass on a beta copy (T-86). Unset: no owner access                                                                                                                                                                                                                                  |
| `AUDIT_DAILY_LIMIT`         | none                                    | Daily audit starts per owner email per UTC day. Unset: no limit. Kept in the audit store (`limits/usage.json`; Cloud Storage on the hosted copy), so a restart or redeploy keeps the day's count                                                                                                                                                                                                                                                                                  |
| `PAGESPEED_API_KEY`         | none                                    | Google PageSpeed Insights key for the Website Audit's speed step. Used only when no key is saved in Audit settings (the saved key wins). Unset and none saved: speed is measured by this tool's own browser                                                                                                                                      |
| `FIREBASE_PROJECT_ID`       | none                                    | Firebase project ID for Helper sign-in. Public value. Helper sign-in turns on only when this and `RUNNER_ACCESS_TOKEN` are both set                                                                                                                                                                                                              |
| `FIREBASE_WEB_API_KEY`      | none                                    | Firebase web API key the runner sends to the wizard for Helper sign-in. Optional. A public browser value, not a server secret                                                                                                                                                                                                                    |
| `FIREBASE_AUTH_DOMAIN`      | `<FIREBASE_PROJECT_ID>.firebaseapp.com` | Firebase auth domain for Helper sign-in. Optional                                                                                                                                                                                                                                                                                                |

The wizard can also take the Firebase values at build time as `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_WEB_API_KEY`
and `VITE_FIREBASE_AUTH_DOMAIN` (public values only). It uses them when the runner sends none.

Helper sessions are signed with a random key made when the runner starts, so a Helper signs in with Google again after
each runner restart (`packages/runner/src/helpers/helper-session.ts`). Hosted setup: [DEPLOYMENT.md](DEPLOYMENT.md).

## AI providers

Bring your own key. Providers: OpenRouter (default in CI), Gemini, OpenAI, Anthropic, and a mock for tests.

| Variable                                                                      | Meaning                                 |
| ----------------------------------------------------------------------------- | --------------------------------------- |
| `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider keys read from the environment |
| `TEST_MOCK_AI`                                                                | Use the mock provider (tests only)      |

Gemini can also authenticate with Google Application Default Credentials (ADC, from `gcloud auth application-default login`).
`GOOGLE_APPLICATION_CREDENTIALS` gives the path to the credentials file. `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT` gives the
project ID when the file has no `quota_project_id`. `APPDATA` is set by Windows and locates the default gcloud folder.

How ADC is used:

- **Save it as the key.** Saving `adc` as the Gemini key in Settings sends every Gemini request to Vertex AI with ADC.
- **Gemini's own fallback.** When a Gemini AI Studio key cannot be used (400 `API_KEY_INVALID`, 401, 402, 403, 429), Gemini retries on Vertex AI with ADC. AI Studio aliases such as `gemini-flash-latest` do not exist on Vertex AI, so they are sent as the default Gemini model.
- **The Website Audit's fallback, on a runner bound to this computer only.** When no key is saved, or another provider refuses its key (401, 402, 403), the audit uses Gemini through ADC for the rest of that audit. The hosted copy never uses the machine's credentials.

Each failed AI request writes one line to the runner's console, with keys and tokens removed:
`[Website Audit] AI request failed (<provider>): <reason>`.

| Variable                 | Default                                  | Meaning                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QA_KEYS_ENCRYPTION_KEY` | none                                     | Optional secret, at least 16 characters, that encrypts `.qa-keys.json` instead of the generated local key file. Set it when the data folder outlives the machine's config folder, such as a Docker volume. Shorter values throw ([ADR 0034](adr/0034-encrypted-key-fallback.md)) |
| `XDG_CONFIG_HOME`        | `%APPDATA%` on Windows, else `~/.config` | Optional. Folder that holds `qa-flow-tester/key-file.key`, the local key for the encrypted key file ([ADR 0034](adr/0034-encrypted-key-fallback.md)). Holds a path, not a secret                                                                                                 |

Key order (`packages/core/src/ai/key-resolver.ts`): a key given for the run comes first (`QA_AI_API_KEY` in a check-up
from CI). Then, for the preferred provider: the OS keychain, the `.qa-keys.json` file, then the environment variable. If
that provider has no key, the others are tried in the order Anthropic, OpenAI, Gemini, OpenRouter, each with the same
three steps. `.qa-keys.json` is written only when the computer has no keychain. With no key at all, the Plan is written
by fixed rules and no AI is used. In a beta copy keys live in the visitor's session only.

## One check-up from CI (`packages/runner/src/checkup.ts`)

| Variable                   | Default      | Meaning                                                                                                                                                                              |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QA_TARGET_URL`            | required     | Address to check                                                                                                                                                                     |
| `QA_STAGING`               | `false`      | `true` marks it a test copy, so forms may be filled and sent. Anything else is read-only. Local and CI use only: no Verified Domain proof is needed there                            |
| `QA_AI_API_KEY`            | none         | The AI key                                                                                                                                                                           |
| `QA_AI_PROVIDER`           | `openrouter` | `openrouter`, `gemini`, `openai` or `anthropic`; anything else is an error                                                                                                           |
| `QA_OUTPUT_DIR`            | `qa-report`  | Report folder                                                                                                                                                                        |
| `QA_MAX_PAGES`             | `50`         | Page cap, 1 to 1000 (larger values are cut to 1000). Zero, negative or invalid values use 50. Flag: `--max-pages <n>`                                                                |
| `QA_FAIL_ON`               | `standard`   | When the build fails; see below. Flag: `--fail-on`                                                                                                                                   |
| `QA_CONCURRENCY`           | `2`          | Concurrent page evaluations, clamped to 1..5; an invalid value or `0` gives 2. Flag: `--concurrency <n>`                                                                             |
| `QA_DELAY_MS`              | `100`        | Per-page pacing delay in ms, clamped to 0..2000; `0` means no delay; an invalid (non-numeric) value gives 100. Flag: `--delay <n>`                                                   |
| `QA_CUSTOM_HEADERS`        | none         | JSON object `{"Name": "value"}`, or repeated `--header "Name: value"`. Up to 20 headers. Values are secrets. Invalid input stops startup with `QA_CUSTOM_HEADERS is not valid`       |
| `QA_DEBUG`                 | none         | Debug logging module (`crawl`, `auth`, `nav`) or `all`. Also turns on the report's `timing` list (phases in ms). Flag: `--debug [module]`                                            |
| `QA_RELOGIN`               | `1`          | Automatic one-time re-login when a session expires. `0` turns it off                                                                                                                 |
| `QA_CRAWL_MAX_MINUTES`     | `10`         | Spider crawl time budget in minutes. Also overrides the Website Audit's own crawl budget                                                                                             |
| `QA_DISCOVERY_MAX_MINUTES` | `20`         | Discovery agent total time budget in minutes                                                                                                                                         |
| `QA_USERNAME`              | none         | Test sign-in username. Used only when `QA_PASSWORD` is also set                                                                                                                      |
| `QA_PASSWORD`              | none         | Test sign-in password. Environment only, no flag. Use a repository secret                                                                                                            |
| `QA_LOGIN_PATH`            | none         | Optional sign-in page path, for example `/login`                                                                                                                                     |
| `QA_DOCS`                  | none         | Product Context files, `;` separated (`.md`, `.txt`, `.docx`). Same as `--docs a.md b.docx`, which takes every argument up to the next flag                                          |
| `QA_ROLES`                 | none         | JSON list of up to 10 role objects: `[{"role", "username", "password", "loginPath"?, "usernameSelector"?, "passwordSelector"?, "submitSelector"?}]`. Holds secrets. Environment only |
| `--test-cap <n>`           | `2000`       | Flag only, no variable. Most Tests the Check-up may run (clamped 1..100000); Rejects and Limits past it are switched off. Same as `testCap` on `POST /api/runner/run`                |

Other flags: `--staging`, `--output <dir>`, `--provider <name>`, `--preset smoke` (with `--health-path`,
`--expected-version`, `--confirm-live`: a Smoke Check-up of a few known paths).

`QA_FAIL_ON` gates the exit code:

- `standard`: exit 0 if there are no active Blockers and all 6 quality areas score at least C (60); exit 1 otherwise.
- `blocker`: exit 1 if any active Blocker exists.
- `major`: exit 1 if any active Blocker or Major exists.
- `none`: always exit 0.

Header limits: names must be valid HTTP header tokens and values must not contain control characters. Roles: each string
field under 500 characters; an invalid structure throws `ERR_INVALID_ROLES`; `loginPath` must stay on the target host
(an invalid one throws `ERR_INVALID_LOGIN_PATH`).

`--docs` and `QA_DOCS` follow the wizard's limits (text 500 KB, Word 2 MB, 10 documents; PDF and old `.doc` are refused).
Word files are converted in-process. With no `QA_AI_API_KEY`, Plan Items from the documents are written by fixed rules
([ADR 0023](adr/0023-word-in-scope-and-structured-spec-parsing.md)). A document that yields nothing prints a warning; if
every document does, the check-up exits with code 2.

Setting both `QA_USERNAME` and `QA_PASSWORD` is the consent to sign in and test fully
([ADR 0022](adr/0022-test-sign-in-as-consent.md)): the run is sent with `owner: true` and `signInConsent: true`. `QA_ROLES`
adds to them (role `member`) and carries the same consent. Use a test account on a test copy. A failed sign-in prints a
fixed reason and exits with code 2. Usernames and passwords are never printed or written to the summary. The signed-in
session lives in a temporary folder outside `QA_OUTPUT_DIR` and is deleted when the run ends.

**Sign-in in GitHub Actions is a manual step.** The workflow template does not pass `QA_USERNAME`, `QA_PASSWORD` or
`QA_LOGIN_PATH`. Add them as repository secrets, then add them to the `env:` block of the check-up job yourself (for
example `QA_USERNAME: ${{ secrets.QA_USERNAME }}`). Adding them is your consent for every run of that workflow. Never
write the values into the workflow file.

The check-up runs in-process on the Check-up Session and binds no network port
([ADR 0027](adr/0027-checkup-session-module-and-route-table.md)). When `GITHUB_ACTIONS=true` it prints annotations for
active Blockers (error) and Majors (warning). When `GITHUB_STEP_SUMMARY` is set, the run summary is appended to that
file. Both are set by GitHub, not by you.

## Sign-in and crawl limits

- **Supported login shapes:** single-page form, two-step login (username, continue, password, submit), and modal openers (a form in a modal, drawer or dialog opened by a button). Custom selectors per role: `usernameSelector`, `passwordSelector`, `submitSelector`, `postLoginSelector`, `postLoginUrl`.
- **Not supported:** CAPTCHA, one-time passwords (OTP, 2FA, SMS), and external SSO or OAuth identity providers. Workaround: a saved session (Playwright `storageState` JSON) passed in `savedSessions` ([ADR 0021](adr/0021-saved-sessions-memory-only-and-confined-docs-fetch.md)).
- **Caps and budgets:**
  - Pages: the Spider defaults to 200 (`DEFAULT_MAX_PAGES`); a CI check-up uses `QA_MAX_PAGES`.
  - Shape and depth: at most 25 pages per route shape (`maxPerShape`) and depth 8 (`maxDepth`). A route shape replaces digit runs, UUIDs and 6+ character hex tokens with `:n` / `:id`, which is what bounds traps.
  - Clicks: at most 8 per page (`MAX_CLICKS_PER_PAGE`) and 100 exploration clicks in total (`MAX_EXPLORATION_CLICKS`).
  - Modal openers: at most 6 per page (`MAX_OPENERS_PER_PAGE`).
  - Time: crawl 10 minutes, discovery 20 minutes (the two variables above), a CI check-up 40 minutes (`RUN_TIMEOUT_MS`).
  - Context documents: at most 10 (`MAX_CONTEXT_DOCUMENTS`), 500 KB of text each (`MAX_CONTEXT_DOC_BYTES`), Word files 2 MB (`DOCX_MAX_BYTES`). Context URL fetch: at most 20 pages (`DOCS_MAX_PAGES`), 1 MB in total (`DOCS_MAX_BYTES`).
  - Saved sessions: up to 256 KB of JSON (`MAX_SESSION_BYTES`), cookies scoped to the target origin.
  - Roles: up to 10 (`MAX_ROLES`), string fields under 500 characters (`MAX_ROLE_FIELD_CHARS`).
  - Custom headers: up to 20 (`MAX_CUSTOM_HEADERS`).
- **Skip reasons (`pageCoverage.skipped[].why`, `packages/types/src/route-telemetry.ts`):** `page-limit`, `did-not-load`, `robots` (disallowed by `robots.txt`), `sign-in` (gated, no valid session), `http-error` (main frame answered 4xx or 5xx), `timeout`, `off-site-redirect`, `time-limit`, `trap-limit`, `session-lost`, `duplicate`.
- **Robots behaviour:** on a host that is not private or loopback, the Discovery Agent fetches the start origin's `robots.txt` and the Spider asks that policy about each route before the page opens; a disallowed route is skipped with reason `robots`. One policy covers the crawl, taken from the start origin. On the person's own machine no policy is sent and no pacing delay is added.

## Wizard (front end)

| Variable                  | Default                 | Meaning                                                                                          |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `VITE_RUNNER_URL`         | `http://localhost:3001` | Only for `pnpm dev:wizard` hot reload: where the wizard's API calls go                           |
| `VITE_BASE`               | `/`                     | Base path for static hosting                                                                     |
| `VITE_ONLINE_APP_URL`     | none                    | Address of the online app (the runner). Shows an "Open the online app" button on the static site |
| `VITE_WAKE_LIMIT_SECONDS` | `90`                    | How long the landing page waits for the online copy to wake, in seconds (5 to 600)               |
| `VITE_COUNTER_URL`        | none                    | Full GoatCounter-style `https://.../count` endpoint. Unset: no counting and no request           |
| `VITE_CONTACT_EMAIL`      | none                    | Landing footer shows a mailto. Unset: GitHub issues                                              |

The `VITE_*` values are read when the wizard is built and must be public values only. The deploy workflow sets them in
the site build; the runner Dockerfile takes the two landing ones as build args. See `LANDING_MEASUREMENT.md`.

## Entity Namespacing (Test Copy only)

No variable. Namespacing applies only when the Check-up runs against a Test Copy (`QA_STAGING`); a read-only Check-up types values unchanged and sends nothing.

- **Token.** Each Test gets a token of six lowercase letters, made from the run, the Test and the screen size. It is the same on every attempt of that Test. It holds no secret.
- **Gets the token.** Email addresses (`jo@example.com` becomes `jo+token@example.com`), plain short text such as a name (`Jane Doe` becomes `Jane Doe token`), and the `{{unique}}` and `{{entityName}}` placeholders.
- **Never gets it.** Sign-in details (`{{username}}`, `{{password}}`), numbers, phone numbers, dates, codes, search terms, fields that look like a password, empty values, and text longer than 80 characters.

## Retries

No variable. Retries apply to every Check-up, read-only or Test Copy.

- **Which failures.** Only transient ones: a navigation timeout, a network error, or a browser that crashed or closed under the test. A failed step, a missing element or a failed check is a real result, reported once.
- **How.** A failed Test is tried again from step 1 in a fresh browser, up to `flakyReruns` more times (default 3, stopping at the first pass; link tests never). A Test that fails then passes is flaky-passed: it counts as passed, and the report shows how many attempts passed ("1 of 2") and a likely cause (timing, state-leakage, network). Nothing is skipped or quarantined, and no timeout is raised.
- **After a send.** If the Test already sent a change (POST, PUT, PATCH or DELETE) to the checked site's own host after a click, it is not tried again, because a second try would send the form twice. The failure is reported with the note "Not tried again".
- **What counts.** Only changes to the exact host of the checked site. Other sites (analytics) are ignored, so a form that posts to another subdomain is not detected and a duplicate is still possible there. Any change request to the own host after the first click counts, including analytics, polling, token refresh and GraphQL reads sent by POST; such a Test is reported as failed instead of flaky-passed. This fails safe: no duplicate, but retry coverage is lost.

## Scripts

| Variable             | Default | Meaning                                                                                                                                                                                                                                                                  |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SKIP_BROWSER_CHECK` | none    | `1` skips the check that the browser is installed when `pnpm start` runs                                                                                                                                                                                                 |
| `SMOKE_PORT`         | `3591`  | Port the smoke run (`pnpm smoke`) listens on                                                                                                                                                                                                                             |
| `GITHUB_SHA`         | none    | Set by the build host. The commit that `scripts/site-output.mjs` writes into the site's `version.json`                                                                                                                                                                   |
| `GCP_PROJECT`        | none    | Google Cloud project ID. Used by `scripts/deploy-cloud-run.mjs` (default `qa-flow-tester-512310`) and, with GOOGLE_CLOUD_PROJECT, as the project for Gemini through Google sign-in. There is no built-in default for that: without a project, Google sign-in is refused. |
| `GCP_REGION`         | none    | Region for `scripts/deploy-cloud-run.mjs` (default `us-central1`)                                                                                                                                                                                                        |

`CI` and `RUNNER_PORT` are read by the scripts too (`scripts/start.mjs`, `scripts/tunnel.mjs`). `CI` set stops
`pnpm start` from opening a browser tab.

## Ports

- `3001`: the QA Tool (wizard at `/`, API under `/api`)
- `3591`: the smoke run (`pnpm smoke`; set `SMOKE_PORT` to change)
- `8080`: the container port on Cloud Run (see [DEPLOYMENT.md](DEPLOYMENT.md))
