# Documentation index

Read in this order when you are new to the project (people and Claude Code alike).

| Doc                                        | What it answers                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| [`../README.md`](../README.md)             | What the tool is, quick start, running and publishing it                        |
| [`../CONTEXT.md`](../CONTEXT.md)           | The domain glossary. Use these terms exactly, in code, UI text and docs         |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)       | Packages, how a check-up flows through them, where state lives                  |
| [`adr/`](adr/)                             | Why the big decisions were made. Read the relevant one before changing behavior |
| [`TESTING.md`](TESTING.md)                 | Test layout, what to run when, how to add a test                                |
| [`CONFIGURATION.md`](CONFIGURATION.md)     | Every environment variable, port and data folder                                |
| [`API.md`](API.md)                         | The runner's HTTP and event-stream endpoints                                    |
| [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md)       | What is built, what is missing, and in what order to close it                   |
| [`tickets/INDEX.md`](tickets/INDEX.md)     | Open work, one ticket per row; the status column is the committed record        |
| [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md)   | The agent pipeline, the batch loop, and how tokens are kept down                |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)           | Vercel, Render, Docker and GitHub Actions: how code reaches users               |
| [`../SECURITY.md`](../SECURITY.md)         | The safety model, how keys are handled, how to report a vulnerability           |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Branches, commits, pull requests, definition of done                            |
| [`../CHANGELOG.md`](../CHANGELOG.md)       | What changed, release by release                                                |

Product and planning documents that already exist:

- [`PRODUCT_GUIDE.md`](PRODUCT_GUIDE.md): full product specification
- [`E2E_PLATFORM_IMPLEMENTATION_PLAN.md`](E2E_PLATFORM_IMPLEMENTATION_PLAN.md) and [`research/e2e-platform-roadmap.md`](research/e2e-platform-roadmap.md): the end-to-end testing expansion
- [`../URL_FIRST_IMPLEMENTATION_PLAN.md`](../URL_FIRST_IMPLEMENTATION_PLAN.md), [`../UX_IMPLEMENTATION_PLAN.md`](../UX_IMPLEMENTATION_PLAN.md), [`../PRODUCT_REVIEW.md`](../PRODUCT_REVIEW.md)
- [`SEO_AEO_GEO_STRATEGY.md`](SEO_AEO_GEO_STRATEGY.md), [`design/`](design/)

When a doc and the code disagree, the code wins: fix the doc in the same pull request.
