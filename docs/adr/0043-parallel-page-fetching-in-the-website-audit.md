# 0043: Parallel Page Fetching in the Website Audit

Status: Accepted, 2026-11-05 (owner's answers in a grilling session, 2026-11-05). Supersedes the "one request at a time per host" bullet of [0015](0015-live-site-request-rules.md) **for the Website Audit only**, and the matching clause in [0033](0033-website-audit-entry-point.md) (DEC-003). The Check-up's pacing is unchanged. robots.txt and its Crawl-delay are still honoured.

## Context
A Website Audit fetches pages one at a time per host with at least 500 ms between requests (`HostPacer`, `packages/core/src/host-pacer.ts`; the Deterministic Spider's two workers wait for the host's turn). The AI notes then run one request at a time too (`packages/core/src/audit/ai/assessment.ts:84`). With the default limit of 200 pages an audit takes many minutes, and on the hosted copy it only gets CPU while the progress stream is open (Cloud Run CPU throttling). The owner wants the audit to work on several pages in parallel, from fetching to document writing.

## Decision
- **Fetch up to 3 pages of one host at once** in the Website Audit. One browser, one context, up to 3 open pages. `HostPacer` gets a `maxInFlight` option. Its default stays 1, so the Check-up, `safeGet` and checker fetches keep the one-at-a-time rule of 0015.
- **Back off to one at a time** for the rest of the audit when any of these happens:
  - robots.txt sets a Crawl-delay for the tool's user agent or `*`. The Crawl-delay is then the gap, as in 0015.
  - The host answers 429 or 503. A `Retry-After` header, capped at 60 s, is waited out before the next request. A second 429 or 503 doubles the gap, up to 10 s.
- **The 500 ms minimum gap between request starts stays**, so a site sees at most about 2 page loads a second.
- **Retry once.** A page that times out, answers 5xx, or fails at the network level is retried once, after the back-off wait. If it fails again it becomes a Skipped Page with reason `timeout`, `http-error` or `did-not-load`.
- **Ride out a short outage.**
  - A network failure (refused, reset, unreachable) waits 5 s before its retry, not the immediate retry it gets today.
  - When 3 pages in a row fail at the network level, the crawl pauses fetching. It checks the start address every 10 s for up to 60 s, and carries on when it answers. The pages that failed during the pause go back in the queue once.
  - When the host does not come back, the audit finishes with what it has, plus a note: "The site stopped answering after N pages".
  - On 2026-11-05 a dev server behind a tunnel dropped for a short while, and 13 of 21 pages failed in about 100 ms each.
- **After fetching, work is not bound to the site.** Per-page checks, AI notes (4 requests at a time against the AI Provider, not the site) and Audit Document writing run in parallel pools. Only the fetch obeys the per-host rule.
- **Default limits drop** to 50 pages and depth 5 for a Website Audit. The upper bound stays 1000 pages on a local runner and becomes 200 on the hosted copy. The Check-up's `CRAWL_LIMIT_BOUNDS` is unchanged.

## Consequences
- A 50-page audit fetches in roughly a third of the time it took before. A site with a Crawl-delay is as slow as before, by design.
- The audited site sees up to 3 concurrent page loads. The owner accepts this for sites the tool user does not own. RISK-005 (unsolicited outreach) is unchanged.
- `HostPacer` gains concurrency logic shared with the Check-up's code path. Its default of 1 and a unit test keep the Check-up's behaviour fixed.
- Memory: 3 open pages in one Chromium fit the hosted 2 GiB instance. The run slot still allows one run at a time on a runner.
- Built by T-80 (crawl and pacer) and T-81/T-84 (AI pool and pipeline), in the Website Audit reliability plan (removed once built; `git show dfe5bc4:docs/tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md`).

## In review (#59, `feat/audit-parallel-crawl`)
Not merged. Parts of T-80 and T-81 are built on that branch.
- `HostPacer` takes `maxInFlight` (the Website Audit passes 3; the default stays 1). Starts stay spaced by the 500 ms gap. A robots Crawl-delay keeps the host at 1.
- `slowDown(host, retryAfterMs)` answers a 429 or 503. `Retry-After` is capped at 60 s. A repeat doubles the gap, up to 10 s.
- `retryBusyHost` retries the page once after a 429 or 503. Audit only.
- AI page assessments run 4 at a time.

Measured:
- htmx.org, 15 pages: crawl 39.5 s before, 19.9 s after.
- The owner's app via dev tunnel, 50-page limit: 824 s with 19 of 24 pages before; 83 s with 24 of 24 after. The dev server was warm on the second run.

Not built yet: the outage handling (A13) and the 5 s wait before a network-error retry.
