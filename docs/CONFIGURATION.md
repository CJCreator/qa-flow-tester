# Configuration

Every setting the code reads. Names were collected from `process.env` use in `packages/` and `scripts/`.
Settings can go in the shell or in a `.env` file at the repo root (never commit it).

## Runner (the server)

| Variable                                      | Default             | Meaning                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNNER_PORT`                                 | `3001`              | Port. On Render, `PORT` is used instead                                                                                                                                                                                                                                   |
| `RUNNER_HOST`                                 | `localhost`         | Bind address. Use `0.0.0.0` only in a container or behind a proxy                                                                                                                                                                                                         |
| `RUNNER_DATA_DIR`                             | `.qa-data/`         | Site memory, history, waiting plans, saved model choices                                                                                                                                                                                                                  |
| `RUNNER_OUTPUT_DIR`                           | `.qa-runner-report` | Where reports are written                                                                                                                                                                                                                                                 |
| `RUNNER_ACCESS_TOKEN`                         | none                | A key every request must carry (`?access=<key>` sets a cookie; scripts send `X-QA-Access`). Required whenever the server is reachable beyond this computer: the runner refuses to start on a non-loopback `RUNNER_HOST` (such as `0.0.0.0`) without it                    |
| `RUNNER_ALLOWED_ORIGINS`                      | none                | Comma-separated extra origins allowed to call the API. Warns if set without an access token                                                                                                                                                                               |
| `RUNNER_LOCALHOST_ALIAS`                      | none                | Host name that stands for localhost when the runner runs in a container                                                                                                                                                                                                   |
| `RUNNER_BETA`                                 | off                 | `1` turns on shared-beta mode: keys and sign-ins live in memory per session, only public sites can be checked, some routes are closed; a Test Copy needs a Verified Domain proof, and addresses (or redirects, or DNS answers) that lead to private addresses are refused |
| `RUNNER_BETA_RUNS_PER_VISITOR`                | `5`                 | Beta only: most check-ups plus comparisons one visitor session may start per UTC day. Invalid values (not a whole number of at least 1) use the default. Memory only; a restart resets it                                                                                 |
| `RUNNER_BETA_RUNS_PER_DAY`                    | `40`                | Beta only: most check-ups plus comparisons the whole shared copy may start per UTC day. Same rules as above                                                                                                                                                               |
| `RUNNER_STEP_TIMEOUT_MS`                      | `10000`             | Most time one test step may spend finding and acting on its element, in milliseconds, across retries. Raise for slow pages. Invalid or non-positive values use the default; maximum 300000                                                                                |
| `RUNNER_WAITING_PLAN_DAYS`                    | `30`                | Days a waiting Plan (one not yet approved) is kept before it is removed. Whole days, at least 1; other values use 30. Removed Plans are named in the log                                                                                                                  |
| `PUBLIC_URL`                                  | none                | Public address (for example `https://qa.example.com`) when served behind a domain or tunnel. Used for absolute links, canonical tags and the sitemap. Unset: the request's own host is used                                                                              |
| `RENDER`, `RENDER_EXTERNAL_URL`               | none                | Set by Render. With `RENDER`, `PORT` sets the port. `RENDER_EXTERNAL_URL` is allowed as an origin                                                                                                                                                                        |

The same limit is the `stepTimeoutMs` option when running the orchestrator from code.

**Beta copy (`RUNNER_BETA=1`).** A public beta. Its only protection is the address guard: private addresses are refused, and every outbound request uses the pinned, redirect-checked resolver ([ADR 0031](adr/0031-every-outbound-request-uses-pinned-resolver.md)). There are no accounts. Its data is temporary: the free host has no persistent disk, so check-ups, Plans and comparisons are lost on a restart or redeploy. A visitor keeps only their newest 10 finished check-ups.

**Browser.** Chromium runs with `--no-sandbox`, and that is kept on purpose. Each target host gets its own browser process, so one site's pages never share a process with another's. The runner runs as the non-root `pwuser` in the container. There is no setting for this.

## Run options set in code

No environment variable. These are options of the orchestrator (and the run request), with their defaults:

- `breakpoints`: `375px`, `768px` and `1440px` when a run names no sizes. (The default was `1440px` only before T-55.)
- `testPointWorkers`: `1`, which runs test points one at a time. Read-only runs only, up to 5 lanes. A test-copy run always runs one lane.
- `flakyReruns`: `3` reruns of a failed test point, stopping at the first pass. Link checks are never rerun.
- `timing`: off. On when `QA_DEBUG` is set; the report then has a `timing` list of phases in ms.

## Evidence (screenshots and video)

