# Deployment

How the tool reaches people ([ADR 0012](adr/0012-hosted-runner-github-actions.md), hosting in
[ADR 0032](adr/0032-google-cloud-only-hosting.md)). Everything hosted runs on Google Cloud, project
`qa-flow-tester-512310`, region `us-central1`.

| Surface                                                           | What                                                                                                                                                                   | Defined in                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Cloud Run `qa-check-up-site`**: landing page and wizard         | Static files behind nginx (`nginxinc/nginx-unprivileged`), public, 256 MiB, 0 to 2 instances                                                                           | `site/Dockerfile`, `site/nginx.conf`, `scripts/site-output.mjs`, `pnpm site-build` |
| **Cloud Run `qa-check-up`**: the full app as a shared online copy | Runner image, 2 GiB, 1 CPU, exactly 1 instance (warm, [ADR 0038](adr/0038-warm-runner-instance.md)), `RUNNER_BETA=1`, access key from Secret Manager `qa-access-token` | `packages/runner/Dockerfile`, `.github/workflows/deploy.yml`                       |
| **The user's own GitHub Actions**: the main way to run a check-up | The wizard generates a workflow from `templates/qa-check.yml`; the job builds the tool and runs `packages/runner/dist/checkup.js`                                      | `templates/qa-check.yml`, `.github/workflows/qa-check.yml`                         |

Cloud Run addresses are fixed by the project number, so they are known before the first deploy:
`https://qa-check-up-809804736896.us-central1.run.app` (runner) and
`https://qa-check-up-site-809804736896.us-central1.run.app` (site).

## How a change ships

1. Work on a branch and open a pull request. `.github/workflows/ci.yml` runs lint, format check, typecheck, the unit tests (2 shards via `tests.yml`), a dependency audit, a secret scan of the repo history, and a secret scan of the wizard bundle and the runner image.
2. Merge to `main`. `.github/workflows/deploy.yml` then runs:
   - **build-and-smoke**: install, the Playwright version check, lint, `pnpm site-build` (with `VITE_ONLINE_APP_URL` set to the runner), the runner build, `pnpm smoke`, and uploads the built site.
   - **test**: the unit tests, 2 shards (`tests.yml`). Both deploy jobs wait for it.
   - **cloud-run**: builds and pushes `us-central1-docker.pkg.dev/qa-flow-tester-512310/qa/runner:$GITHUB_SHA`, deploys `qa-check-up`, and checks that the root answers 401 or 200. `/healthz` is not used here: Cloud Run's front end answers it itself and never reaches the container.
   - **site**: builds and pushes `.../qa/site:$GITHUB_SHA`, deploys `qa-check-up-site`, and checks that `/version.json` names this commit.
3. A newer push to `main` cancels an older deploy still running (`concurrency: deploy`).

To deploy without the tests (for example to pick up changed repository variables): Actions > Deploy > **Run workflow** with
**skip_tests** ticked, or `gh workflow run deploy.yml --ref main -f skip_tests=true`. build-and-smoke still runs. A push to
`main` always runs the tests.

Deploy sign-in is keyless (Workload Identity Federation). Repository variables (Settings > Secrets and variables >
Actions > **Variables**): `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`. No GitHub secret holds a Google
Cloud key. The runner's access key is only in Secret Manager as `qa-access-token`.

Manual deploy from a machine signed in with `gcloud auth login`: `node scripts/deploy-cloud-run.mjs`. It builds, pushes
and deploys both services, but sets only the base runner environment. It leaves out the audit bucket, Firebase and
scheduler variables, so use the workflow for anything that needs them.

Other workflows: `release.yml` (tags `v*`: checks the tag equals the `package.json` version, then lint, format, audit and
builds; publishes nothing) and `e2e-nightly.yml` (browser tests, nightly).

## Runner environment on Cloud Run

`deploy.yml` sets: `RUNNER_BETA=1`, `RUNNER_HOST=0.0.0.0`, `RUNNER_DATA_DIR=/tmp/qa-data`,
`RUNNER_OUTPUT_DIR=/tmp/qa-data/reports`, `RUNNER_ALLOWED_ORIGINS`, and from repository variables `AUDIT_STORE_BUCKET`,
`FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `SCHEDULER_SERVICE_ACCOUNT`. An unset variable
reaches the runner empty, which it treats as off. Meanings: [CONFIGURATION.md](CONFIGURATION.md). The container port is
8080; the runner reads `PORT` because Cloud Run sets `K_SERVICE`.

## Docker

`packages/runner/Dockerfile` builds on Playwright's image. **Its version (`v1.63.0-noble`) must match the `playwright`
version in `pnpm-lock.yaml`**; bump both together. It installs the runner and wizard chains, copies `templates/` (the
wizard embeds the workflow file), builds both, and runs `node packages/runner/dist/cli.js` on port 3001, bound to
`0.0.0.0`, with data in `/data` and reports in `/data/reports`. The three `VITE_COUNTER_URL`, `VITE_CONTACT_EMAIL` and
`VITE_SIGNUP_URL` build args set the landing values. `/healthz` answers 200 `ok` and shows no data.

Because the image binds `0.0.0.0`, `RUNNER_ACCESS_TOKEN` is required: the runner exits at start without it. Open the
copy once as `https://<host>/?access=<key>` to set the cookie.

