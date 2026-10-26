# Deployment

Ways the tool reaches people (ADR 0012, and ADR 0032 for hosting). Everything runs on Google Cloud, on the project
`qa-flow-tester-512310`, region `us-central1`. Render and Vercel are retired.

| Surface                                                           | What                                                                                                                         | Where it is defined                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Cloud Run `qa-check-up-site`**: landing page and wizard         | Static files behind nginx (`nginxinc/nginx-unprivileged`), public, 256 MiB, scales to zero                                  | `site/Dockerfile`, `site/nginx.conf`, `scripts/site-output.mjs`, `pnpm site-build` |
| **Cloud Run `qa-check-up`**: the full app as a shared online copy | Runner image, 2 GiB, 1 CPU, scales to zero, `RUNNER_BETA=1`, behind the access key (Secret Manager `qa-access-token`)      | `packages/runner/Dockerfile`, `.github/workflows/deploy.yml`         |
| **The user's own GitHub Actions**: the main way to run a check-up | The wizard generates a workflow from `templates/qa-check.yml`; the job builds the tool and runs `packages/runner/dist/checkup.js` | `templates/qa-check.yml`, `.github/workflows/qa-check.yml`           |

Both Cloud Run services get their address from the project number, so it is fixed before the first deploy:
`https://qa-check-up-809804736896.us-central1.run.app` (runner) and `https://qa-check-up-site-809804736896.us-central1.run.app` (site).

## How a change ships

1. Work on a branch and open a pull request. `.github/workflows/ci.yml` builds and tests it.
2. Merge to `main`. `.github/workflows/deploy.yml` then:
   - **build-and-smoke**: lint, the Playwright version check, `pnpm site-build` (with `VITE_ONLINE_APP_URL` set to the runner), the runner build, the smoke check, and uploads the built site.
   - **test**: the four shards of the test suite (`tests.yml`). Both deploys wait for it.
   - **cloud-run**: builds and pushes the runner image to Artifact Registry (`us-central1-docker.pkg.dev/qa-flow-tester-512310/qa/runner:$GITHUB_SHA`), deploys `qa-check-up`, and verifies the root answers 401 (the access-key gate). `/healthz` is not used here: Cloud Run's front end answers it with its own 404 and never reaches the container.
   - **site**: builds and pushes the site image (`.../qa/site:$GITHUB_SHA`), deploys `qa-check-up-site`, and verifies `version.json` names this commit.
3. A newer push to `main` cancels an older deploy that is still running (`concurrency: deploy`).

Sign-in is keyless: Workload Identity Federation with the variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`
(Settings > Secrets and variables > Actions > Variables). No GitHub secret holds a GCP key.

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

Local site build: `pnpm site-build`, then `docker build -f site/Dockerfile -t qa-check-up-site .` and
`docker run -p 8080:8080 qa-check-up-site`.

The image binds `0.0.0.0`, so `RUNNER_ACCESS_TOKEN` is required: the runner exits at start without it. On Cloud Run the
token comes from Secret Manager; open the copy once as `https://<host>/?access=<key>` to set the cookie.

## Release checklist

- [ ] CI green on the PR; `pnpm test` and `pnpm build` pass locally
- [ ] `wizard-e2e` run once with Chromium installed
- [ ] `CHANGELOG.md` updated
- [ ] Tag `vX.Y.Z` equal to the `package.json` version; "Release build" workflow green (builds only, publishes nothing)
- [ ] After merge: deploy workflow green, both services answer, open the online app and run one check-up on the fixture or a public site
- [ ] Rotate anything that was exposed during development

Bumping the version means updating every `package.json`, `TOOL_REF` in `packages/wizard/src/lib/workflow.ts`, and
`CHANGELOG.md`; a test fails on drift. Tag before deploying a wizard that pins the new ref.

## Rollback

Revert the merge commit on `main` and push; the deploy redeploys both services. Cloud Run also keeps earlier revisions:
`gcloud run services update-traffic <service> --to-revisions <revision>=100 --region us-central1` moves traffic back at once.

## Known risks

- Cloud Run scales to zero, so the first request after idle waits for a cold start (the wizard shows a wake note while it wakes).
- Beta limits (per visitor and per day) are in memory: a restart or redeploy resets all counters. Set `RUNNER_BETA_RUNS_PER_VISITOR` (default 5) and `RUNNER_BETA_RUNS_PER_DAY` (default 40). Clearing the cookie gives a visitor a fresh count (and loses their AI key); the daily cap is the backstop.
- The runner's data folder is `/tmp` on Cloud Run and is wiped on every redeploy, restart or scale-down. Do not store anything there that must survive; a persistent volume is the fix.
- The runner runs at most one instance (`--max-instances 1`), because limits and sessions are held in memory.
