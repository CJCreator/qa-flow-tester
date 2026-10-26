# Deployment

Ways the tool reaches people (ADR 0012), all at $0 until there is revenue.

| Surface                                                           | What                                                                                                                              | Where it is defined                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Vercel**: the static front end (landing page and wizard)        | Built from the mirror repo `CJCreator-New/flowtester`                                                                             | `vercel.json`, `scripts/vercel-output.mjs`, `pnpm vercel-build` (output in `/public`, git-ignored) |
| **Render**: the full app as a shared beta                         | Docker image, free plan (512 MB, sleeps after 15 minutes idle), `RUNNER_BETA=1`                                                   | `render.yaml`, `packages/runner/Dockerfile`                                                        |
| **Google Cloud Run**: shared online copy                          | Container service (`qa-check-up`, `us-central1`), keyless Workload Identity Federation, port 8080, `RUNNER_BETA=1`                | `.github/workflows/deploy.yml`, `packages/runner/Dockerfile`                                       |
| **The user's own GitHub Actions**: the main way to run a check-up | The wizard generates a workflow from `templates/qa-check.yml`; the job builds the tool and runs `packages/runner/dist/checkup.js` | `templates/qa-check.yml`, `.github/workflows/qa-check.yml`                                         |

## How a change ships

1. Work on a branch and open a pull request. `.github/workflows/ci.yml` builds and tests it.
2. Merge to `main`. `.github/workflows/deploy.yml` then:
   - **build-and-smoke**: lint, the Playwright version check, `vercel-build`, the runner build and the smoke check.
   - **test**: the four shards of the test suite (`tests.yml`, the same shards a pull request runs), in parallel with build-and-smoke.
   - **publish**: needs both above. Pushes `main` to `CJCreator-New/flowtester` (this starts the Vercel build). Needs the `VERCEL_REPO_TOKEN` secret.
   - **cloud-run**: needs build-and-smoke. Uses keyless Workload Identity Federation to authenticate with GCP, builds and pushes the container image to Artifact Registry (`us-central1-docker.pkg.dev/qa-flow-tester-512310/qa/runner:$GITHUB_SHA`), deploys to Cloud Run service `qa-check-up` (port 8080, 2 GiB memory, 1 CPU, data dir `/tmp/qa-data`), binds the access token from Secret Manager, and verifies `/healthz`.
   - **verify**: waits up to 10 minutes for the Vercel site to serve `version.json` with this commit, and Render `/healthz` to answer 200.
     Render's `/healthz` says only that the service is up, not which commit it runs.
   - Render builds from this repo itself (`autoDeployTrigger: checksPass` in `render.yaml`): it starts a build only after
     the commit's GitHub checks pass, so a failing test keeps the commit off Render.
3. A newer push to `main` cancels an older deploy that is still running (`concurrency: deploy`).

Settings (Settings > Secrets and variables > Actions): secret `VERCEL_REPO_TOKEN`; optional variables
`VERCEL_SITE_URL` (default `https://flowtester.vercel.app`) and `RENDER_APP_URL` (default `https://qa-check-up-2q68.onrender.com`).
GCP variables for Cloud Run: `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`.

## Docker

`packages/runner/Dockerfile` builds on Playwright's image. **Its version (`v1.63.0-noble`) must match the
`playwright` version in `pnpm-lock.yaml`**; bump both together. It installs only the runner and wizard chains,
copies `templates/` (the wizard embeds the workflow file), and runs `node packages/runner/dist/cli.js` on port 3001
with data in `/data` (or port 8080 with `/tmp/qa-data` on Cloud Run where root is read-only). The build stops if
the base image's Node major differs from `.nvmrc`. The runner runs as the image's non-root `pwuser`, and Docker's
`HEALTHCHECK` calls `/healthz`, which answers 503 when the data folder is not writable or Chromium does not launch.
Chromium runs with `--no-sandbox` (flag in `packages/core/src/browser.ts`, `launch()`), each target host in its own
browser process.

`node scripts/check-playwright-version.mjs` compares the Dockerfile tag with every `playwright@` version in
`pnpm-lock.yaml`. It exits 1 on a mismatch or if either version is missing. CI runs it right after Install; run it
locally after bumping.

Dependabot does not propose Playwright bumps (`.github/dependabot.yml` ignores them): a bump that changes only the
lockfile or only the Dockerfile fails this check. To upgrade, change the `playwright` and `playwright-core` versions in `pnpm-workspace.yaml` (`overrides`) and in the
`package.json` files that list `playwright`, run `pnpm install`, change the Dockerfile tag to match, then run the check.

Local build: `docker build -f packages/runner/Dockerfile -t qa-check-up .`
Run: `docker run -p 3001:3001 -e RUNNER_ACCESS_TOKEN=<key> -v qa-data:/data qa-check-up`

The image binds `0.0.0.0`, so `RUNNER_ACCESS_TOKEN` is required: the runner exits at start without it. The same holds on Render and Cloud Run: set `RUNNER_ACCESS_TOKEN` in the environment or Secret Manager, then open the copy once as `https://<host>/?access=<key>` to set the cookie.

## Release checklist

- [ ] CI green on the PR; `pnpm test` and `pnpm build` pass locally
- [ ] `wizard-e2e` run once with Chromium installed
- [ ] `CHANGELOG.md` updated
- [ ] Tag `vX.Y.Z` equal to the `package.json` version; "Release build" workflow green (builds only, publishes nothing)
- [ ] After merge: deploy workflow green, both sites answer, open the online app and run one check-up on the fixture or a public site
- [ ] Rotate anything that was exposed during development

Bumping the version means updating every `package.json`, `TOOL_REF` in `packages/wizard/src/lib/workflow.ts`, and
`CHANGELOG.md`; a test fails on drift. Tag before deploying a wizard that pins the new ref.

## Rollback

Revert the merge commit on `main` and push; the hosts redeploy. Render and Cloud Run also let you redeploy a previous build
from their dashboards.

## Known risks

- The Render free plan sleeps and has little memory; large scans may be killed. The wizard shows a wake note.
- Beta limits (per visitor and per day) are in memory: a restart, redeploy or sleep and wake resets all counters. Set `RUNNER_BETA_RUNS_PER_VISITOR` (default 5) and `RUNNER_BETA_RUNS_PER_DAY` (default 40). Clearing the cookie gives a visitor a fresh count (and loses their AI key); the daily cap is the backstop.
- The mirror push depends on one token; if it expires, the Vercel site stops updating while the backend copies continue.
- Beta data is temporary. No persistent disk is attached on the free plans or serverless instances, so data folders are wiped on every redeploy, restart or spin-down. Do not store anything there that must survive; a paid plan or instance with a persistent volume is the fix.
