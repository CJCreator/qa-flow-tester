# 0033: The Website Audit Is a Separate Entry Point Beside the Check-up

Status: Accepted, 2026-10-30 (DEC-001; the developer's answers to Q-01, Q-05 and Q-34; written in task DOC-001). Builds on [0007](0007-competitive-reference-flow-benchmarking.md), [0010](0010-one-app-with-details-on-demand.md), [0018](0018-claim-wording.md), [0029](0029-one-ready-to-release-rule.md) and [0030](0030-passive-vs-active-security-boundary.md).

## Context
`Requirements.txt` (FR-1 to FR-33) describes a tool that audits other people's websites in order to pitch repair or redesign work: documents, a one-page pitch, a list of sites to pitch or skip, and a version for the owner on request. The Check-up serves someone else: a team checking its own App before a release. It is built around a Plan, a Plan Review and a release verdict ([0029](0029-one-ready-to-release-rule.md)).

Putting the audit inside the Check-up causes three problems:
- A "Ready to release" stamp on someone else's site means nothing, and pitch documents invite exactly the claims [0018](0018-claim-wording.md) forbids, such as "insecure" or "not accessible" (RISK-009).
- Plan Review and the AI Planner spend AI requests before any audit AI runs, and an audit has nothing to approve: it only reads.
- The report model would carry pitch-only fields (pitch or skip, opt-out text, price) that every Check-up ignores.

There is a precedent for a read-only flow on someone else's site: the Competitive Benchmark ([0007](0007-competitive-reference-flow-benchmarking.md)) has its own screen and store and crawls in Safe Interaction Mode. [0010](0010-one-app-with-details-on-demand.md) rejected two apps, not two ways to start in one app.

## Decision
- **A separate entry point on the shared engine.** The Website Audit gets its own start screen beside the Check-up, in the one app, with its own runner routes (in the route table, [0027](0027-checkup-session-module-and-route-table.md)) and its own store. It reuses the Deterministic Spider, the checkers, the AI Providers and the report writers. The Check-up, its Plan and its verdict do not change, and the Check-up stays for teams checking their own Apps.
- **Read-only by construction.** The audit path has no Plan to run, no Plan Review, no Roles and no submit step, so no request field can turn writing on:
  - The crawl explores in Safe Interaction Mode ([0007](0007-competitive-reference-flow-benchmarking.md)): no form is filled in or sent, no request that changes data is made, and links that leave the site are not followed.
  - Every check is Passive ([0030](0030-passive-vs-active-security-boundary.md)). No Security Probe runs and Active check consent is never read, even for a Test Copy.
  - Sign-in Walls are Skipped Pages with reason `sign-in`, and no sign-in is attempted. Payment areas (a card-number field, a payment-provider frame or a checkout path) are Skipped Pages with reason `payment`: nothing on them is clicked or sent, and their links are not followed.
  - Only public addresses are accepted (Q-22). Local and private addresses are refused for a Website Audit only; the Check-up keeps them for Test Copies.
  - Page-derived requests go through `safeGet` ([0031](0031-every-outbound-request-uses-pinned-resolver.md)), which is built before any Website Audit work (DEC-002). robots.txt is honoured, and requests to one host go one at a time and respect its Crawl-delay ([0015](0015-live-site-request-rules.md) is accepted with this rule, DEC-003).
- **No release verdict.** A Website Audit result has no verdict field and does not call `releaseVerdict`. No audit screen, Audit Document, Pitch Glimpse, Owner Audit or Shared Link page shows "Ready to release", a stamp, or a pass or fail on the site as a whole. Area grades come from deterministic checks under the [0029](0029-one-ready-to-release-rule.md) rules (an area with no checks run has no grade). AI writes notes that cite evidence; they are advisory and give no numeric score (DEC-007).
- **[0018](0018-claim-wording.md) wording everywhere, above all in the persuasive outputs.** The Audit Documents, the Pitch Glimpse, the Owner Audit and Shared Link pages say what was checked and what was not, say how each number was measured, and list Skipped Pages and checks that did not run as not checked. They never use the [0018](0018-claim-wording.md) word list. The tool never sends a pitch: the tool user hands it over, printed or as a Shared Link.
- **Market: India-wide.** Audit Documents, the Pitch Glimpse and the Owner Audit are written in English or Tamil, picked per export (Q-13). Hindi and other Indian languages come next (REQ-032) and are labelled beta until reviewed (DEC-014). The wizard's own screens stay in English. Outreach and privacy are reviewed against Indian rules first (the DPDP Act); the tool claims no compliance with them. The Check-up's recorded market (global, USD) is unchanged.
- **Free tier.** The Website Audit is part of the free tier for now (Q-05). Per-site pricing (FR-31, REQ-031) is deferred, and the recorded product pricing is unchanged.
- **Words.** `CONTEXT.md` adds Website Audit, Page Content, Section, Audit Document, Improvement Roadmap, Pitch Glimpse, Shared Link, Owner Audit, Shortlist and Helper, and the Skipped Page reasons `depth-limit`, `excluded` and `payment`. FR-26's "Enhancement plan" is the Improvement Roadmap and is never called a Plan.

Alternatives considered (`engineering/architecture.md`, "Positioning options"):
- **A mode inside the Check-up** (a purpose flag on the run). One engine and one history, but it puts a release verdict and a Plan Review on someone else's site, as described above.
- **Owner-side features only**, dropping the pitch rows. Rejected: the developer kept the pitch requirements in scope (Q-01).
- **A separate product** using `@qa/core` and `@qa/checkers` as libraries. It would have its own pricing, accounts and legal posture, but it costs the most: the packages are private workspace packages, not a library API, and deploys, sign-in and storage would be built twice.

## Consequences
- Two audiences and two sets of words in one app. Website Audit screens and documents use the `CONTEXT.md` terms above.
- The Website Audit shares the runner's single run slot: it is refused while a Check-up runs, and the other way round.
- Drift risk: the audit pipeline calls the checkers itself, so it can call them differently from the orchestrator (for example without the `FetchFn` of [0031](0031-every-outbound-request-uses-pinned-resolver.md)). Checker setup should be shared, not copied.
- Third-party data is stored: page text, screenshots, owners' contact details, and the tool user's notes and outcomes. It is kept until the tool user deletes the Website Audit (Q-30), and page content is sent to the AI Provider behind the tool user's key. Open risks: unsolicited outreach (RISK-005), personal data (RISK-008), and Shared Links that publish an audit of someone else's site (RISK-022).
- Generated documents are tested for the [0018](0018-claim-wording.md) word list and for the absence of a release verdict (tasks BE-017 and BE-020).
- One request at a time per host (DEC-003) makes audits of large sites slower.
- Follow-up records: 0034 (encrypted AI key fallback), 0035 (PageSpeed data), 0036 (hosted audit storage and Shared Links, amends [0032](0032-google-cloud-only-hosting.md)) and 0037 (helper sign-in). [0015](0015-live-site-request-rules.md) moves to Accepted.
