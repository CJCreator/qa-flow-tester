# Architecture decision records

One row per record. The record itself holds the decision, its context and any later amendments. Status is taken from each record's own status line.

| No. | Title | Status |
|---|---|---|
| [0001](0001-hybrid-ai-discovery.md) | Hybrid Exploration Architecture for AI Discovery | (see record) |
| [0002](0002-multi-provider-byok-ai-adapter.md) | Multi-Provider BYOK AI Adapter | (see record) |
| [0003](0003-deterministic-safety-filters-for-ai-discovery.md) | Deterministic Safety Filters for AI Discovery | (see record) |
| [0004](0004-structural-fingerprint-deduplication.md) | Deterministic Structural Fingerprinting for Finding Deduplication | Accepted |
| [0005](0005-report-hub-typescript-monorepo-service.md) | TypeScript Fastify Hub in Monorepo Topology | Superseded (retired) |
| [0006](0006-two-tier-decoupled-design-checker.md) | Two-Tier Decoupled Design Checker Architecture | (see record) |
| [0007](0007-competitive-reference-flow-benchmarking.md) | Competitive and Reference Public Flow Benchmarking | Accepted |
| [0008](0008-single-local-server.md) | One Local Server for the Runner, Wizard and Studio | the `HUB_API_URL` forwarding of `/api/v1/*` described under  |
| [0009](0009-ai-plans-every-plan-item.md) | The AI Plans Every Plan Item from the Crawl's Facts | (see record) |
| [0010](0010-one-app-with-details-on-demand.md) | One App, with Details for Developers on Demand | Accepted, 2026-09-30 |
| [0011](0011-ai-asked-only-what-facts-cannot-say.md) | The AI Is Asked Only What the Crawl's Facts Can't Say | (see record) |
| [0012](0012-hosted-runner-github-actions.md) | Where Check-ups Run: the User's Own GitHub Actions First | (see record) |
| [0013](0013-opt-in-ai-explorer-and-selector-fixes.md) | Opt-in AI Explorer and AI-Proposed Selector Fixes | Deferred |
| [0014](0014-verified-domains-and-safe-host-classification.md) | Verified Domains and Host Checks for Shared Machines | Accepted 2026-10-07 (owner answers recorded under Decisions  |
| [0015](0015-live-site-request-rules.md) | Live-Site Request Rules: GraphQL Queries, GET/HEAD Replay and Pacing | Accepted for pacing only, 2026-10-30 (Q-12, developer sign-o |
| [0016](0016-evidence-redaction.md) | Redaction of Sign-in Details and Secrets in Everything a Check-up Keeps | Accepted 2026-10-08 (records behaviour already shipped; no c |
| [0017](0017-findings-contract.md) | Findings contract | Accepted 2026-10-08 (owner accepted all seven recommended an |
| [0018](0018-claim-wording.md) | Claim Wording: Never "Compliant", Never "Secure" | Accepted |
| [0019](0019-visual-diff-stabilising-and-masking.md) | Perceptual Visual Diff: Stabilise Before Capture, Mask Volatile Regions, Show Old/New/Difference | Accepted by plan approval, 2026-10-08 (the owner approved th |
| [0020](0020-sources-role-binding-and-pipelined-planning.md) | Sources, Role Binding, Needs-Your-Judgement Findings and Pipelined Planning | Accepted 2026-10-09 |
| [0021](0021-saved-sessions-memory-only-and-confined-docs-fetch.md) | Saved Sessions Are Memory-Only; Docs-URL Fetch Is Confined | Accepted by plan approval, 2026-10-09 (the owner approved th |
| [0022](0022-test-sign-in-as-consent.md) | Test Sign-In Details Count as Consent to Full Testing (Local Only) | Accepted by plan approval, 2026-10-10 (the owner chose "cred |
| [0023](0023-word-in-scope-and-structured-spec-parsing.md) | Word in Scope and Structured Spec Parsing | Accepted 2026-10-12 |
| [0024](0024-intent-and-refusal-rule.md) | Intent on Plan Items, and the Refusal Rule for Rejects | Accepted, 2026-10-12 (agreed in a grilling session on `QA te |
| [0025](0025-spider-guarded-delete-probe.md) | The Spider opens Interactive States and probes Delete under a guard | Accepted, 2026-10-12 |
| [0026](0026-deterministic-sign-in-and-session-handling.md) | Deterministic Sign-In, Session Lifecycle and Origin-Scoped Header Propagation | Accepted, 2026-10-14 |
| [0027](0027-checkup-session-module-and-route-table.md) | Check-up Session Module and a Route Table for the Runner | Accepted and implemented (tickets T-201 to T-211, all done;  |
| [0028](0028-plan-review-default-with-signin.md) | Plan Review Is On by Default When Sign-In Details Are Given | Accepted, 2026-10-16, accepted by the owner (from UX flow re |
| [0029](0029-one-ready-to-release-rule.md) | One Ready-to-Release Rule, Honest Grades | Accepted, 2026-10-17 (demo-readiness plan, decision 1; ticke |
| [0030](0030-passive-vs-active-security-boundary.md) | Passive vs Active Security Boundary | Accepted, 2026-10-19 (qaskills-patterns, ticket QSP-001) |
| [0031](0031-every-outbound-request-uses-pinned-resolver.md) | Every Outbound Request Uses the Pinned, Redirect-Checked Resolver | Accepted, 2026-10-21 (remediation ticket T-43, SECURITY S1 a |
| [0032](0032-google-cloud-only-hosting.md) | Everything Runs on Google Cloud Run; Render and Vercel Are Retired | Accepted, 2026-10-26 |
| [0033](0033-website-audit-entry-point.md) | The Website Audit Is a Separate Entry Point Beside the Check-up | Accepted, 2026-10-30 (DEC-001; the developer's answers to Q- |
| [0034](0034-encrypted-key-fallback.md) | The Key Fallback File Is Encrypted; Named Service Keys Use the Same Resolver | Accepted, 2026-10-31 |
| [0035](0035-pagespeed-data.md) | Page Speed for the Website Audit Comes from the PageSpeed Insights API | Accepted, 2026-11-03 |
| [0036](0036-hosted-audit-storage-and-shared-links.md) | Hosted Website Audits Live in a Cloud Storage Always-Free Bucket; Shared Links Are Served by the Runner | Accepted, 2026-11-03 (DEC-003, REC-08; the developer's answe |
| [0037](0037-route-access-levels.md) | Every Runner Route Declares an Access Level and a Beta Policy; Owner, Helper and Public Access | Accepted, 2026-11-03 (DEC-001, REC-06; beta policy from the  |
| [0038](0038-warm-runner-instance.md) | The Hosted Runner Keeps One Warm Instance; Old Images Are Cleaned Up | Accepted, 2026-11-04 (owner's choice in chat, 2026-11-04) |
| [0039](0039-cloud-scheduler-owner-schedules.md) | Owner Check-up Schedules on the Hosted Copy Run from Cloud Scheduler, Authenticated by a Google OIDC Token | Accepted, 2026-11-04 (owner's answers in chat) |
| [0040](0040-test-tiers-no-fabricated-websites.md) | No Fabricated Websites; Two Test Tiers | Accepted, 2026-11-04 (owner's answers in chat, 2026-11-04) |
| [0041](0041-two-area-navigation.md) | Two-Area Navigation | Accepted, 2026-11-05 (UI redesign, Phase 1 plan "Navigation" |
| [0042](0042-website-audit-reliability-and-access.md) | Website Audit Reliability and Access | Accepted, 2026-11-05 (owner's answers in a grilling session, |
| [0043](0043-parallel-page-fetching-in-the-website-audit.md) | Parallel Page Fetching in the Website Audit | Accepted, 2026-11-05 (owner's answers in a grilling session, |
| [0044](0044-expansion-platform-scope-and-roadmap.md) | Expansion Platform Scope and Architecture Roadmap | Accepted as a roadmap, 2026-11-06 |
| [0045](0045-pinned-egress-proxy-for-chromium.md) | A Pinned Egress Proxy for Chromium on the Shared Machine | Accepted, 2026-11-12 (owner's answer on T-308) |
| [0046](0046-parallel-test-execution-on-a-test-copy.md) | Parallel Test Execution on a Test Copy | Accepted, 2026-11-18 |
