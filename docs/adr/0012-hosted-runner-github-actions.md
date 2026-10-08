# 0012: Where Check-ups Run: the User's Own GitHub Actions First

Replaces the "each person runs a server on their own machine" rule of [0008](0008-single-local-server.md) as the only way to run. The single-server design itself still stands: it is what runs inside the job.

## Context and Decision
"Nothing to install" is the product's promise, and hosting must cost $0 until there is revenue. A check-up needs a real browser, so a static host (GitHub Pages, Cloudflare Pages, Netlify) cannot run one. Something with a machine has to.

We decided on two parts:
- **The front end is static.** The wizard builds to plain files and is published on Vercel (`vercel.json`; it began on GitHub Pages and moved on 2026-10-06, for simpler settings and per-push deploys). Opened there, no runner answers it, so its first screen offers the two ways to run: in the person's GitHub repo, or on their computer.
- **The check-up runs in the user's own GitHub Actions** (Option A). The wizard generates a workflow file from `templates/qa-check.yml`. The job gets the tool, builds it, and runs `packages/runner/dist/checkup.js`, which starts the runner in-process, tests one address, writes the report and exits with a code the build can use. The report is an artifact (`report.html` opens with a double-click) and the verdict is on the run's summary page.

Why this one first:
- **$0 for us.** There is no server of ours: no shared machine, no run queue, no abuse limits. Free minutes belong to the user: unlimited for public repos, 2,000 a month for private repos on the free plan (GitHub's billing page, checked 2026-10-05).
- **Private previews work.** The user's CI can already reach their preview or staging address.
- **Keys stay with the user.** The AI key is a repo secret. It is not stored by us.
- **No Verified Domains yet.** A run only ever tests what its owner's own CI points at, so proving domain ownership ([ADR 0014](0014-verified-domains-and-safe-host-classification.md), now written) is needed only for a shared runner or for Security Probes.

Safety rules carried over: a preview or staging address is a test copy (`QA_STAGING`), and anything else is checked read-only, so nothing is sent to a live site. The runner's data folder is outside the uploaded report folder, so a key held while it works can never ride along with the report.

We rejected, for now:
- **A free container host running the Dockerfile (Option B).** It gives true zero setup but brings a shared machine, quotas, tenant isolation and domain verification. It stays a later step, only if users say Option A is too much setup. Free tiers change often (Oracle halved its free Arm allowance in June 2026), so it would need two hosts.
- **Triggering runs from the browser with a pasted token.** A token on a static page is a risk. If it cannot be kept in the user's browser only, the button stays out. For now the person starts the run from GitHub's own Run workflow button.

`pnpm tunnel` stays as the way to share a runner on someone's own computer with a few testers. It is local-only, not hosting, and its beta mode rules (their own key, public sites only) are unchanged.

## Amendment, 2026-10-06: Vercel for the front end
The front end moved from GitHub Pages to Vercel. Vercel was **not** chosen to run the runner: its functions are stateless and short-lived (about 1 GB of memory on the free plan, a few minutes at most), while a check-up holds one run in memory, streams progress, keeps a plan for review and drives Chromium for many minutes. Running check-ups there would mean redesigning the runner into short steps with a database between them. The runner stays on Render (online copy) or the user's own GitHub Actions.

## Amendment, 2026-10-05: an online copy as well (Option B, beta)
Opening the published wizard showed setup instructions, not the app. The wanted experience is the local one: add your own AI key, enter a site, test it. A static page cannot do that, so the full app (runner and wizard, in one container) is also published online, as a shared beta copy (`render.yaml`, beta mode: each visitor's key is kept in memory for their session, only public sites can be checked, one check-up at a time). The Pages site links to it. The GitHub Actions route and running on your own computer stay as the fallbacks, and are the way to check private or localhost sites.

Free hosts, checked 2026-10-05, for a container that runs Chromium and needs no card:
- **Render free:** 512 MB RAM, shared CPU, 750 hours a month, asleep after 15 minutes idle (about a minute to wake). The only one that fits, and 512 MB is tight for Chromium: a large site may run out of memory.
- **Hugging Face Spaces:** Docker Spaces now need a paid plan. Rejected.
- **Fly.io:** no free tier for new accounts. Rejected.
- **Koyeb:** the card-free plan was removed in February 2026. Rejected.

The online copy has no accounts, and its usage limits are set out in the amendment below, so anyone with the link can use it within them. It stays a beta until the abuse and memory limits are known.

Amendment, 2026-10-07: on this shared copy a Test Copy needs a Verified Domain proof, and redirects and DNS answers that point at private addresses are refused. See [0014](0014-verified-domains-and-safe-host-classification.md) (Proposed until the owner accepts it).

## Consequences
- The user needs a GitHub repo, and a CI minute budget. A run takes a few minutes to install and build the tool before testing starts, which is part of the 15-minute target to measure.
- The workflow checks out this repo's `main`. Until releases are pinned, a change here reaches every workflow on its next run. Pin a tag once there is one.
- The repo must be public, or the workflow must be given a token, for the user's job to fetch the tool.
- Run time and memory on the Actions machine are not yet measured. The spike's remaining steps are: publish Pages, run the workflow on a clean repo, and record minutes and memory.

## Amendment, 2026-10-07: usage limits on the online copy

The online copy now limits how many check-ups and comparisons can be started: per visitor session (default 5) and for the whole copy (default 40), each per UTC day, set by `RUNNER_BETA_RUNS_PER_VISITOR` and `RUNNER_BETA_RUNS_PER_DAY`. Over a limit the start answers 429 `ERR_BETA_LIMIT`. Counts are in memory, so a restart resets them. A visitor who clears their cookie gets a fresh visitor count (and loses their AI key); the daily cap is the backstop. A persistent store and a second host are out of scope.
