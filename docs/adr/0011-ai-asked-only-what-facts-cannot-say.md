# 0011: The AI Is Asked Only What the Crawl's Facts Can't Say

Amends [0009](0009-ai-plans-every-plan-item.md).

## Context and Decision
The product review of 2026-09-30 (findings T1–T3; the review file was removed in 2026-11 and is in git history) found that free AI models rarely produced a usable plan:
- The chosen free model spent its whole 4,096-token answer allowance on hidden reasoning and answered nothing. The planner read that as bad JSON and asked again with the same allowance, which failed the same way.
- Most of what the AI was asked to write, fixed rules already wrote as well: a name and an expectation for every link on every page.
- Token use wasn't recorded, so the plan blamed the AI Request Budget for what was really truncation.

We decided:
- **Navigation Checks are named from the facts.** A check's name comes from the link's text and where it goes. When the crawl saw the destination, its title is the expectation. The AI is asked only about links to pages the crawl didn't open, and leaving one out isn't a reason to ask again.
- **A cut-off answer isn't repaired.** When the model stops because of its answer allowance, the items are planned by fixed rules and labelled with that reason.
- **Reasoning is kept short and out of the answer.** Planning requests ask OpenRouter for low-effort, excluded reasoning and allow 8,192 answer tokens.
- **Models earn their place.** The runner keeps a record of each model's answers on this computer. A model that stops before answering more often than it answers is picked last. During a scan, a model that answers nothing is replaced by the next one. A model the person chose in Settings is kept.
- **Every count comes from the Plan Items.** Each fixed-rule item records why fixed rules planned it: the budget, truncation, no answer, an unusable answer, no AI, or a stopped scan. The plan's notes and its approval summary count the same items.
- **Tokens are recorded** per stage (planning, repair, journeys, visual review) in the plan and the report.

## Consequences
- A plan needs fewer AI requests: typically one per three tested pages, plus the journeys. The shared menus need a request only when they link to pages the crawl didn't see.
- A Navigation Check planned from the facts isn't labelled "Fixed rules": it needs no AI. It is labelled that way only when there's no AI at all, or when the AI was to be asked about it and couldn't be.
- Link checks run at one screen size, plus the sizes where a menu button must be opened to reach them.
- The plan's notes name the real cause and the fix ("Choose another model in Settings").
