# 0015: Live-Site Request Rules: GraphQL Queries, GET/HEAD Replay and Pacing

Status: Accepted for pacing only, 2026-10-30 (Q-12, developer sign-off 2026-10-30; [0033](0033-website-audit-entry-point.md), DEC-003; written in task DOC-105). The GraphQL query POST and GET/HEAD replay questions stay undecided. This number is kept so the roadmap's references (gap G14, API traffic, item 1.3; and the GraphQL live-site policy in `docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md`) resolve. It amends [0003](0003-deterministic-safety-filters-for-ai-discovery.md) only if the undecided parts are accepted. For the Website Audit, the one-request-at-a-time pacing is superseded by [0041](0041-parallel-page-fetching-in-the-website-audit.md); the Check-up keeps it.

## Context
Many sites send their reads as GraphQL `query` POSTs, and the roadmap wants to replay GET and HEAD requests and to set pacing rules for live sites. The Safety Filter ([0003](0003-deterministic-safety-filters-for-ai-discovery.md)) treats a POST as a write, so such reads are not replayed, and the product captures no API traffic.

The Website Audit ([0033](0033-website-audit-entry-point.md)) crawls public websites the tool user usually does not own, so it needs a pacing rule before it ships (REQ-035). Q-12 asked what rate applies to the audited host and whether robots.txt Crawl-delay is honoured; the developer answered on 2026-10-30: one request at a time per host, and honour Crawl-delay.

## Decision
- **Pacing (accepted).**
  - One request at a time per host: a request to a host starts only after the previous request to that host has finished.
  - robots.txt Crawl-delay is honoured: when the host's robots.txt sets a Crawl-delay for the tool's user agent (or `*`), requests to that host are spaced at least that far apart. robots.txt itself is honoured too ([0033](0033-website-audit-entry-point.md)).
  - It covers top-level requests: page documents, robots.txt, sitemaps, checker and link fetches. A page's own subresources (CSS, JS, images) load within its turn (Q-56 default).
  - It is built by task BE-105 (host pacer in the Spider and in outbound fetch).
- **GraphQL query POSTs (undecided).** No decision has been made on whether a GraphQL read may be sent as a POST on a live site.
- **GET/HEAD replay (undecided).** No decision has been made on replaying captured GET and HEAD requests.
- Until those two are decided, the Safety Filter rules apply unchanged.

## Consequences
- One request at a time per host makes audits of large sites slower.
- A GraphQL-heavy live site gets fewer checks than a REST one.
- Before any POST is allowed on a live site, the GraphQL part of this record must be accepted, with its redaction rules ([0016](0016-evidence-redaction.md)) in place first.
