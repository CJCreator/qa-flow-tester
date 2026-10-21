# 0031: Every Outbound Request Uses the Pinned, Redirect-Checked Resolver

Status: Accepted, 2026-10-21 (remediation ticket T-43, SECURITY S1 and S2). Builds on [0014](0014-verified-domains-and-safe-host-classification.md) and [0030](0030-passive-vs-active-security-boundary.md).

## Context
ADR 0014 pinned the address for the App's own pages and forms, and a browser guard checks each browser request on a shared machine. Two paths went around it:
- Playwright's API client (`context.request`, `page.request`, `request.fetch`) does its own name lookup and follows redirects. A route guard does not see it: a link or sitemap that resolved to `127.0.0.1` or `169.254.169.254` was reached.
- The runner's robots.txt `Sitemap:` lines were fetched with no host check, so one line could send the runner to another host.

## Decision
- **One outbound path.** Every request the runner makes to a host from a page-derived or site-derived address goes through `safeGet` in `packages/core/src/safe-net.ts`: resolved once per hop, connected to the checked address, every redirect hop checked again.
- **Public only on a shared machine.** A run with a browser guard set (`RUNNER_BETA=1`) refuses non-public addresses. A local run passes `allowPrivate`, the same rule as ADR 0014 (local mode is unchanged). The flag is never set from request input.
- **Checkers receive the fetch.** `packages/checkers` cannot import `packages/core`, so the checkers take a `FetchFn` from the caller. Core builds it with `makeOutboundFetch`. A checker with no fetch function makes no request: the network checks (security.txt, source maps, broken links, site root files) are skipped, not run on Playwright's request API.
- **Sitemap hosts.** A `Sitemap:` line, and each `<loc>` in a sitemap, is read only if it names the target's site (the same rule as the crawl itself). Other hosts are logged and skipped.
- **GET only.** The helper sends GET. The old HEAD-then-GET link check now sends GET once.
- **Bodies are capped.** Each response is read up to a size cap; the status is what the checks use. A body over the cap still counts as a response.

## Consequences
- The source-grep test (`packages/core/tests/outbound-source-grep.test.ts`) keeps Playwright request calls and Node `fetch` out of the page-derived paths. Its exception list names the calls still to move (see the T-43 handoff list); it shrinks as they move.
- Broken-link and site-root checks on a Check-up run need the caller to pass `fetchFn` to the checkers. Until it is wired, these checks report nothing rather than fetching by another path. This is deliberate: fail closed (ADR 0014).
- Redirect-to-private and sitemap-to-other-host are refused on a shared machine with no change to local runs.
- Cost: one DNS lookup per hop, as for the browser guard.
- Not covered here: robots.txt fetches made by `RobotsPolicy.fetch` (ADR 0014 lists them as a follow-up), the AI provider endpoints (fixed URLs, not page-derived), and the Verified Domain proof (already uses `safeGet`).
