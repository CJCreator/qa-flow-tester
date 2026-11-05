# Architecture decision records: index

All 43 records, with status. ADRs are historical: a superseded record stays in this folder with its status line, because other records link to it. Read the newest record in a cluster first.

Status key: **Accepted** (in force), **Partly superseded** (some parts replaced; the named record says which), **Superseded** (replaced in full), **Deferred** (no decision, nothing built). Records without a status line are marked *(no status line)*; their status is implied by the rest of the record.

## Core product and check-up

| ADR | Title | Status | Related |
|---|---|---|---|
| [0001](0001-hybrid-ai-discovery.md) | Hybrid exploration architecture for AI discovery | **Superseded** | by [0009](0009-ai-plans-every-plan-item.md) |
| [0002](0002-multi-provider-byok-ai-adapter.md) | Multi-provider BYOK AI adapter | Accepted *(no status line)* | amended by [0034](0034-encrypted-key-fallback.md) |
| [0003](0003-deterministic-safety-filters-for-ai-discovery.md) | Deterministic safety filters for AI discovery | Accepted *(no status line)* | |
| [0004](0004-structural-fingerprint-deduplication.md) | Structural fingerprint deduplication | Accepted | cross-machine dedupe never built (Hub retired) |
| [0006](0006-two-tier-decoupled-design-checker.md) | Two-tier decoupled design checker | Accepted *(no status line)* | |
| [0007](0007-competitive-reference-flow-benchmarking.md) | Competitive reference flow benchmarking | Accepted | Hub item retired with [0005](0005-report-hub-typescript-monorepo-service.md) |
| [0008](0008-single-local-server.md) | Single local server | **Partly superseded** | by [0010](0010-one-app-with-details-on-demand.md); the single-server and loopback rules stand |
| [0009](0009-ai-plans-every-plan-item.md) | The AI plans every plan item from the crawl's facts | Accepted *(no status line)* | supersedes [0001](0001-hybrid-ai-discovery.md); amended by [0011](0011-ai-asked-only-what-facts-cannot-say.md), [0020](0020-sources-role-binding-and-pipelined-planning.md) |
| [0010](0010-one-app-with-details-on-demand.md) | One app with details on demand | Accepted (2026-09-30) | partly supersedes [0008](0008-single-local-server.md) |
| [0011](0011-ai-asked-only-what-facts-cannot-say.md) | The AI is asked only what the crawl's facts cannot say | Accepted *(no status line)* | amends [0009](0009-ai-plans-every-plan-item.md) |
| [0013](0013-opt-in-ai-explorer-and-selector-fixes.md) | Opt-in AI explorer and selector fixes | **Deferred** | gap G22 |
| [0014](0014-verified-domains-and-safe-host-classification.md) | Verified domains and safe host classification | Accepted (2026-10-07) | amended by [0022](0022-test-sign-in-as-consent.md) |
| [0016](0016-evidence-redaction.md) | Evidence redaction | Accepted (2026-10-08) | |
| [0017](0017-findings-contract.md) | Findings contract | Accepted (2026-10-08) | |
| [0018](0018-claim-wording.md) | Claim wording | Accepted | known gap: scoring still names an area "Secure" |
| [0019](0019-visual-diff-stabilising-and-masking.md) | Visual diff stabilising and masking | Accepted (2026-10-08) | |
| [0020](0020-sources-role-binding-and-pipelined-planning.md) | Sources, role binding and pipelined planning | Accepted (2026-10-09) | amended by [0023](0023-word-in-scope-and-structured-spec-parsing.md) |
| [0021](0021-saved-sessions-memory-only-and-confined-docs-fetch.md) | Saved sessions memory-only and confined docs fetch | Accepted (2026-10-09) | |
| [0022](0022-test-sign-in-as-consent.md) | Test sign-in as consent | Accepted (2026-10-10) | amends [0014](0014-verified-domains-and-safe-host-classification.md) |
| [0023](0023-word-in-scope-and-structured-spec-parsing.md) | Word in scope, structured spec parsing | Accepted (2026-10-12) | amends [0020](0020-sources-role-binding-and-pipelined-planning.md) |
| [0024](0024-intent-and-refusal-rule.md) | Intent and refusal rule | Accepted (2026-10-12) | |
| [0025](0025-spider-guarded-delete-probe.md) | Spider-guarded delete probe | Accepted (2026-10-12) | |
| [0026](0026-deterministic-sign-in-and-session-handling.md) | Deterministic sign-in and session handling | Accepted (2026-10-14) | |
| [0027](0027-checkup-session-module-and-route-table.md) | Check-up session module and route table | Accepted and implemented | |
| [0028](0028-plan-review-default-with-signin.md) | Plan Review default with sign-in | Accepted (2026-10-16) | amends [0022](0022-test-sign-in-as-consent.md) |
| [0029](0029-one-ready-to-release-rule.md) | One ready-to-release rule | Accepted (2026-10-17) | |
| [0030](0030-passive-vs-active-security-boundary.md) | Passive vs active security boundary | Accepted (2026-10-19) | |
| [0031](0031-every-outbound-request-uses-pinned-resolver.md) | Every outbound request uses the pinned resolver | Accepted (2026-10-21) | |
| [0041](0041-two-area-navigation.md) | Two-area navigation | Accepted (2026-11-05) | |

