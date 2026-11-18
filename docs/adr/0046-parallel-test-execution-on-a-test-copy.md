# 0046: Parallel Test Execution on a Test Copy

Status: Proposed (pending the developer sign-off), 2026-11-18. The owner asked for this rewrite; it is not yet accepted. Supersedes the one-at-a-time pacing of [0015](0015-live-site-request-rules.md) **for Test Copy runs only**. Builds on [0043](0043-parallel-page-fetching-in-the-website-audit.md), whose `HostPacer` `maxInFlight` option it reuses. Live sites, third-party sites and the Website Audit keep their rules.

## Context
The Check-up's Testing stage runs Plan Items one after another, each in its own browser page. On a Test Copy (an App the person owns or runs: a staging address, a local or private address, a dev tunnel, or a host marked as a Test Copy; see the "Test Copy" entry in `CONTEXT.md`) a long Plan waits on each item in turn. The owner has approved running Plan Items in parallel browser contexts on a Test Copy.

ADR 0015 set one request at a time per host for the Check-up. That rule was written for live sites the tool user does not own. It does not fit a Test Copy, which the person has said is safe to fill in and send forms on. The Website Audit already accepts up to 3 pages per host ([0043](0043-parallel-page-fetching-in-the-website-audit.md)); that cap is for the Website Audit only.

Current behaviour, observed in the code on 2026-11-18:
- Testing-stage browser navigations in `packages/core/src/orchestrator.ts` are **not** paced by `HostPacer`. The orchestrator does not pass a pacer. Test navigations are serial today, and unpaced.
- Checker fetches go through `packages/core/src/safe-net.ts` and `packages/core/src/checker-fetch.ts`. They use a `HostPacer` only when one is passed.
- `packages/core/src/host-pacer.ts` defaults `maxInFlight` to 1 and forces it to 1 when `crawlDelayMs > 0`.

## Decision
- **Test Copy runs may have several page requests in flight per host.** The cap is `maxInFlight`, set per run from a configurable value N:
  - Bounds: 1 to 5. A value outside the bounds is clamped.
  - Default N = 1. This ships the pool at one, which is today's behaviour. A run uses a higher N only when the person chooses one for that run; the default stays 1 until they do.
- **What the cap governs.** Only two things, both on a Test Copy run:
  - Testing-stage navigations in the Check-up. These are unpaced today, so the cap adds a pacer where none exists.
  - Checker fetches of the same run.
  Nothing else is governed by this cap: not the Website Audit, not live-site or third-party runs, not discovery.
- **The cap is its own setting.** It is separate from the Website Audit's cap (3, ADR 0043) and from the live-site default (1, ADR 0015). Changing one does not change the others.
- **Gate.** The raised cap applies only when the run is a Test Copy. The existing flag is the per-run `testCopy` option on the orchestrator (`packages/core/src/orchestrator.ts`); it already sets certificate handling. Its source is the Test Copy decision (`decideTestCopy` in `packages/core/src/domain-verification.ts`, called via `packages/core/src/live-site.ts`). Whether the runner passes that decision into the option was not traced in this pass; confirm it before build. A run without `testCopy: true` never gets N above 1.
- **Unchanged rules:**
  - Live sites and third-party sites: one request at a time per host (ADR 0015).
  - Website Audit: ADR 0043, including its back-off rules.
  - A robots.txt Crawl-delay forces the cap to 1 for that host, as in 0043 and in `HostPacer` (`crawlDelayMs > 0` sets `maxInFlight` to 1). This applies on a Test Copy too.
- **Safety.** The Safety Filter ([0003](0003-deterministic-safety-filters-for-ai-discovery.md)) and evidence redaction ([0016](0016-evidence-redaction.md)) are unchanged. Parallel runs pass through the same filters and redaction as serial runs. Test Copy classification (ADR 0014) is unchanged; a host that is not a Test Copy never gets a cap above 1.
- **Implementation.** `HostPacer` already supports `maxInFlight` (ADR 0043). The Testing stage does not pass a pacer today, so the build adds one, and passes N to it only when the run is a Test Copy. Build tickets are written after sign-off.

## Open for sign-off
- Whether a 429 or 503 from a Test Copy drops the host to one request at a time for the rest of the run, as 0043 does for the Website Audit. Proposed: yes, the same back-off.
- Whether N is set in the wizard, in a config file, or both. Proposed: a config value, with the default of 1.
- **Finding to confirm:** that Testing-stage navigations are unpaced today (the orchestrator passes no `HostPacer`). If the developer sees a pacer elsewhere in that path, this decision and the Context section need correcting.

## Consequences
- A Test Copy Check-up with many Plan Items finishes sooner, roughly in proportion to N for independent items. At the default N = 1 nothing changes.
- A Test Copy may see up to N concurrent page loads when N is raised above 1. The owner has approved this for Test Copies.
- Plan Items that depend on each other (sign-in, shared state) still need ordering. The parallel runner must keep them in sequence.
- Live-site Check-ups get no speed-up from this record.
- 0015 keeps its other rules (GraphQL POST and GET/HEAD replay stay undecided).
