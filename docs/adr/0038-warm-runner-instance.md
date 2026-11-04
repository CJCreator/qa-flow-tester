# 0038: The Hosted Runner Keeps One Warm Instance; Old Images Are Cleaned Up

Status: Accepted, 2026-11-04 (owner's choice in chat, 2026-11-04). Amends the scale-to-zero consequence of [0032](0032-google-cloud-only-hosting.md).

## Context
[0032](0032-google-cloud-only-hosting.md) runs the runner (`qa-check-up`) with `--min-instances 0`. The first visit after a quiet
spell waits for a cold start: the 2 GiB runner image with Chromium takes about 10 to 30 seconds to answer. The owner wants the
hosted copy to answer at once.

Each deploy also pushes a new runner image and a new site image to Artifact Registry (`qa`), with no rule removing old ones. On
2026-11-04 the repository held 2.0 GB (9 runner and 8 site versions); its free storage is 0.5 GB.

## Decision
- **One warm runner.** `qa-check-up` runs with `--min-instances 1 --max-instances 1`, in `.github/workflows/deploy.yml` and
  `scripts/deploy-cloud-run.mjs`. Max stays 1 because beta limits and sessions live in memory ([0032](0032-google-cloud-only-hosting.md)).
- **The site still scales to zero.** `qa-check-up-site` is a few static files behind nginx, which start in about a second.
- **Old images are cleaned up.** The `qa` repository has a cleanup policy: keep the 3 newest versions of each image, delete
  the rest. Artifact Registry applies it about once a day.

## Consequences
- No cold start on the hosted copy. The wizard's wake note is still useful for the site and for local copies.
- The warm instance is billed while idle: roughly 15 to 20 US dollars a month at list price, paid from the project's
  credit. This departs from the $0 hosting goal; a billing budget alert watches it. Set `--min-instances 0` again to go back.
- `/tmp` survives longer, but is still wiped on every redeploy and restart. Website Audits stay in the bucket ([0036](0036-hosted-audit-storage-and-shared-links.md)).
- A rollback can only use a revision whose image is among the 3 newest. Older revisions fail to start once their image is deleted.