- Screenshots are taken for failed steps only. Sign-in fields are masked in them: password inputs, username inputs (`autocomplete="username"`) and email inputs.
- Video (`QA_RECORD_VIDEO`) is kept only for failed test points. A run that signs in records no video, because a video cannot mask those fields.

## Visual baselines (Perceptual Visual Diff)

Profile fields (code and `ProductProfile` JSON; there are no environment variables):

- `visualBaselineDir`: where baselines are kept (default `.qa-baselines`).
- `visualDiffMaxPercent`: fraction of pixels allowed to differ (default `0.01`).
- `visualMaskSelectors`: extra CSS selectors painted over in newly recorded baselines. Stored in the baseline's `.visual.json` file beside the PNG. Invalid selectors are skipped.

New baselines automatically mask dates and times, well-known ad slots and password fields. Baselines recorded before this (no `.visual.json`, or a PNG replaced since) keep comparing unmasked, exactly as before. Re-record with update mode to adopt masking. See ADR 0019.

## AI providers

Bring your own key. Supported providers: OpenRouter (default in CI), Gemini, OpenAI, Anthropic, and a mock for tests.

| Variable                                                                      | Meaning                                 |
| ----------------------------------------------------------------------------- | --------------------------------------- |
| `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider keys read from the environment |
| `TEST_MOCK_AI`                                                                | Use the mock provider (tests)           |

Key order (see `packages/core/src/ai/key-resolver.ts`): a key given for the run comes first (command line, or `QA_AI_API_KEY` in
a check-up from CI). Then, for the preferred provider: the OS keychain, the legacy `.qa-keys.json` file, then the environment
variable. If that provider has no key, the others are tried in the order Anthropic, OpenAI, Gemini, OpenRouter, each with the
same three steps. The keychain is used when the computer has one. `.qa-keys.json` is written only when it does not. With no key
at all, the Plan is written by fixed rules and no AI is used. In a beta copy keys live in the visitor's session only.

Provider limits worth knowing (they change; the tool reads what the key reports): OpenRouter's free models allow 20
requests a minute, and 50 a day until the account has bought 10 credits (then 1,000). Paid keys have higher limits.

## One check-up from CI (`packages/runner/src/checkup.ts`)

| Variable                   | Default      | Meaning                                                                                                                                                                   |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QA_TARGET_URL`            | required     | Address to check                                                                                                                                                          |
| `QA_STAGING`               | `false`      | `true` marks it a test copy, so forms may be filled and sent. Anything else is read-only. Local and CI use only: no Verified Domain proof is needed there                 |
| `QA_AI_API_KEY`            | none         | The AI key                                                                                                                                                                |
| `QA_AI_PROVIDER`           | `openrouter` | `openrouter`, `gemini`, `openai` or `anthropic`                                                                                                                           |
| `QA_OUTPUT_DIR`            | `qa-report`  | Report folder                                                                                                                                                             |
| `QA_MAX_PAGES`             | `50`         | Page cap, clamped to 1..1000. `0` means no cap (the run uses the 1000 ceiling). Invalid values use 50. Keeps run within time budgets                                      |
| `QA_FAIL_ON`               | `standard`   | `standard` (default: fails if any active Blocker or any of 6 areas scores below C / 60), `blocker` (fails if active Blocker), `major` (fails if Blocker/Major), or `none` |
| `QA_CONCURRENCY`           | `2`          | Number of concurrent page evaluations (1 to 5; clamped). Flag: `--concurrency <n>`                                                                                        |
| `QA_DELAY_MS`              | `100`        | Per-page pacing delay in milliseconds (0 to 2000; clamped). `0` means no delay. Flag: `--delay <n>`                                                                       |
| `QA_RECORD_VIDEO`          | unset        | `true` or `false`: a video of each failed test point. Unset: off on CI and GitHub Actions, on elsewhere. Never for a run that signs in                                    |
| `QA_CUSTOM_HEADERS`        | none         | JSON object `{"Name": "value"}` or repeated `--header "Name: value"`. Up to 20 headers. Sent only to the target host and allowlisted hosts. Values are secrets            |
| `QA_DEBUG`                 | none         | Debug logging module or `all`. Also turns on timing entries in the report (`timing`). Flag: `--debug [module]`                                                            |
| `QA_RELOGIN`               | `1`          | `1` enables automatic one-time re-login when a session expires; `0` disables it                                                                                           |
| `QA_CRAWL_MAX_MINUTES`     | `10`         | Spider crawl timeout budget in minutes                                                                                                                                    |
| `QA_DISCOVERY_MAX_MINUTES` | `20`         | Discovery agent total time budget in minutes                                                                                                                              |
| `QA_USERNAME`              | none         | Test sign-in username. Used only when `QA_PASSWORD` is also set                                                                                                           |
| `QA_PASSWORD`              | none         | Test sign-in password. Environment only: there is no flag for it. Use a repository secret                                                                                 |
| `QA_LOGIN_PATH`            | none         | Optional sign-in page path, for example `/login`                                                                                                                          |
| `QA_DOCS`                  | none         | Product Context files, `;` separated (`.md`, `.txt`, `.docx`). Same as `--docs a.md b.docx`, which takes every argument up to the next flag                               |
| `QA_ROLES`                 | none         | JSON list of up to 10 role objects: `[{"role", "username", "password", "loginPath"?, "usernameSelector"?, "passwordSelector"?, "submitSelector"?}]`. Holds secrets        |
| `--test-cap <n>`           | `2000`       | Flag only, no variable. Most Tests the Check-up may run (clamped 1..100000); Rejects and Limits past it are switched off. Same as `testCap` on `POST /api/runner/run`     |

