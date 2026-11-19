# 0047: Every Recorded Page of a Website Audit Is Fully Checked

Status: Accepted, 2026-11-19 (built: see docs/tickets/INDEX.md). Proposed 2026-11-19 (owner's answer in a grilling session, 2026-11-19: "every page fully tested"; technical sign-off item 3). Changes the Website Audit rule in `docs/PRODUCT_GUIDE.md` that browser checks run only on Sample Pages. Sample Pages keep their meaning in the Check-up (Plan Items) and for the Improved version (one page per Layout Group, ADR 0049).

## Context
- Today only Sample Pages (3 per Layout Group, `plan/sampling.ts:5`) get the axe scan, the lab timing reload and the phone-layout screenshot (`audit/pipeline/page-recorder.ts`).
- The owner wants every issue listed, on every page.

## Decision
- Every recorded page gets:
  - Page Content (as today);
  - the axe scan;
  - the phone-layout screenshot;
  - lab timing.
- Lab work runs on its own queue, separate from the crawl workers (T-404), so fetching is not blocked.
- PageSpeed Insights stays at 20 pages (`PSI_MAX_PAGES`). Those pages skip the browser timing reload. Other pages use browser timing.
- Findings from many pages with one rule still group into one problem for grades (`grades.ts`, `issueKey: rule`). Counts show both numbers (T-390).
- Wording stays per page: what was seen on which page, never a claim about the whole site (ADR 0018).

## Consequences
- Audits do several times more browser work. The speed tickets (T-403, T-404, T-406) pay for it, and T-411 measures it.
- Large audits on the hosted copy stay capped at 200 pages.
- Storage grows by one phone screenshot per page. The store keeps file paths, not images in memory.
