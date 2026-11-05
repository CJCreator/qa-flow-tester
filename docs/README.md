# Documentation index

Read in this order when you are new to the project (people and Claude Code alike).

| Doc                                                | What it answers                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`../README.md`](../README.md)                     | What the tool is, quick start, running and publishing it                                                                      |
| [`../CONTEXT.md`](../CONTEXT.md)                   | The domain glossary. Use these terms exactly, in code, UI text and docs                                                       |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)               | Packages, how a check-up flows through them, where state lives                                                                |
| [`adr/`](adr/)                                     | Why the big decisions were made. Read the relevant one before changing behavior. Latest: 0043. 0013 is a Deferred placeholder |
| [`tickets/INDEX.md`](tickets/INDEX.md)             | Open work, one ticket per row; the status column is the committed record                                                      |
| [`TESTING.md`](TESTING.md)                         | Test layout, the two tiers, what to run when, checking real websites, how to add a test                                       |
| [`CONFIGURATION.md`](CONFIGURATION.md)             | Every environment variable, port and data folder                                                                              |
| [`API.md`](API.md)                                 | The runner's HTTP and event-stream endpoints                                                                                  |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                   | Google Cloud Run (runner and static site), Docker and GitHub Actions: how code reaches users                                  |
| [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md)           | The agent pipeline, the batch loop, and how tokens are kept down                                                              |
| [`LANDING_MEASUREMENT.md`](LANDING_MEASUREMENT.md) | The optional landing counter: events, what is sent, how to read it, how to turn it off                                        |
| [`../SECURITY.md`](../SECURITY.md)                 | The safety model, how keys are handled, how to report a vulnerability                                                         |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md)         | Branches, commits, pull requests, definition of done                                                                          |
| [`../CHANGELOG.md`](../CHANGELOG.md)               | What changed, release by release                                                                                              |

Product and roadmap documents, for product questions and long-term work:

- [`PRODUCT_GUIDE.md`](PRODUCT_GUIDE.md): how the product works and how to use it
- [`PRD.md`](PRD.md): requirements baseline (personas, features, non-functional requirements)
- [`E2E_PLATFORM_IMPLEMENTATION_PLAN.md`](E2E_PLATFORM_IMPLEMENTATION_PLAN.md): the phased roadmap to an end-to-end testing platform, with item specs
- [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md): the `G*` gaps the tickets cite
- [`../PRODUCT_REVIEW.md`](../PRODUCT_REVIEW.md): product review
- [`findings.schema.json`](findings.schema.json): the findings contract ([ADR 0017](adr/0017-findings-contract.md))

When a doc and the code disagree, the code wins: fix the doc in the same pull request.