`QA_FAIL_ON` gates the process exit code:

- `standard` (default): Exit 0 if 0 active Blockers AND all 6 quality areas score >= C (score >= 60); Exit 1 otherwise.
- `blocker`: Exit 1 if any active Blocker finding exists; Exit 0 otherwise.
- `major`: Exit 1 if any active Blocker or Major finding exists; Exit 0 otherwise.
- `none`: Always exits 0.

Clamp ranges and invalid inputs:

- `QA_CONCURRENCY` is clamped to 1..5 (default 2).
- `QA_DELAY_MS` is clamped to 0..2000 ms (default 100). `0` means no delay.
- `QA_MAX_PAGES` is clamped to 1..1000 (default 50). `0` means no page cap, so the run uses the 1000 ceiling. Invalid values are read as 50.
- `QA_CUSTOM_HEADERS` must be a valid JSON object or valid `--header "Header: Value"` strings. Up to 20 headers (`MAX_CUSTOM_HEADERS`). Header names must be valid HTTP header tokens; header values must not contain control characters. Invalid input throws an error and stops check-up startup (`QA_CUSTOM_HEADERS is not valid`).
- `QA_ROLES` takes up to 10 roles (`MAX_ROLES`). Each string field must be under 500 characters (`MAX_ROLE_FIELD_CHARS`). Invalid role structure throws `ERR_INVALID_ROLES`. `loginPath` must stay on the target host (apex/www equal, protocol-relative rejected); invalid `loginPath` throws `ERR_INVALID_LOGIN_PATH`.

`--docs` and `QA_DOCS` follow the wizard's limits (text 500 KB, Word 2 MB, 10 documents; PDF and old `.doc` are refused). Word files are converted in-process. With no `QA_AI_API_KEY`, Plan Items from the documents are written by fixed rules ([ADR 0023](adr/0023-word-in-scope-and-structured-spec-parsing.md)). A document that yields nothing prints a warning; if every document does, the check-up exits with code 2. `QA_ROLES` adds to `QA_USERNAME`/`QA_PASSWORD` (role `member`); any sign-in is the ADR 0022 consent. Usernames and passwords are never printed.

Setting both `QA_USERNAME` and `QA_PASSWORD` is the consent to sign in and test fully ([ADR 0022](adr/0022-test-sign-in-as-consent.md)): the run is sent with `owner: true` and `signInConsent: true`. Use a test account on a test copy. Without them the check-up is unchanged. A failed sign-in prints a fixed reason and exits with code 2. The password and username are never printed or written to the summary. The signed-in session lives in a temporary folder outside `QA_OUTPUT_DIR` (so it is not in the uploaded artifact) and is deleted when the run ends. `QA_CHECKUP_PORT` is now unused and ignored: the CI check-up executes directly on the Check-up Session without binding a network port ([ADR 0027](adr/0027-checkup-session-module-and-route-table.md)).

**Sign-in in GitHub Actions is a manual step.** `.github/workflows/qa-check.yml` does not pass `QA_USERNAME`, `QA_PASSWORD` or `QA_LOGIN_PATH`, so a CI Check-up there is unchanged. To use them, add the values as repository secrets (Settings, Secrets and variables, Actions), then add them to the `env:` block of the check-up job yourself (for example `QA_USERNAME: ${{ secrets.QA_USERNAME }}`). Adding them is your consent to sign in and send forms on that address for every run of the workflow, per [ADR 0022](adr/0022-test-sign-in-as-consent.md). Use a test account only. Never write the values into the workflow file.

