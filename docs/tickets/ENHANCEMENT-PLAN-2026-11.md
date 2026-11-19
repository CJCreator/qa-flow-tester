# Enhancement plan, November 2026: trust, then speed, then the Improved version

Built from the [19 November review](../reviews/2026-11-19-product-review.md) and the owner's answers in a grilling session on 2026-11-19 (18 question rounds and a 24-item technical sign-off, approved as a whole). Terms: [`CONTEXT.md`](../../CONTEXT.md). One file per ticket under [enhance-2026-11/](enhance-2026-11/). Status lives in [INDEX.md](INDEX.md).

## Goals and success measures

| Goal | Measure |
|---|---|
| Hosted Website Audit works for the owner | The owner opens `/audits/new` on the hosted copy and finishes an audit |
| One count, live and final | The last live "Problems that count" equals `verdict.total`; a parity unit test enforces it |
| Large sites, every page tested | On the local runner, a 5,000-page site is fully tested in under 2 hours; every page not recorded is a Skipped Page with a reason |
| Polite to other people's sites | At most 2 page starts per second; no rise in 429 answers against the baseline |
| Faster Check-up | Run time −50% at the same flaky rate (±2 points) |
| Improved version | One improved page per Layout Group, 1 to 5 design variants, before/after, HTML download, in the exports and the Pitch Glimpse; every AI statement cites a finding or Section id |

## Owner decisions (2026-11-19)

- **Where the problems were seen:** hosted and local, Check-up and Website Audit. The plan covers all four.
- **Scope:** every review finding plus the Improved version. Mobile and API checks stay later (ADR 0044).
- **Order:** trust, then speed, then features. Built with the `/ship` batch loop; tests run at `/verify-all`.
- **Scale:**
  - Sites of up to 5,000 pages, with **every page fully tested** (not template sampling).
  - Big runs on the **local runner only**, in under 2 hours.
  - The hosted cap stays at 200.
  - A hosted audit that loses its tab is checkpointed and resumed, with a "keep this tab open" warning. There is no always-on CPU, so hosting stays $0.
