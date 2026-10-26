# 0032: Everything Runs on Google Cloud Run; Render and Vercel Are Retired

Status: Accepted, 2026-10-26. Amends the hosting parts of [0012](0012-hosted-runner-github-actions.md).

## Context
ADR 0012 put the static front end on Vercel and the online copy on Render's free plan. Render's free plan sleeps,
has 512 MB of memory and wakes in about a minute, and Vercel published from a mirror repo with a personal access token.
A Google Cloud project with credit is now set up, and the runner already ran on Cloud Run (`qa-check-up`), deployed
keylessly from GitHub with Workload Identity Federation.

## Decision
- **One host.** Both public surfaces are Cloud Run services in project `qa-flow-tester-512310`, region `us-central1`:
  - `qa-check-up`: the runner and wizard, behind the access key (`RUNNER_ACCESS_TOKEN` from Secret Manager).
  - `qa-check-up-site`: the static landing page and wizard, served by nginx (`site/Dockerfile`), public.
- **Keyless deploys from `main`.** `.github/workflows/deploy.yml` builds both images, pushes them to Artifact Registry and deploys them. Both wait for the test shards.
- **Retired:** `render.yaml`, `vercel.json`, the Vercel mirror push and its `VERCEL_REPO_TOKEN`, and the Render and Vercel checks. The build command is now `pnpm site-build`.
- **Wake-up pings the root.** Cloud Run's front end answers `/healthz` itself, so the wizard's wake call goes to `/`, which reaches the container.

## Why Cloud Run for the static site, not Firebase Hosting or a bucket
Both services then use the same keyless deploy path and the same project. Firebase Hosting would need a second deploy
credential or a key. A bucket behind a load balancer costs more to keep running and needs more setup. Cloud Run scales to
zero, and the site is a few static files, so the cost is small.

## Consequences
- Scale-to-zero means a cold start on the first visit after a quiet spell. The wizard already shows a wake note.
- The runner keeps `--max-instances 1` because its beta limits and sessions live in memory.
- Data in `/tmp` is wiped on each redeploy or scale-down, as it was on Render.
- Cost is paid from the project's credit. Watch the billing budget after the first month.
- Old `*.onrender.com` and `*.vercel.app` addresses stop answering once their services are deleted. No redirect is kept.
