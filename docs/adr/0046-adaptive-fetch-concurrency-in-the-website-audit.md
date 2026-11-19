# 0046: Adaptive Fetch Concurrency in the Website Audit

Status: Proposed, 2026-11-19 (owner's answers in a grilling session, 2026-11-19; technical sign-off item 6). Supersedes the fixed numbers of [0043](0043-parallel-page-fetching-in-the-website-audit.md): 3 in flight and the spider's ceiling of 5 workers. The back-off rules of 0043 stay.

## Context
- The owner wants a 5,000-page site fully tested in under 2 hours on the local runner, which is about one page every 1.4 s.
- Today the audit allows 3 pages in flight with a 500 ms gap (`audit/crawl/crawl.ts:52,69`). The Deterministic Spider clamps its workers to 5 (`discovery/deterministic-spider.ts:411`).
- The owner also wants the tool to be polite to sites that are not theirs.

## Decision
- Concurrency starts at 3. It rises by 1 after every 25 pages answered with no 429, 503 or Retry-After, up to a ceiling:
  - **local runner:** 8;
  - **hosted copy:** 3 (1 CPU, 2 GiB).
- The start rate never exceeds **2 pages per second** for one host, so the 500 ms gap stays as a floor.
- Back-off is unchanged from 0043. A robots Crawl-delay means 1 page in flight with that gap, for the whole audit. A 429 or 503 drops to 1 page in flight and the adaptive climb stops for the rest of the audit.
- The spider's worker clamp becomes an option, passed from the pacer's ceiling.
- The Check-up's pacing is unchanged (0015).

## Consequences
- An audit of a healthy site speeds up as it goes; a fragile site gets no more load than today.
- Memory and CPU on the local runner bound the ceiling. T-411's benchmark checks peak RSS at 8.
- More pages in flight make a block (Interstitial Page, ADR 0042) more likely. A block found mid-run drops to 1 in flight.
