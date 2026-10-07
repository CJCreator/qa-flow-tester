# Deployment

Three ways the tool reaches people (ADR 0012), all at $0 until there is revenue.

| Surface                                                           | What                                                                                                                              | Where it is defined                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Vercel**: the static front end (landing page and wizard)        | Built from the mirror repo `CJCreator-New/flowtester`                                                                             | `vercel.json`, `scripts/vercel-output.mjs`, `pnpm vercel-build` (output in `/public`, git-ignored) |
| **Render**: the full app as a shared beta                         | Docker image, free plan (512 MB, sleeps after 15 minutes idle), `RUNNER_BETA=1`                                                   | `render.yaml`, `packages/runner/Dockerfile`                                                        |
| **The user's own GitHub Actions**: the main way to run a check-up | The wizard generates a workflow from `templates/qa-check.yml`; the job builds the tool and runs `packages/runner/dist/checkup.js` | `templates/qa-check.yml`, `.github/workflows/qa-check.yml`                                         |

## How a change ships

1. Work on a branch and open a pull request. `.github/workflows/ci.yml` builds and tests it.
2. Merge to `main`. `.github/workflows/deploy.yml` then:
   - **test**: installs, runs `vercel-build`, builds the runner chain, runs the beta and wizard tests
   - **publish**: pushes `main` to `CJCreator-New/flowtester` (this is what starts the Vercel build). Needs the `VERCEL_REPO_TOKEN` secret
   - **verify**: waits for the Vercel site and Render `/healthz` to answer 200
   - Render builds from this repo itself (`autoDeploy: true`), so the push starts its build.
3. Deploys queue, never cancel (`concurrency: deploy`).

Settings (Settings > Secrets and variables > Actions): secret `VERCEL_REPO_TOKEN`; optional variables
`VERCEL_SITE_URL` (default `https://flowtester.vercel.app`) and `RENDER_APP_URL`.

## Docker

`packages/runner/Dockerfile` builds on Playwright's image. **Its version (`v1.63.0-noble`) must match the
`playwright` version in `pnpm-lock.yaml`**; bump both together. It installs only the runner and wizard chains,
copies `templates/` (the wizard embeds the workflow file), and runs `node packages/runner/dist/cli.js` on port 3001
with data in `/data`.

`node scripts/check-playwright-version.mjs` compares the Dockerfile tag with every `playwright@` version in
`pnpm-lock.yaml`. It exits 1 on a mismatch or if either version is missing. CI runs it right after Install; run it
locally after bumping.

Local build: `docker build -f packages/runner/Dockerfile -t qa-check-up .`
Run: `docker run -p 3001:3001 -e RUNNER_ACCESS_TOKEN=<key> -v qa-data:/data qa-check-up`

## Release checklist

- [ ] CI green on the PR; `pnpm test` and `pnpm build` pass locally
- [ ] `wizard-e2e` run once with Chromium installed
- [ ] `CHANGELOG.md` updated
- [ ] After merge: deploy workflow green, both sites answer, open the Render app and run one check-up on the fixture or a public site
- [ ] Rotate anything that was exposed during development

## Rollback

Revert the merge commit on `main` and push; both hosts redeploy. Render also lets you redeploy a previous build
from its dashboard.

## Known risks

- The Render free plan sleeps and has little memory; large scans may be killed. The wizard shows a wake note.
- The mirror push depends on one token; if it expires, the Vercel site stops updating while Render continues.
