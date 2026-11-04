# 0036: Hosted Website Audits Live in a Cloud Storage Always-Free Bucket; Shared Links Are Served by the Runner

Status: Accepted, 2026-11-03 (DEC-003, REC-08; the developer's answer to D-003 / Q-50 on 2026-11-03: adopt the Q-39 answer, the Cloud Storage always-free bucket, with the Q-30 retention rules; written in task DOC-104). Amends [0032](0032-google-cloud-only-hosting.md). Builds on [0027](0027-checkup-session-module-and-route-table.md) and [0033](0033-website-audit-entry-point.md).

## Context
[0032](0032-google-cloud-only-hosting.md) runs the runner on Cloud Run with `--min-instances 0 --max-instances 1`, and its data folder is `RUNNER_DATA_DIR=/tmp/qa-data` (`.github/workflows/deploy.yml`). Cloud Run's `/tmp` is memory-backed: it is wiped on every redeploy and every scale to zero (AR-09, RISK-004). That is acceptable for Check-up reports, which a team regenerates, but not for Website Audits.

A Website Audit ([0033](0033-website-audit-entry-point.md)) keeps third-party data for a long time: Page Content, screenshots, every version and edit of the Audit Documents, the tool user's Shortlist entry with notes that can hold an owner's personal details, Shared Link records and Helper grants. Shared Links are handed to site owners, so they must keep working across restarts for their whole life, and they are the only audit pages a visitor without the access key can open (RISK-022).

Two answers met here. Q-39 (2026-10-30) put saved audits in the Cloud Storage always-free bucket of the archived DEC-005. DEC-003 (2026-11-03) then said this ADR decides hosted storage and its open choices go to the developer. Q-50 named that tension: does this ADR adopt the Q-39 answer? The developer answered D-003 on 2026-11-03: adopt.

The product goal is $0 hosting. Any durable store has to fit a free tier, or it breaks that goal.

## Decision
- **Where the data lives.**
  - **Hosted copy:** every Website Audit is stored in one Google Cloud Storage bucket on the always-free tier (Standard storage, single region `us-central1`, the region of [0032](0032-google-cloud-only-hosting.md)), in project `qa-flow-tester-512310`. The runner selects it when `AUDIT_STORE_BUCKET` is set.
  - **Local runs** keep plain files under the data folder (`<RUNNER_DATA_DIR>/audit-store/`) and need no cloud account (REQ-029). Both use the same store interface, so the layout below is the same in both.
  - **Layout:** one folder per Website Audit and one sub-folder per version (Q-39). Each version keeps the original and the edited text. A Website Audit's Shortlist entry, Shared Link records, shared snapshots and Helper grants are stored under that Website Audit's folder. The only record outside it is a small Shared Link index (`linkId` to Website Audit) needed to answer `/s/:linkId`, and it is deleted with the Website Audit.
- **Who can reach the bucket.** Only the runner's Cloud Run service account, with an object role granted on this bucket alone (no project-wide storage role). Uniform bucket-level access is on and public access prevention is enforced, so no object has a public address and no signed URL is handed out. Visitors, Helpers and the tool user reach the data only through runner routes and their access checks. The bucket is reached keylessly through the service account; no storage key is created or stored.
- **Retention (Q-30).** Everything a Website Audit owns is kept until the tool user deletes that Website Audit. There is no automatic expiry of audit data and no lifecycle rule that deletes it.
- **Deletion (Q-30).** Deleting a Website Audit removes all its data: every version, every edit, every file (Page Content, screenshots, exports), its Shortlist entry, every Shared Link and its shared snapshot, and every Helper grant. Deletion removes the whole folder and the Shared Link index entries, so a deleted audit's Shared Links answer 410 at once. Only the tool user can delete; a Helper cannot. The bucket has object versioning off and soft delete off (retention 0 days), so deleted data is not kept as hidden copies.
- **Shared Links (Q-30).**
  - A Shared Link has an unguessable ID (at least 128 bits from a cryptographic random source, URL-safe) and points to a snapshot of one Pitch Glimpse or improved-homepage preview, copied when the link is made. Later edits do not change what the link shows.
  - Each Shared Link expires 30 days after it is made. The tool user can revoke it at any time; revoking is final.
  - Shared Link pages never show the owner's contact details, the Shortlist mark, notes or outcome, and never show a release verdict ([0033](0033-website-audit-entry-point.md)).
- **How `/s/:linkId` is served.** The runner serves it, not the static site service and not the bucket.
  - It is declared in the route table ([0027](0027-checkup-session-module-and-route-table.md), task BE-102) with access level `public`, so it is the one audit route a visitor reaches without the access key. Every other audit route keeps its owner or Helper access level, and dispatch refuses a route with no declared level.
  - It accepts only `GET`. A `linkId` that is not in the expected format answers 404 without touching the store.
  - It reads only the shared snapshot named by the Shared Link record, never the live Website Audit, its other versions, its Shortlist entry or its Helper grants.
  - An unknown link answers 404. An expired or revoked link, or one whose Website Audit was deleted, answers **410 Gone** with a short page that shows no audit data.
  - Every response carries `X-Robots-Tag: noindex, nofollow` and a matching robots meta tag, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (so a revoked link is not served from a cache), `X-Content-Type-Options: nosniff` and a strict Content-Security-Policy: `default-src 'none'; img-src data:; style-src 'sha256-…'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Styles are allowed only through a per-response `'sha256-…'` hash of the page's own `<style>` element(s); never `'unsafe-inline'`. Images are inlined as `data:` URIs. The page runs no script. (DEC-008)

## Consequences
- **$0 hosting trade-off.** The always-free tier (5 GB of Standard storage a month in `us-central1`, with monthly limits on operations and egress) keeps hosting at $0 for a modest number of Website Audits. Screenshots fill it fastest. Going over the limits is billed from the project's credit, so the billing budget of [0032](0032-google-cloud-only-hosting.md) needs an alert. The alternative, keeping audits in `/tmp`, costs nothing but loses every Website Audit and breaks every Shared Link on each redeploy or scale to zero (AR-09), which is not acceptable for long-lived third-party data.
- [0032](0032-google-cloud-only-hosting.md)'s note that data in `/tmp` is wiped still holds for Check-up data; Website Audit data no longer lives there on the hosted copy.
- Every store read and write is a network call from the runner. `--max-instances 1` stays, so there is one writer and no locking between instances is needed.
- There are no backups: with versioning and soft delete off, a deleted Website Audit cannot be recovered. That is the point of Q-30, and the delete screen must say so.
- Third-party personal data (RISK-008) now lives in a durable store. Its protection rests on the bucket's IAM, public access prevention and the runner's route access levels; a test must prove a visitor without the access key reaches nothing but `/s/:linkId`.
- Shared Links publish an audit of someone else's site (RISK-022). Expiry, revocation, noindex and the snapshot-only read limit that exposure but do not remove it.
- Setup: the bucket, its settings and the service account's role are created once by hand and documented in `docs/DEPLOYMENT.md`; the deploy passes `AUDIT_STORE_BUCKET` to Cloud Run.
- Every Website Audit store task (saved audits, versions, Shortlist, Shared Links, Helper grants) depends on this record.

## Alternatives considered
- **Keep audits in `/tmp` (status quo).** $0 and no setup, but data and Shared Links are lost on every redeploy and scale to zero (rejected in DEC-003).
- **Firestore or Cloud SQL.** Firestore also has a free tier but splits files from records into two stores and needs a second client; Cloud SQL has no free tier and breaks the $0 goal.
- **A Cloud Storage volume mount (Cloud Storage FUSE) as the data folder.** Keeps the local file code, but file semantics over object storage (rename, partial writes) are unreliable, and access would no longer pass through the store's own deletion rules.
- **Serve Shared Link pages straight from the bucket or the static site service.** Needs public objects or signed URLs, cannot answer 410 on revocation or deletion, and cannot set the headers above. Rejected.
- **Shared Links that never expire.** Simpler, but contradicts Q-30 and leaves an audit of someone else's site open forever.