The CI check-up runs in-process on the Check-up Session without binding a network port (`QA_CHECKUP_PORT` is ignored). When `GITHUB_ACTIONS=true` it also prints annotations for active Blockers (error) and Majors (warning); there is no setting for it. When `GITHUB_STEP_SUMMARY` is set (GitHub Actions sets it), the run summary is also appended to that file. Both are set by GitHub, not by you. `CI=true` (most CI systems set it) turns video off by default, as `QA_RECORD_VIDEO` describes.

## Sign-in and crawl limits

- **Supported login shapes:** Single-page form (`username` + `password` + `submit`), two-step login (username -> continue -> password -> submit), and modal openers (sign-in form inside a modal, drawer, or dialog opened by a button). Custom selectors can be specified per role via `usernameSelector`, `passwordSelector`, `submitSelector`, `postLoginSelector`, and `postLoginUrl`.
- **Not supported:** CAPTCHA, one-time passwords (OTP/2FA/SMS), and external SSO/OAuth identity providers. Workaround: saved sessions via Playwright `storageState` JSON passed in `savedSessions` ([ADR 0021](adr/0021-saved-sessions-memory-only-and-confined-docs-fetch.md)).
- **Caps and budgets:**
  - Pages: Crawler defaults to 200 pages (`DEFAULT_MAX_PAGES`), CLI defaults to 50 (`QA_MAX_PAGES`, clamped 1..1000). The limit is checked before a page's work, so a page it drops costs no browser round trip and leaves no screenshot behind (T-307).
  - Route shapes and depth: at most 25 pages per route shape (`maxPerShape`, default 25) and depth 8 from the start (`maxDepth`, default 8). A page's shape replaces digit runs, UUIDs and 6+ character hex tokens with `:n` / `:id`, which is what bounds traps.
  - Route keys are not paths: the Spider dedupes on a lower-cased, trailing-slash-trimmed key (`normalizeRoute`), while everything a person reads — `skipped[].urlPath`, `signInWalls`, the robots note — carries the path as it was asked for.
  - Clicks: At most 8 clicks per page (`MAX_CLICKS_PER_PAGE`), at most 100 exploration clicks total (`MAX_EXPLORATION_CLICKS`).
  - Modal openers: At most 6 interactive openers evaluated per page (`MAX_OPENERS_PER_PAGE`).
  - Time budgets: Crawl limit 10 minutes (`QA_CRAWL_MAX_MINUTES`), discovery limit 20 minutes (`QA_DISCOVERY_MAX_MINUTES`), runner check-up timeout 40 minutes (`RUN_TIMEOUT_MS`).
  - Context documents: At most 10 documents (`MAX_CONTEXT_DOCUMENTS`), at most 500 KB text each (`MAX_CONTEXT_DOC_BYTES`). Word files (.docx) up to 2 MB (`DOCX_MAX_BYTES`). Context URL fetch at most 20 pages (`DOCS_MAX_PAGES`), 1 MB total (`DOCS_MAX_BYTES`).
  - Saved sessions: Up to 256 KB JSON (`MAX_SESSION_BYTES`), cookies scoped to target origin.
  - Roles: Up to 10 roles (`MAX_ROLES`), string fields under 500 characters (`MAX_ROLE_FIELD_CHARS`).
  - Custom headers: Up to 20 custom headers (`MAX_CUSTOM_HEADERS = 20`).
- **Skip reasons (`pageCoverage.skipped[].why`):**
  - `page-limit`: Reached the maximum page exploration limit.
  - `did-not-load`: Page failed to load or did not answer within timeout.
  - `robots`: Disallowed by the site's `robots.txt` rules.
  - `sign-in`: Page gated by authentication where no valid session or credentials were provided.
  - `http-error`: Main-frame navigation returned HTTP 4xx or 5xx status.
  - `timeout`: Navigation timed out during page evaluation.
  - `off-site-redirect`: Redirected to an external or third-party origin.
  - `time-limit`: Crawl exceeded total allocated time budget.
  - `trap-limit`: Repeated structural patterns flagged as a crawl trap.
  - `session-lost`: Session expired or was invalidated during crawl.
  - `duplicate`: Canonical or fingerprint duplicate of an already visited page.
- **Robots behaviour:** On a host that is not private or loopback (`isPrivateHost`), the Discovery Agent fetches the start origin's `robots.txt` (as `CRAWLER_TOKEN`) and the Spider asks that policy about each route's path and query before the page opens; a disallowed route is skipped with reason `robots` and named in the crawl's politeness note. One policy covers the crawl, taken from the start origin — a site that rebases onto another host is judged by the start origin's rules. On the person's own machine no policy is sent and no pacing delay is added.

