# 0050: The Hosted Pilot: Vercel Front Door, Google Sign-in, a Runner That Sleeps

Status: Accepted, 2026-11-19 (owner's answers in a grilling session, 2026-11-19). Amends [0032](0032-google-cloud-only-hosting.md) (Vercel returns as the front door; `qa-check-up-site` is retired) and [0038](0038-warm-runner-instance.md) (no warm instance). Tickets: T-433 to T-440 (`docs/tickets/hosted-pilot-2026-11/PLAN.md`).

## Context
- The owner wants outside users to start using the app: the backend stays in a container on Google Cloud, and the website people open is on Vercel.
- Today the runner (`qa-check-up`, Cloud Run, us-central1) is gated by one shared access key, keeps sessions, daily limits and the run queue in memory, keeps one warm instance, and writes check-up reports to `/tmp`.
- Billing is in INR. The project has about ₹25,000 of credit and an alert-only budget of ₹2,000 a month.
- A site on `*.vercel.app` calling a runner on `*.run.app` is cross-site: browsers block the runner's session cookie.

## Decision
- **Front door: Vercel.** The landing page and wizard are served by Vercel (`packages/wizard/vercel.json`). The `qa-check-up-site` Cloud Run service and its deploy job are retired (deleting the service is a manual, owner-approved step).
- **One origin through a Vercel rewrite.** Vercel forwards the runner's paths to the Cloud Run address, so the browser sees one site and the session cookie is first-party. No custom domain is needed. Vercel waits up to 120 s for the first byte from the runner, which covers a cold start; a stream stays open once it has started, and live progress (SSE) already resumes with `Last-Event-ID` if it is cut. Because the runner is now same-origin, the wizard shows its own "waking up" state instead of the cross-origin wake call. This is proven first on a Vercel preview (T-433) before the other tickets build on it.
- **Way in: any Google account.** Signing in with Google (Firebase) is a valid way into the hosted copy. Each account is one identity for limits, reports and Verified Domain proof. "Signed-in account" is a declared access level in the route table (ADR 0037). The sign-in cookie is signed with a stable secret from Secret Manager, so a cold start does not sign anyone out. The shared access key stays for the owner and CI, not for testers.
- **AI: the user's own key.** Unchanged beta rule: a visitor's AI key is held in memory for their session only. The owner's keys are never used for visitors.
- **Capacity: a pilot.** One instance (`--max-instances 1`), 4 GiB, 2 CPU. The runner keeps its single check-up slot; further check-ups wait in a visible line for that slot ("you are number N in line"). More than one check-up at a time is not attempted.
- **Cost: scale to zero.** `--min-instances 0`. The first visit after a quiet spell waits for a cold start; the wizard's wake note covers it. The ₹2,000 monthly alert stays.
- **Nothing important lives only in memory.** Each account's daily check-up count is stored in the existing Cloud Storage bucket (`AUDIT_STORE_BUCKET`, ADR 0036). The global daily cap stays as well, because new Google accounts are free. The instance keeps CPU on (`--no-cpu-throttling`), and while a check-up runs the runner calls its own public address every few minutes, so Cloud Run sees traffic and does not stop the instance before the check-up ends, even if the tab closes.
- **Reports in the bucket, 30 days.** Check-up reports are saved in the bucket under the owner account, readable only by that account, and deleted after 30 days by a bucket lifecycle rule.
- **Safe mode by default.** Any public site can be checked read-only: no form submits, no Sensitive Actions, no security probing. Those unlock only after Verified Domain proof (ADR 0014). Private and internal addresses stay blocked.
- **Launch.** A "Get started" page on the Vercel site and a ready-to-paste invite message. Start with 5 to 10 known testers.

## Consequences
- Sign-in, limits, proof and reports survive a cold start; a visitor's AI key does not (they paste it again), by design.
- Bucket objects under `reports/` now expire after 30 days, which amends ADR 0036's "no expiry" for that prefix only.
- One instance with in-memory sessions still caps the pilot at roughly 20 active users. Scaling out later needs sessions and the queue in a shared store and is a new decision.
- `--no-cpu-throttling` is billed for the time an instance is up; with scale to zero that is only while someone is using it.
- Old `qa-check-up-site-*.run.app` links stop answering once the service is deleted. No redirect is kept.
