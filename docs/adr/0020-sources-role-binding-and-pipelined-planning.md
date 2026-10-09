# 0020: Sources, Role Binding, Needs-Your-Judgement Findings and Pipelined Planning

Status: Accepted 2026-10-09.

Amends [0009](0009-ai-plans-every-plan-item.md) (sequencing, batching, cost). Builds on [0003](0003-deterministic-safety-filters-for-ai-discovery.md), [0014](0014-verified-domains-and-safe-host-classification.md), [0017](0017-findings-contract.md) and [0018](0018-claim-wording.md).

## Context
The usual input is a URL (or login page) plus credentials for one or more roles, often with no documentation. Role sign-in, the per-role crawl and Product Context parsing already exist. Three gaps remain:
- A Plan Item has no link back to the documentation it came from, so a report can't say "Admin Guide section 4.1".
- Logical-flow problems that only the AI can judge have no honest place in the report.
- Planning waits for the whole crawl, then spends a long time on the AI.

## Decision

### Source on a Plan Item
- A Plan Item gets an optional **Source**: document name, section and Requirement id. No Source means live exploration only. No new noun is added ("test case" stays on the Avoid list).
- The AI Planner proposes which roles each Source applies to. The person confirms or corrects this in Plan Review.
- When a role should not be able to do what a Source describes, the Planner adds a denial Plan Item under the same Source. The report shows allowed and denied roles side by side.
- Product Context accepts several Markdown or text files and a docs URL. PDF and Word are out of scope.
- A Source with no matching feature in the app becomes a Plan Item "Not found in app" with a reason. It does not count as a failure. The report adds "N of M documented items reached".

### Findings
- A Plan Item that differs from its Source reports "Behaviour differs from <Source>" with the Source text and evidence. It never says "bug" as a fact (0018). Default severity is set by the tool and adjusted in Plan Review; the person can mark a doc as stale.
- Logical-flow problems that only the AI judged are Inferred Business Rules. They go in a separate **Needs your judgement** section per role. They do not affect the verdict or grades until the person accepts them.

### The issues document
- Organised by role, then by issue type: UI/UX, Logical flow, Broken flow, Access, Accessibility, Security, Performance.
- Each issue has a title, severity, page, steps to reproduce, evidence and a suggested fix.
- Written as Markdown (extending `report.md` and `fix-these.md`) and as one self-contained printable HTML file with screenshots.
- It opens with "Roles not tested and why".

### Sign-in failure
- If sign-in fails or needs MFA, SSO or a CAPTCHA, that role stops with a plain reason. Other roles and the signed-out visitor still run. The person can supply a saved session for that role.

### Writes
- Create and edit actions run only on a Test Copy (0014). Irreversible actions stay blocked by the Safety Filter (0003). Elsewhere the item is "won't run, and why".

### Pipelined planning (amends 0009)
- The Deterministic Spider and the AI Planner run at the same time. The Spider still gathers all facts alone, and the AI still never drives the browser. 0009's rejection of that stands.
- The Planner plans each Layout Group as its pages are found. Early Plan Items are never rewritten. Pages found later are planned as additions after the crawl ends, and the coverage check fills any gaps.
- Plan Review shows which items were planned while crawling and which were added after.
- This replaces 0009's "one request per Layout Group" with "requests per group as pages arrive, plus follow-up additions".

### AI budget and speed (amends 0009 Consequences)
- The AI Request Budget is what the key reports it has left today. No provider tier numbers are fixed in the product.
- Pacing and concurrency follow the provider's reported rate limit. A paid key plans several groups at once. A free key stays slow and sequential.
- An optional cap per Check-up (requests or dollars) is shown on the new check-up screen as "estimated vs cap".
- Items beyond the budget or cap use the Fixed-Rule Fallback, as before.

## Alternatives rejected
- **An AI agent driving its own browser in parallel.** Same reasons as 0009 (slow, costly, unpredictable on free models). Revisit only as a separate decision after cost and reliability are measured.
- **Wait until a group looks complete before planning it.** Smaller speed-up on sites with one large group.
- **Re-plan a group when it grows.** Can double cost and changes the Plan after the crawl ends.
- **Role set only at Check-up start.** A Viewer run would report "create user" as failing when it should be blocked.
- **Docs declare roles in a fixed convention.** Forces people to reformat their docs.
- **Report doc mismatches as bugs.** Stale docs would produce false bugs.
- **Hard-coded budgets per key tier.** Goes stale when providers change limits.

## Consequences
- `review-plan.ts` gains Source and a planned-while-crawling flag; this is a shared type change, so run `pnpm build`.
- The Discovery Agent runs the Spider and Planner together instead of in sequence.
- `PacedAI` needs concurrency that follows provider limits instead of a fixed pace.
- The report writer gains the role-then-type layout, the HTML output and the judgement section.
- Open fact for planning: confirm that a saved session (`storageState`) can be supplied per role in `credentials.ts` and `browser.ts`.