## Hosting, storage and scheduling

| ADR | Title | Status | Related |
|---|---|---|---|
| [0012](0012-hosted-runner-github-actions.md) | Where check-ups run: the user's own GitHub Actions first | **Partly superseded** | by [0032](0032-google-cloud-only-hosting.md) (Render and Vercel retired) |
| [0032](0032-google-cloud-only-hosting.md) | Google Cloud only hosting | Accepted (2026-10-26) | amends [0012](0012-hosted-runner-github-actions.md); amended by [0036](0036-hosted-audit-storage-and-shared-links.md), [0038](0038-warm-runner-instance.md) |
| [0036](0036-hosted-audit-storage-and-shared-links.md) | Hosted audit storage and shared links | Accepted (2026-11-03) | amends [0032](0032-google-cloud-only-hosting.md) |
| [0037](0037-route-access-levels.md) | Route access levels | Accepted (2026-11-03) | amended by [0039](0039-cloud-scheduler-owner-schedules.md) |
| [0038](0038-warm-runner-instance.md) | Warm runner instance | Accepted (2026-11-04) | amends [0032](0032-google-cloud-only-hosting.md) |
| [0039](0039-cloud-scheduler-owner-schedules.md) | Cloud Scheduler owner schedules | Accepted (2026-11-04) | amends [0037](0037-route-access-levels.md) |

## Testing

| ADR | Title | Status | Related |
|---|---|---|---|
| [0040](0040-test-tiers-no-fabricated-websites.md) | Test tiers, no fabricated websites | Accepted (2026-11-04) | supersedes earlier fixture-site passages |

## Website Audit

| ADR | Title | Status | Related |
|---|---|---|---|
| [0033](0033-website-audit-entry-point.md) | The Website Audit is a separate entry point beside the Check-up | Accepted (2026-10-30) | |
| [0034](0034-encrypted-key-fallback.md) | Encrypted key fallback | Accepted (2026-10-31) | amends [0002](0002-multi-provider-byok-ai-adapter.md) |
| [0035](0035-pagespeed-data.md) | PageSpeed data | Accepted (2026-11-03) | amended by [0042](0042-website-audit-reliability-and-access.md) |
| [0042](0042-website-audit-reliability-and-access.md) | Website Audit reliability and access | Accepted (2026-11-05) | amends [0033](0033-website-audit-entry-point.md) and [0035](0035-pagespeed-data.md) |
| [0043](0043-parallel-page-fetching-in-the-website-audit.md) | Parallel page fetching in the Website Audit | Accepted (2026-11-05) | supersedes the one-request-per-host bullet of [0015](0015-live-site-request-rules.md) for the Website Audit only |

## Live-site request rules

| ADR | Title | Status | Related |
|---|---|---|---|
| [0015](0015-live-site-request-rules.md) | Live-site request rules: GraphQL, GET/HEAD replay and pacing | Accepted for pacing only (2026-10-30) | GraphQL and GET/HEAD replay still open; per-host rule replaced for the Website Audit by [0043](0043-parallel-page-fetching-in-the-website-audit.md) |

## Retired

| ADR | Title | Status | Related |
|---|---|---|---|
| [0005](0005-report-hub-typescript-monorepo-service.md) | Report Hub, TypeScript monorepo service | **Superseded (retired)** | never built; replaced by [0008](0008-single-local-server.md) and [0010](0010-one-app-with-details-on-demand.md) |

## Counts

43 records. Superseded: 2 (0001, 0005). Partly superseded: 2 (0008, 0012). Deferred: 1 (0013). Accepted (including 0015, accepted for pacing only): 38. Of those 38, 5 have no status line (0002, 0003, 0006, 0009, 0011).
