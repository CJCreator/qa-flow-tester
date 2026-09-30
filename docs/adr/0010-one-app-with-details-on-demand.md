# 0010: One App, with Details for Developers on Demand

Partly supersedes [0008](0008-single-local-server.md).

## Context and Decision
ADR 0008 put the Wizard at `/` and QA Flow Studio at `/studio`, as two apps with a link each way. A review of the screens on 2026-09-30 found the split behind much of the friction:
- **Two ways to start a run, with different rules.** The Wizard's runs pause for the Plan Review. Studio's skip it, and starting one deletes any plan waiting for review, because the runner has one run slot.
- **Two verdicts and two sets of severity words.** The Wizard shows a stamp and A–F grades; Studio scores 100 minus 20 per failed test.
- **A hard jump.** Moving between them changes the look, the words and the state, and nothing carries across.
- **Invented data.** Studio opens on made-up runs, a fake product list and a hard-coded Hub status.

We decided that the Wizard is the only app, for everyone:
- Plain language stays on top. Under each finding, a collapsed "Details for developers" holds what engineers used Studio for:
  - the screenshot, steps to reproduce, the page and element, and console errors
  - a bug report and a Playwright test to copy
  - the `qa-test verify` command
- Past check-ups, with filters and search, replace Studio's run archive and report view.
- Accepting findings across runs stays in the Report Hub's own dashboard. When a Hub is connected, the runner passes it on at `/hub`.
- `/studio` redirects to Past check-ups, and `packages/web` is deleted once its useful parts have moved.

We rejected two alternatives:
- **Two apps that behave as one product:** a shared header, verdict, wording and history, with Studio's runs sent through the review. That is still two front ends to maintain for one local server and one run slot.
- **Fixing only the Wizard.** That leaves Studio's invented data, and its run button that skips the review.

## Consequences
- There is one navigation model, one set of words and one verdict, and every run goes through the Plan Review.
- The Wizard grows a developer layer and a report history, which it needed anyway: the runner kept only the latest report.
- Studio's Hub views go. Team history lives in the Hub's own dashboard.
- ADR 0008's single server, port and loopback rules stand. The Docker image builds one UI.
- DESIGN.md's reason for the Wizard's look ("the opposite of Studio on purpose") no longer applies. The Blueprint direction stays on its own merits.
- The work is planned in [UX_IMPLEMENTATION_PLAN.md](../../UX_IMPLEMENTATION_PLAN.md).
