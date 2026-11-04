# Deployment

Ways the tool reaches people (ADR 0012, and ADR 0032 for hosting). Everything runs on Google Cloud, on the project
`qa-flow-tester-512310`, region `us-central1`. Render and Vercel are retired.

| Surface                                                           | What                                                                                                                              | Where it is defined                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Cloud Run `qa-check-up-site`**: landing page and wizard         | Static files behind nginx (`nginxinc/nginx-unprivileged`), public, 256 MiB, scales to zero                                        | `site/Dockerfile`, `site/nginx.conf`, `scripts/site-output.mjs`, `pnpm site-build` |
| **Cloud Run `qa-check-up`**: the full app as a shared online copy | Runner image, 2 GiB, 1 CPU, 1 warm instance, `RUNNER_BETA=1`, behind the access key (Secret Manager `qa-access-token`)            | `packages/runner/Dockerfile`, `.github/workflows/deploy.yml`                       |
| **The user's own GitHub Actions**: the main way to run a check-up | The wizard generates a workflow from `templates/qa-check.yml`; the job builds the tool and runs `packages/runner/dist/checkup.js` | `templates/qa-check.yml`, `.github/workflows/qa-check.yml`                         |

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

To deploy without the test suite (for example, to pick up changed repository variables), run it by hand:
Actions > Deploy > **Run workflow**, tick **skip_tests**, or `gh workflow run deploy.yml --ref main -f skip_tests=true`.
build-and-smoke still runs (the site job needs its build). A push to `main` always runs the tests.

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

## Website Audit storage and Helper sign-in

**Local runs need none of this.** Without `AUDIT_STORE_BUCKET` the runner keeps every Website Audit, its Shared
Links and Helper grants as plain files under the data folder (`<RUNNER_DATA_DIR>/audit-store/`), with no cloud
account. Without `FIREBASE_PROJECT_ID` Helper sign-in is simply off.

**On the hosted copy** (`qa-check-up`), Website Audits and Shared Links live in one Cloud Storage bucket
([ADR 0036](adr/0036-hosted-audit-storage-and-shared-links.md)), because `/tmp` is wiped on every redeploy. Helper
sign-in uses Firebase Authentication (Google sign-in) in the same project. It turns on only when both
`FIREBASE_PROJECT_ID` and `RUNNER_ACCESS_TOKEN` are set.

One-time setup, run by hand by someone with owner rights on `qa-flow-tester-512310`. The bucket name below is an
example; bucket names are global, so pick your own.

1. Create the bucket in the runner's region, on the always-free tier (Standard storage in `us-central1`; `us-east1`
   and `us-west1` are also free, but keep it in the runner's region). Uniform bucket-level access on, public access
   prevention enforced, soft delete off (0 days):

   ```bash
   gcloud storage buckets create gs://qa-check-up-audits --project qa-flow-tester-512310 \
     --location us-central1 --default-storage-class STANDARD \
     --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=0
   ```

2. Keep object versioning off and add no lifecycle rule, so deleting a Website Audit removes its data at once and
   nothing else expires it (Q-30). New buckets start this way; check, and turn off anything that is on:

   ```bash
   gcloud storage buckets describe gs://qa-check-up-audits \
     --format="yaml(versioning_enabled,lifecycle_config,soft_delete_policy,uniform_bucket_level_access,public_access_prevention)"
   gcloud storage buckets update gs://qa-check-up-audits --no-versioning --clear-lifecycle --clear-soft-delete
   ```

   There are no backups: a deleted Website Audit cannot be recovered.

3. Give the runner's runtime service account `roles/storage.objectAdmin` on this bucket only (never a project-wide
   storage role). Find the account first; an empty answer means the default compute account
   `809804736896-compute@developer.gserviceaccount.com`:

   ```bash
   gcloud run services describe qa-check-up --region us-central1 --project qa-flow-tester-512310 \
     --format="value(spec.template.spec.serviceAccountName)"
   gcloud storage buckets add-iam-policy-binding gs://qa-check-up-audits \
     --member "serviceAccount:<runtime service account>" --role roles/storage.objectAdmin
   ```

   The runner reaches the bucket keylessly through that account. No storage key or signed URL is created.

4. Add Firebase to the same project and turn on Google sign-in ([Firebase CLI](https://firebase.google.com/docs/cli)):

   ```bash
   gcloud services enable firebase.googleapis.com identitytoolkit.googleapis.com --project qa-flow-tester-512310
   firebase projects:addfirebase qa-flow-tester-512310
   firebase apps:create web qa-check-up --project qa-flow-tester-512310
   firebase apps:sdkconfig web <app id from the line above> --project qa-flow-tester-512310
   ```

   `apps:sdkconfig` prints the public web settings: `projectId`, `apiKey` and `authDomain`
   (`qa-flow-tester-512310.firebaseapp.com`). Then, in the Firebase console, under Authentication: Sign-in method,
   enable **Google**; Settings, Authorized domains, add the runner's host
   `qa-check-up-809804736896.us-central1.run.app` (and the site's host if the wizard is opened from there).

5. Set the repository variables (Settings > Secrets and variables > Actions > **Variables**, not secrets; all four
   are public values): `AUDIT_STORE_BUCKET` (the bucket name, without `gs://`), `FIREBASE_PROJECT_ID`,
   `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`. `deploy.yml` passes them to the runner on the next deploy. A
   variable left unset reaches the runner empty, which it treats as off (local files, Helper sign-in off).

The runner sends the Firebase web settings to the wizard at run time. A wizard build can also bake them in as a
fallback with `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_WEB_API_KEY` and `VITE_FIREBASE_AUTH_DOMAIN`
(see `.env.example`); the deploy does not need them.

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

- The runner keeps one warm instance (`--min-instances 1`, [ADR 0038](adr/0038-warm-runner-instance.md)), so it answers at once but is billed while idle (roughly 15 to 20 US dollars a month). The site still scales to zero; its first request after idle waits for a short cold start.
- Artifact Registry `qa` keeps only the 3 newest versions of each image (cleanup policy, ADR 0038). A rollback to an older revision fails once its image is deleted.
- Beta limits (per visitor and per day) are in memory: a restart or redeploy resets all counters. Set `RUNNER_BETA_RUNS_PER_VISITOR` (default 5) and `RUNNER_BETA_RUNS_PER_DAY` (default 40). Clearing the cookie gives a visitor a fresh count (and loses their AI key); the daily cap is the backstop.
- The runner's data folder is `/tmp` on Cloud Run and is wiped on every redeploy, restart or scale-down. Do not store anything there that must survive. Website Audits and Shared Links survive only because they live in the `AUDIT_STORE_BUCKET` bucket; without it they are lost on each redeploy.
- The runner runs at most one instance (`--max-instances 1`), because limits and sessions are held in memory.
