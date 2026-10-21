# Documentation index

Read in this order when you are new to the project (people and Claude Code alike).

| Doc                                                           | What it answers                                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../README.md`](../README.md)                                | What the tool is, quick start, running and publishing it                                                                                           |
| [`../CONTEXT.md`](../CONTEXT.md)                              | The domain glossary. Use these terms exactly, in code, UI text and docs                                                                            |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                          | Packages, how a check-up flows through them, where state lives                                                                                     |
| [`adr/`](adr/)                                                | Why the big decisions were made. Read the relevant one before changing behavior (note: 0013 and 0015 are Deferred placeholders, no decision made) |
| [`adr/0031-...`](adr/0031-every-outbound-request-uses-pinned-resolver.md) | Latest ADR (0031): every outbound request uses the pinned, redirect-checked resolver (accepted)                                                    |
| [`DEMO.md`](DEMO.md)                                          | The presenter script: setup, the golden path with the on-screen labels, the form journey and what to expect on each fixture page                   |
| [`TESTING.md`](TESTING.md)                                    | Test layout, what to run when, how to add a test                                                                                                   |
| [`CONFIGURATION.md`](CONFIGURATION.md)                        | Every environment variable, port and data folder                                                                                                   |
| [`LANDING_MEASUREMENT.md`](LANDING_MEASUREMENT.md)            | The optional landing counter: events, what is sent, how to read it, how to turn it off                                                             |
| [`API.md`](API.md)                                            | The runner's HTTP and event-stream endpoints                                                                                                       |
| [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md)                          | What is built, what is missing, and in what order to close it                                                                                      |
| [`tickets/INDEX.md`](tickets/INDEX.md)                        | Open work, one ticket per row; the status column is the committed record                                                                           |
| [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md)                      | The agent pipeline, the batch loop, and how tokens are kept down                                                                                   |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                              | Vercel, Render, Docker and GitHub Actions: how code reaches users                                                                                  |
| [`../SECURITY.md`](../SECURITY.md)                            | The safety model, how keys are handled, how to report a vulnerability                                                                              |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md)                    | Branches, commits, pull requests, definition of done                                                                                               |
| [`../CHANGELOG.md`](../CHANGELOG.md)                          | What changed, release by release                                                                                                                   |

Product and planning documents that already exist:

- [`PRD.md`](PRD.md): Product Requirements Document (baseline requirements, personas, features, architecture, and roadmap)
- [`PRODUCT_GUIDE.md`](PRODUCT_GUIDE.md): full product specification
- [`E2E_PLATFORM_IMPLEMENTATION_PLAN.md`](E2E_PLATFORM_IMPLEMENTATION_PLAN.md) and [`research/e2e-platform-roadmap.md`](research/e2e-platform-roadmap.md): the end-to-end testing expansion
- [`../PRODUCT_REVIEW.md`](../PRODUCT_REVIEW.md): product review and gap analysis
- [`SEO_AEO_GEO_STRATEGY.md`](SEO_AEO_GEO_STRATEGY.md)

When a doc and the code disagree, the code wins: fix the doc in the same pull request.