`node scripts/check-playwright-version.mjs` compares the Dockerfile tag with every `playwright@` version in
`pnpm-lock.yaml` and the package manifests. It exits 1 on a mismatch. CI and the release workflow run it; run it locally
after bumping. Dependabot ignores Playwright (`.github/dependabot.yml`). To upgrade, change the `playwright` and
`playwright-core` versions in `pnpm-workspace.yaml` (`overrides`) and in the `package.json` files that list them, run
`pnpm install`, change the Dockerfile tag to match, then run the check.

Local runner image: `docker build -f packages/runner/Dockerfile -t qa-check-up .`, then
`docker run -p 3001:3001 -e RUNNER_ACCESS_TOKEN=<key> -v qa-data:/data qa-check-up`.

Local site image: `pnpm site-build`, then `docker build -f site/Dockerfile -t qa-check-up-site .` and
`docker run -p 8080:8080 qa-check-up-site`. `site/nginx.conf` caches `/assets/` for a year and serves `index.html` for
unknown paths.

## The user's own GitHub Actions

The wizard fills `templates/qa-check.yml` (`__DEFAULT_URL__`, `__QA_TOOL_REF__` from `TOOL_REF` in
`packages/wizard/src/lib/workflow.ts`). The job checks out this repo at that ref, installs and builds the runner chain,
installs Chromium, runs `node .qa-tool/packages/runner/dist/checkup.js`, and uploads `qa-report` (14 days). It runs on
request, and when a preview or staging deployment reports success (a deployment of the `Production` environment is
checked read-only; any other is a test copy). The user's secret is `QA_AI_API_KEY`. Settings:
[CONFIGURATION.md](CONFIGURATION.md#one-check-up-from-ci-packagesrunnersrccheckupts).
`.github/workflows/qa-check.yml` is this repo's own copy, run on request only.

## Website Audit storage and Helper sign-in

Local runs need none of this and no cloud account. Without `AUDIT_STORE_BUCKET` the runner keeps Website Audits, Shared Links and Helper grants
as files under `<RUNNER_DATA_DIR>/audit-store/`. Without `FIREBASE_PROJECT_ID` Helper sign-in is off.

On the hosted copy, Website Audits and Shared Links live in one Cloud Storage bucket
([ADR 0036](adr/0036-hosted-audit-storage-and-shared-links.md)) because `/tmp` is wiped on every redeploy. Helper sign-in
uses Firebase Authentication (Google sign-in) in the same project, and turns on only when `FIREBASE_PROJECT_ID` and
`RUNNER_ACCESS_TOKEN` are both set.

One-time setup, by someone with owner rights on the project. The bucket name is an example; bucket names are global.

1. Create the bucket in the runner's region on the always-free tier, with uniform access, public access prevention and soft delete off:

   ```bash
   gcloud storage buckets create gs://qa-check-up-audits --project qa-flow-tester-512310 \
     --location us-central1 --default-storage-class STANDARD \
     --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=0
   ```

2. Keep versioning off and add no lifecycle rule, so deleting a Website Audit removes its data at once. There are no backups. Check:

   ```bash
   gcloud storage buckets describe gs://qa-check-up-audits \
     --format="yaml(versioning_enabled,lifecycle_config,soft_delete_policy,uniform_bucket_level_access,public_access_prevention)"
   gcloud storage buckets update gs://qa-check-up-audits --no-versioning --clear-lifecycle --clear-soft-delete
   ```

3. Give the runner's runtime service account `roles/storage.objectAdmin` on this bucket only. An empty answer from the first command means the default compute account `809804736896-compute@developer.gserviceaccount.com`:

   ```bash
   gcloud run services describe qa-check-up --region us-central1 --project qa-flow-tester-512310 \
     --format="value(spec.template.spec.serviceAccountName)"
   gcloud storage buckets add-iam-policy-binding gs://qa-check-up-audits \
     --member "serviceAccount:<runtime service account>" --role roles/storage.objectAdmin
   ```

   The runner reaches the bucket keylessly through that account.

4. Add Firebase to the project and turn on Google sign-in ([Firebase CLI](https://firebase.google.com/docs/cli)):

   ```bash
   gcloud services enable firebase.googleapis.com identitytoolkit.googleapis.com --project qa-flow-tester-512310
   firebase projects:addfirebase qa-flow-tester-512310
   firebase apps:create web qa-check-up --project qa-flow-tester-512310
   firebase apps:sdkconfig web <app id from the line above> --project qa-flow-tester-512310
   ```

   `apps:sdkconfig` prints the public web settings (`projectId`, `apiKey`, `authDomain`). In the Firebase console,
   Authentication > Sign-in method: enable **Google**; Settings > Authorized domains: add
   `qa-check-up-809804736896.us-central1.run.app` (and the site's host if the wizard is opened from there).

5. Set the repository variables (Variables, not secrets; all public values): `AUDIT_STORE_BUCKET` (name without `gs://`),
   `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`. The next deploy passes them to the runner.

A wizard build can also bake the Firebase values in as `VITE_FIREBASE_*` ([CONFIGURATION.md](CONFIGURATION.md)); the deploy does not need them.

## Scheduled Check-ups on the hosted copy

Cloud Scheduler is the clock: it calls `POST /api/runner/schedules/tick` every few minutes and the runner starts the
schedules that are due ([ADR 0039](adr/0039-cloud-scheduler-owner-schedules.md)). The job proves who it is with a
Google-signed token; the runner's access key is never given to Cloud Scheduler. Local runs need none of this (the runner
has its own 60 second timer). Replace `PROJECT`, `PROJECT_NUMBER`, `REGION` and `RUNNER_URL` (no trailing slash; it must
equal one URL in `RUNNER_ALLOWED_ORIGINS`). Do this once:

1. `gcloud services enable cloudscheduler.googleapis.com --project PROJECT`

2. Create a service account only for the job. It needs no project roles (the runner checks the token itself):
   `gcloud iam service-accounts create qa-scheduler --display-name "QA check-up scheduler" --project PROJECT`

3. Allow minting its token. Whoever creates the job needs `roles/iam.serviceAccountUser` on `qa-scheduler`. The Cloud Scheduler service agent normally already may sign as it; if the job is refused, grant it:
   `gcloud iam service-accounts add-iam-policy-binding qa-scheduler@PROJECT.iam.gserviceaccount.com --member serviceAccount:service-PROJECT_NUMBER@gcp-sa-cloudscheduler.iam.gserviceaccount.com --role roles/iam.serviceAccountTokenCreator --project PROJECT`

4. Set the repository variable `SCHEDULER_SERVICE_ACCOUNT` to `qa-scheduler@PROJECT.iam.gserviceaccount.com`, then deploy with the workflow (not `scripts/deploy-cloud-run.mjs`, which leaves the variable out). While it is unset the tick route answers 401.

5. Create the job. The audience must be the runner's URL exactly. `--attempt-deadline 1800s` is the longest an HTTP job may wait, and the tick holds its request open while runs finish. Retries are off:
   `gcloud scheduler jobs create http qa-check-up-tick --project PROJECT --location REGION --schedule "*/5 * * * *" --time-zone "Etc/UTC" --uri "RUNNER_URL/api/runner/schedules/tick" --http-method POST --oidc-service-account-email qa-scheduler@PROJECT.iam.gserviceaccount.com --oidc-token-audience "RUNNER_URL" --attempt-deadline 1800s --max-retry-attempts 0`

6. Check: `gcloud scheduler jobs run qa-check-up-tick --project PROJECT --location REGION`, then read the job's last attempt status in the Cloud console. A 401 means the audience or the service account email does not match the runner's settings.

To stop: `gcloud scheduler jobs pause qa-check-up-tick --project PROJECT --location REGION`, or unset the variable and redeploy.

Schedules live in the audit bucket (`schedules/schedules.json`), so `AUDIT_STORE_BUCKET` must be set; without it they sit
in `/tmp` and are lost on each redeploy. The hour of a schedule is in UTC. Cloud Scheduler gives 3 jobs per billing
account free; this uses 1.

## Release checklist

- [ ] CI green on the PR
- [ ] One check-up run by hand on a real site ([TESTING.md](TESTING.md), Checking against real websites)
- [ ] `CHANGELOG.md` updated
- [ ] Tag `vX.Y.Z` equal to the `package.json` version; the Release build workflow is green
- [ ] After merge: Deploy workflow green, both services answer, open the online app and run one check-up on a public site
- [ ] Rotate anything that was exposed during development

Bumping the version means updating every `package.json`, `TOOL_REF` in `packages/wizard/src/lib/workflow.ts` and
`CHANGELOG.md`; a test fails on drift. Tag before deploying a wizard that pins the new ref.

## Rollback

Revert the merge commit on `main` and push; the deploy redeploys both services. Cloud Run also keeps earlier revisions:
`gcloud run services update-traffic <service> --to-revisions <revision>=100 --region us-central1` moves traffic back at
once. Artifact Registry `qa` keeps only the 3 newest versions of each image ([ADR 0038](adr/0038-warm-runner-instance.md)),
so a rollback to an older revision fails once its image is deleted.

## Limits of the hosted copy

- One instance only (`--max-instances 1`): beta limits and sessions are held in memory, and a restart or redeploy resets the per-visitor and per-day counters. Clearing the cookie gives a visitor a fresh count (and loses their AI key); the daily cap is the backstop.
- The runner stays warm (`--min-instances 1`), so it answers at once but is billed while idle (roughly 15 to 20 US dollars a month). The site scales to zero; its first request after idle waits for a short cold start.
- The data folder is `/tmp`, wiped on every redeploy, restart or scale-down. Only Website Audits, Shared Links and schedules survive, and only with `AUDIT_STORE_BUCKET`.
- A scheduled tick holds one request open for up to 30 minutes; a longer run is recorded as failed and keeps running ([ADR 0039](adr/0039-cloud-scheduler-owner-schedules.md)).
