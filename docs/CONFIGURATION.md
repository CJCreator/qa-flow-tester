# Configuration

Every setting the code reads. Names were collected from `process.env` use in `packages/` and `scripts/`.
Settings can go in the shell or in a `.env` file at the repo root (never commit it).

## Runner (the server)

| Variable                                      | Default             | Meaning                                                                                                                                                    |
| --------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNNER_PORT`                                 | `3001`              | Port. On Render, `PORT` is used instead                                                                                                                    |
| `RUNNER_HOST`                                 | `localhost`         | Bind address. Use `0.0.0.0` only in a container or behind a proxy                                                                                          |
| `RUNNER_DATA_DIR`                             | `.qa-data/`         | Site memory, history, waiting plans, saved model choices                                                                                                   |
| `RUNNER_OUTPUT_DIR`                           | `.qa-runner-report` | Where reports are written                                                                                                                                  |
| `RUNNER_ACCESS_TOKEN`                         | none                | A key every request must carry (`?access=<key>` sets a cookie; scripts send `X-QA-Access`). Required whenever the server is reachable beyond this computer |
| `RUNNER_ALLOWED_ORIGINS`                      | none                | Comma-separated extra origins allowed to call the API. Warns if set without an access token                                                                |
| `RUNNER_LOCALHOST_ALIAS`                      | none                | Host name that stands for localhost when the runner runs in a container                                                                                    |
| `RUNNER_BETA`                                 | off                 | `1` turns on shared-beta mode: keys and sign-ins live in memory per session, only public sites can be checked, some routes are closed                      |
| `PUBLIC_URL`, `RENDER`, `RENDER_EXTERNAL_URL` | none                | Set by the hosting platform; used for origin checks and links                                                                                              |

## AI providers

Bring your own key. Supported providers: OpenRouter (default in CI), Gemini, OpenAI, Anthropic, and a mock for tests.

| Variable                                                                      | Meaning                                 |
| ----------------------------------------------------------------------------- | --------------------------------------- |
| `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider keys read from the environment |
| `TEST_MOCK_AI`                                                                | Use the mock provider (tests)           |

Key order (see `core/ai/key-resolver.ts`): command line, then the OS keychain, then the legacy `.qa-keys.json`
file, then the environment. With no key at all, the Plan is written by fixed rules and no AI is used.

## One check-up from CI (`packages/runner/src/checkup.ts`)

| Variable         | Default      | Meaning                                                                                  |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `QA_TARGET_URL`  | required     | Address to check                                                                         |
| `QA_STAGING`     | `false`      | `true` marks it a test copy, so forms may be filled and sent. Anything else is read-only |
| `QA_AI_API_KEY`  | none         | The AI key                                                                               |
| `QA_AI_PROVIDER` | `openrouter` | `openrouter`, `gemini`, `openai` or `anthropic`                                          |
| `QA_OUTPUT_DIR`  | `qa-report`  | Report folder                                                                            |
| `QA_MAX_PAGES`   | `50`         | Page cap, to stay inside free Actions minutes                                            |
| `QA_FAIL_ON`     | `blocker`    | `blocker`, `major` or `none`: when the build fails                                       |

The CI check-up uses port 3601 internally.

## Wizard (front end)

| Variable              | Meaning                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `VITE_RUNNER_URL`     | Only for `pnpm dev` hot reload: where the wizard's API calls go                     |
| `VITE_BASE`           | Base path for static hosting                                                        |
| `VITE_ONLINE_APP_URL` | Address of the online app. Shows an "Open the online app" button on the Vercel site |
| `WIZARD_SCREENSHOTS`  | Turns on screenshot capture in the wizard end-to-end test                           |

## Ports

- `3001`: the QA Tool (wizard at `/`, API under `/api`)
- `3601`: internal, CI check-up only
- `3050`: the fixture test app (`pnpm fixture`; set `PORT` to change)