- **Politeness:** adaptive concurrency, at most 2 page starts per second, backing off on 429/503 and robots.txt.
- **Retries:** a failed Check-up test is retried once (the guide's rule; the code allows 3 today).
- **Counting:** the headline everywhere is **Problems that count**, with a breakdown from raw findings.
- **Translation:** exports translate findings and content with AI on the user's key. Languages other than English and Tamil keep the beta label.
- **AI cost:** always the user's own key, with an estimate shown before every AI step.
- **The Improved version:**
  - It serves an auditor pitching to a site owner and an owner fixing their own site equally.
  - Coverage is one page per Layout Group.
  - The user picks 1 to 5 design variants per page. Each is an AI-written, sanitized HTML page that keeps the site's logo and colours.
  - Delivered as a live page, a before/after view, an HTML download, inside the exports, and as the best variant's thumbnail in the Pitch Glimpse.
  - Design variants ship **first**. Then come fix options per finding, competitor examples, and copy variants.
  - Quality gate: automatic checks only.
- **Competitors:**
  - Found **automatically**: the AI names them from the audit, using the user's key, with no search API.
  - Each is read at its homepage plus about 10 key pages, read-only.
  - Allowed on the hosted copy, where its pages count toward the 200-page cap.
- **Benchmarks:**
  - techgramam.com (about 19 sitemap URLs).
  - arocord.com (its sitemap answers 403 to plain clients, which makes it a useful blocked-visitor case).
  - mghealthtech.com (about 30 URLs).
  - One large public documentation site whose robots.txt allows crawling, run locally only (chosen in T-411).

## Decisions recorded as ADRs (drafts in this plan, status Proposed)

- [0046](../adr/0046-adaptive-fetch-concurrency-in-the-website-audit.md): adaptive fetch concurrency for the Website Audit. It replaces the fixed numbers of 0043.
- [0047](../adr/0047-every-audit-page-fully-checked.md): every recorded audit page gets the browser checks. Sample Pages no longer limit the Website Audit.
- [0048](../adr/0048-parallel-test-workers-in-the-check-up.md): parallel test workers in the Check-up, and one retry.
- [0049](../adr/0049-improved-version.md): the Improved version, design variants and automatic competitors.

## Waves and chains

Build a wave once every ticket in the waves before it is `built`. Tickets in one chain edit the same files, so build them one after another in wave order. Different chains may be built at the same time.

| Wave | Tickets |
|---|---|
| 1 | T-388, T-411 (baseline first), T-392, T-393, T-394, T-395, T-397, T-398, T-399, T-400 |
| 2 | T-389, T-390, T-401, T-402, T-410 |
| 3 | T-391, T-403, T-409, T-396 |
| 4 | T-404, T-408 |
| 5 | T-405, T-412 |
| 6 | T-406, T-413, T-416, T-417 |
| 7 | T-407, T-414, T-418, T-419 |
| 8 | T-415 |
| 9 | T-420 |

**Chains** (one at a time inside each):
- *Orchestrator:* T-393 → T-389 → T-409 → T-408.
- *Audit crawl:* T-400 → T-401 → T-403 → T-404 → T-405 → T-406 → T-407.
- *Runner server:* T-392 → T-394 → T-402.
- *Improved version:* T-412 → T-413 → T-414 → T-415, and T-416 → T-418.
- *Audit documents:* T-390 → T-417 → T-419 → T-420.
- *Wizard-wide:* T-396 touches many screens. Do not build it beside T-402 or T-412.

**Speed tickets need the baseline.** T-411 records the baseline on `b23682c` before any speed ticket is built. Each speed ticket reruns the benchmark and reports its change.

## Verify first

These review claims were only Inferred. The first step of each ticket below confirms them before any change:
- the count of disabled buttons without a reason (T-396)
- `security-headers.ts` defaults (T-394)
- the egress proxy port and timeout (T-395)
- `redact.ts` patterns (T-395)
- whether exports are translated by labels only (T-420)
- whether the hosted crawl lives inside the 3600 s request (T-407)

## Ticket list

| id | title | priority | size | wave |
|---|---|---|---|---|
| T-388 | Open hosted Website Audits to the owner | P1 | S | 1 |
| T-389 | One count, live and final (`countSummary`) | P1 | M | 2 |
| T-390 | Website Audit counts say findings and rules | P2 | S | 2 |
| T-391 | Every export prints the same count | P2 | S | 3 |
| T-392 | The runner stays up after an unhandled rejection | P1 | S | 1 |
| T-393 | A redaction failure is never silent | P1 | S | 1 |
| T-394 | Runner response headers and access-key comparison | P2 | S | 1 |
| T-395 | Egress proxy limits, key-shaped redaction, robots 5xx | P2 | M | 1 |
| T-396 | Every disabled button says why (W20) | P2 | M | 3 |
| T-397 | Review Safety Filter and Domain Allowlist enforcement | P2 | S | 1 |
| T-398 | The AI Request Budget is a hard stop | P2 | M | 1 |
| T-399 | Docs match the code | P2 | S | 1 |
| T-400 | Sitemap seeding up to the page limit | P1 | S | 1 |
| T-401 | Audit trap limit of 500 per address shape | P2 | S | 2 |
| T-402 | The hosted page cap is shown and applied the same way | P2 | S | 2 |
| T-403 | Adaptive fetch concurrency (ADR 0046) | P1 | M | 3 |
| T-404 | Lab work off the crawl workers | P1 | M | 4 |
| T-405 | Every audit page fully checked (ADR 0047) | P1 | M | 5 |
| T-406 | AI assessment streams with the crawl, in batches | P1 | M | 6 |
| T-407 | Checkpoint and Resume for audits | P1 | L | 7 |
| T-408 | Parallel Check-up test workers (ADR 0048) | P1 | L | 4 |
| T-409 | One retry; video only on the retry | P1 | S | 3 |
| T-410 | One shared Chromium for PDF exports | P3 | S | 2 |
| T-411 | Benchmark harness and baseline | P1 | M | 1 |
| T-412 | The Improved version tab (ADR 0049) | P1 | S | 5 |
| T-413 | Design variants per Layout Group | P1 | L | 6 |
| T-414 | Variant quality gate | P1 | M | 7 |
| T-415 | Before/after, HTML download, exports, Pitch thumbnail | P1 | M | 8 |
| T-416 | Automatic competitors | P2 | L | 6 |
| T-417 | Fix options per finding | P2 | M | 6 |
| T-418 | Competitor examples in the Improved version | P2 | M | 7 |
| T-419 | Copy variants in batches | P2 | M | 7 |
| T-420 | Full AI translation of exports | P2 | M | 9 |

## Out of scope

- Incremental re-runs: skipping unchanged pages from the review's performance plan (P8). It was not in the approved list and can be raised later.
- Mobile web and API checks (ADR 0044).
- Always-on CPU or Cloud Run Jobs for the hosted copy.
