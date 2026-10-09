# 0009: The AI Plans Every Plan Item from the Crawl's Facts

Supersedes [0001](0001-hybrid-ai-discovery.md). Amended by [0020](0020-sources-role-binding-and-pipelined-planning.md) (sequencing, batching, cost).

## Context and Decision
ADR 0001 used the AI selectively to save tokens:
- One prompt asked it for 3 to 5 journeys.
- Fixed rules handled page visits and checks, and none of it was shown in the plan review.

On real sites this produced one-page plans with near-identical journeys, and the review showed only part of what ran.

We decided that the Deterministic Spider gathers the facts and the AI Planner writes every Plan Item from them.
- **The facts** are every page, the links between pages, and each page's buttons and forms. They are gathered for each role, plus one phone-width look per Layout Group.
- **The Plan Items** are page visits, Navigation Checks, journeys and checks.
- **Batching:** there is one request per Layout Group (or per bundle of small pages), one for the shared menus and one for the journeys.
- **Checking:** code checks the AI's output. Every page and link must have an item, every selector must exist, and Sensitive Actions stay blocked. Gaps go back to the AI.
- **Fallback:** anything still unplanned uses the Fixed-Rule Fallback, which is always labeled.
- **Key:** a wizard scan needs a working AI key.
- **Scope of the Plan:** the Plan is exactly what runs.

We rejected two alternatives:
- **The AI driving the browser.** It is slow, costly, and unpredictable with free models.
- **Keeping page visits and links rule-based.** Then the plan wouldn't be AI-planned.

## Consequences
- A Plan costs more AI requests. A 30-page site takes about 8 to 12, and OpenRouter's free tier allows 50 a day until 10 credits are bought.
  - The AI Request Budget is shown before planning.
  - Requests are paced under 20 a minute, and rate limits are retried.
  - Repeat runs reuse the approved Plan and plan only what changed.
- The plan review can show everything, because everything that runs is a Plan Item.
- The fixed page sweep and fixed journeys remain only as the Fixed-Rule Fallback.
- Plan quality now depends on the AI. The coverage check guarantees completeness, but not good judgement, so the person still reviews the Plan before it runs.
