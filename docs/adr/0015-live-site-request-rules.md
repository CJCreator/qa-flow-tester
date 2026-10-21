# 0015: Live-Site Request Rules: GraphQL Queries, GET/HEAD Replay and Pacing

Status: Deferred. No decision has been made and nothing is built. This number is kept so the roadmap's references (gap G14, API traffic, item 1.3; and the GraphQL live-site policy in `docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md`) resolve. It amends [0003](0003-deterministic-safety-filters-for-ai-discovery.md) if accepted.

## Context and Decision
Many sites send their reads as GraphQL `query` POSTs, and the roadmap wants to replay GET and HEAD requests and to set pacing rules for live sites. The Safety Filter ([0003](0003-deterministic-safety-filters-for-ai-discovery.md)) treats a POST as a write, so such reads are not replayed, and the product captures no API traffic. No decision has been made on whether a GraphQL read may be sent as a POST, or on the pacing rules. Until this record is accepted, the Safety Filter rules apply unchanged.

## Consequences
- A GraphQL-heavy live site gets fewer checks than a REST one.
- Before any POST is allowed on a live site, this record must be accepted, with its redaction rules ([0016](0016-evidence-redaction.md)) in place first.
