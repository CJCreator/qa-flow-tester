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
| `RUNNER_ACCESS_TOKEN`                         | none                | A key every request must carry (`?access=<key>` sets a cookie; scripts send `X-QA-Access`). Required whenever the server is reachable beyond this computer                                                                                                                |
| `RUNNER_ALLOWED_ORIGINS`                      | none                | Comma-separated extra origins allowed to call the API. Warns if set without an access token                                                                                                                                                                               |
| `RUNNER_LOCALHOST_ALIAS`                      | none                | Host name that stands for localhost when the runner runs in a container                                                                                                                                                                                                   |
| `RUNNER_BETA`                                 | off                 | `1` turns on shared-beta mode: keys and sign-ins live in memory per session, only public sites can be checked, some routes are closed; a Test Copy needs a Verified Domain proof, and addresses (or redirects, or DNS answers) that lead to private addresses are refused |
| `RUNNER_BETA_RUNS_PER_VISITOR`                | `5`                 | Beta only: most check-ups plus comparisons one visitor session may start per UTC day. Invalid values (not a whole number of at least 1) use the default. Memory only; a restart resets it                                                                                 |
| `RUNNER_BETA_RUNS_PER_DAY`                    | `40`                | Beta only: most check-ups plus comparisons the whole shared copy may start per UTC day. Same rules as above                                                                                                                                                               |
| `RUNNER_STEP_TIMEOUT_MS`                      | `10000`             | Most time one test step may spend finding and acting on its element, in milliseconds, across retries. Raise for slow pages. Invalid or non-positive values use the default; maximum 300000                                                                                |
| `PUBLIC_URL`, `RENDER`, `RENDER_EXTERNAL_URL` | none                | Set by the hosting platform; used for origin checks and links                                                                                                                                                                                                             |

The same limit is the `stepTimeoutMs` option when running the orchestrator from code.

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

Key order (see `core/ai/key-resolver.ts`): command line, then the OS keychain, then the legacy `.qa-keys.json`
file, then the environment. With no key at all, the Plan is written by fixed rules and no AI is used.

Provider limits worth knowing (they change; the tool reads what the key reports): OpenRouter's free models allow 20
requests a minute, and 50 a day until the account has bought 10 credits (then 1,000). Paid keys have higher limits.

## One check-up from CI (`packages/runner/src/checkup.ts`)

| Variable         | Default      | Meaning                                                                                                                                                   |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QA_TARGET_URL`  | required     | Address to check                                                                                                                                          |
| `QA_STAGING`     | `false`      | `true` marks it a test copy, so forms may be filled and sent. Anything else is read-only. Local and CI use only: no Verified Domain proof is needed there |
| `QA_AI_API_KEY`  | none         | The AI key                                                                                                                                                |
| `QA_AI_PROVIDER` | `openrouter` | `openrouter`, `gemini`, `openai` or `anthropic`                                                                                                           |
| `QA_OUTPUT_DIR`  | `qa-report`  | Report folder                                                                                                                                             |
| `QA_MAX_PAGES`   | `50`         | Page cap, to stay inside free Actions minutes                                                                                                             |
| `QA_FAIL_ON`     | `blocker`    | `blocker`, `major` or `none`: when the build fails                                                                                                        |
| `QA_USERNAME`    | none         | Test sign-in username. Used only when `QA_PASSWORD` is also set                                                                                           |
| `QA_PASSWORD`    | none         | Test sign-in password. Environment only: there is no flag for it. Use a repository secret                                                                 |
| `QA_LOGIN_PATH`  | none         | Optional sign-in page path, for example `/login`                                                                                                          |

Setting both `QA_USERNAME` and `QA_PASSWORD` is the consent to sign in and test fully ([ADR 0022](adr/0022-test-sign-in-as-consent.md)): the run is sent with `owner: true` and `signInConsent: true`. Use a test account on a test copy. Without them the check-up is unchanged. A failed sign-in prints a fixed reason and exits with code 2. The password and username are never printed or written to the summary, and the session is not saved.

The CI check-up uses port 3601 internally. When `GITHUB_ACTIONS=true` it also prints annotations for active Blockers (error) and Majors (warning); there is no setting for it.

## Wizard (front end)

| Variable                  | Meaning                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `VITE_RUNNER_URL`         | Only for `pnpm dev` hot reload: where the wizard's API calls go                                |
| `VITE_BASE`               | Base path for static hosting                                                                   |
| `VITE_ONLINE_APP_URL`     | Address of the online app. Shows an "Open the online app" button on the Vercel site            |
| `VITE_WAKE_LIMIT_SECONDS` | How long the landing page waits for the online copy to wake, in seconds (5 to 600). Default 90 |
| `WIZARD_SCREENSHOTS`      | Turns on screenshot capture in the wizard end-to-end test                                      |
| `VITE_COUNTER_URL`        | Full GoatCounter-style `https://.../count` endpoint. Unset = no counting and no request        |
| `VITE_CONTACT_EMAIL`      | Landing footer shows a mailto. Unset = GitHub issues                                           |
| `VITE_SIGNUP_URL`         | https form-post endpoint for the email-updates control. Unset = "Send feedback" link           |

The three landing variables are read when the wizard is built and must be public values only. Set them in both
the Vercel project and Render (the runner Dockerfile takes them as build args). See `LANDING_MEASUREMENT.md`.

## Entity Namespacing and retries (Test Copy only)

No new variable. This applies only when the Check-up runs against a Test Copy (see `QA_STAGING`); a read-only Check-up types values unchanged and sends nothing.

- **Token.** Each Test gets a token of six lowercase letters, made from the run, the Test and the screen size. It is the same on every attempt of that Test. It holds no secret.
- **Gets the token.** Email addresses (`jo@example.com` becomes `jo+token@example.com`), plain short text such as a name (`Jane Doe` becomes `Jane Doe token`), and the `{{unique}}` and `{{entityName}}` placeholders.
- **Never gets it.** Sign-in details (`{{username}}`, `{{password}}`), numbers, phone numbers, dates, codes, search terms, fields that look like a password, empty values, and text longer than 80 characters.
- **Retry rule.** A failed Test is normally tried once more from step 1 in a fresh browser. If the Test already sent a change (POST, PUT, PATCH or DELETE) to the checked site's host after a click, it is not tried again, because a second try would send the form twice. The failure is reported as it happened, with the note "Not tried again". A Test that failed before sending anything is still retried and can be reported as flaky-passed.
- **What counts.** Only changes to the checked site's own host. Other sites (analytics) and background pings are ignored. Link checks are never retried.
- **Same-host background traffic.** Any change request to the checked site's own host after the first click counts, including analytics, polling, token refresh and GraphQL reads sent by POST. A flaky Test that makes one is reported as failed instead of flaky-passed. This fails safe: no duplicate is created, but retry coverage is lost.
- **Other subdomains are not seen.** The match is the exact host. A form that posts to another subdomain (for example `api.` or `www.` of the checked site) is not detected, so the Test can still be retried and a duplicate is still possible there.

## Ports

- `3001`: the QA Tool (wizard at `/`, API under `/api`)
- `3601`: internal, CI check-up only
- `3050`: the fixture test app (`pnpm fixture`; set `PORT` to change)