## Wizard (front end)

| Variable                  | Meaning                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `VITE_RUNNER_URL`         | Only for `pnpm dev` hot reload: where the wizard's API calls go. Default `http://localhost:3001` |
| `VITE_BASE`               | Base path for static hosting                                                                     |
| `VITE_ONLINE_APP_URL`     | Address of the online app. Shows an "Open the online app" button on the Vercel site              |
| `VITE_WAKE_LIMIT_SECONDS` | How long the landing page waits for the online copy to wake, in seconds (5 to 600). Default 90   |
| `WIZARD_SCREENSHOTS`      | Turns on screenshot capture in the wizard end-to-end test                                        |
| `VITE_COUNTER_URL`        | Full GoatCounter-style `https://.../count` endpoint. Unset = no counting and no request          |
| `VITE_CONTACT_EMAIL`      | Landing footer shows a mailto. Unset = GitHub issues                                             |
| `VITE_SIGNUP_URL`         | https form-post endpoint for the email-updates control. Unset = "Send feedback" link             |

The three landing variables are read when the wizard is built and must be public values only. Set them in both
the Vercel project and Render (the runner Dockerfile takes them as build args). See `LANDING_MEASUREMENT.md`.

## Entity Namespacing (Test Copy only) and retries

No new variable. Namespacing applies only when the Check-up runs against a Test Copy (see `QA_STAGING`); a read-only Check-up types values unchanged and sends nothing.

- **Token.** Each Test gets a token of six lowercase letters, made from the run, the Test and the screen size. It is the same on every attempt of that Test. It holds no secret.
- **Gets the token.** Email addresses (`jo@example.com` becomes `jo+token@example.com`), plain short text such as a name (`Jane Doe` becomes `Jane Doe token`), and the `{{unique}}` and `{{entityName}}` placeholders.
- **Never gets it.** Sign-in details (`{{username}}`, `{{password}}`), numbers, phone numbers, dates, codes, search terms, fields that look like a password, empty values, and text longer than 80 characters.
## Retries

No new variable. Retries apply to every Check-up, read-only or Test Copy.

- **Which failures.** Only transient failures are tried again: a navigation timeout, a network error, or a browser that crashed or closed under the test. A failed step, a missing element or a failed check is a real result. It is reported once and not tried again.
- **How.** A failed Test is tried again from step 1 in a fresh browser, up to `flakyReruns` more times (default 3, stopping at the first pass; link tests are never tried again). A test that fails then passes is flaky-passed, still counts as passed, and the report shows how many attempts passed ("1 of 2") and a likely cause (timing, state-leakage, network). Nothing is skipped or quarantined, and no timeout is raised.
- **After a send.** If the Test already sent a change (POST, PUT, PATCH or DELETE) to the checked site's host after a click, it is not tried again, because a second try would send the form twice. The failure is reported as it happened, with the note "Not tried again". A Test that failed before sending anything is still retried, if the failure was transient.
- **What counts.** Only changes to the checked site's own host. Other sites (analytics) and background pings are ignored. Link checks are never retried.
- **Same-host background traffic.** Any change request to the checked site's own host after the first click counts, including analytics, polling, token refresh and GraphQL reads sent by POST. A flaky Test that makes one is reported as failed instead of flaky-passed. This fails safe: no duplicate is created, but retry coverage is lost.
- **Other subdomains are not seen.** The match is the exact host. A form that posts to another subdomain (for example `api.` or `www.` of the checked site) is not detected, so the Test can still be retried and a duplicate is still possible there.

## Scripts

| Variable                   | Default | Meaning                                                                                                             |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `SKIP_BROWSER_CHECK`       | none    | `1` skips the check that the browser is installed when `pnpm start` runs                                            |
| `SMOKE_PORT`               | `3591`  | Port the smoke run (`pnpm smoke`) listens on                                                                        |
| `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA` | none | Set by the build host. The commit that `scripts/vercel-output.mjs` reports for the Vercel build                 |
| `NODE_ENV`                 | none    | Set to `test` by the benchmark script (`scripts/benchmark.ts`) so the fixture does not listen on its usual port     |

`CI` and `RUNNER_PORT` are read by the scripts too: see the Runner and CI sections above.

## Ports

- `3001`: the QA Tool (wizard at `/`, API under `/api`)
- `3601`: previously used by CI check-up (`QA_CHECKUP_PORT`), now unused as CLI check-ups run directly on the session
- `3050`: the fixture test app (`pnpm fixture`; set `PORT` to change)
- `3591`: the smoke run (`pnpm smoke`; set `SMOKE_PORT` to change)
