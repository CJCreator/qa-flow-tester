# Documentation index

Read in this order when you are new to the project (people and Claude Code alike).

| Doc                                                                       | What it answers                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../README.md`](../README.md)                                            | What the tool is, quick start, running and publishing it                                                                                                                                    |
| [`../CONTEXT.md`](../CONTEXT.md)                                          | The domain glossary. Use these terms exactly, in code, UI text and docs                                                                                                                     |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                                      | Packages, how a check-up flows through them, where state lives                                                                                                                              |
| [`adr/`](adr/)                                                            | Why the big decisions were made. Read the relevant one before changing behavior. [`adr/README.md`](adr/README.md) lists all 43 with status (0013 is Deferred; 0001 and 0005 are superseded) |
| [`adr/0031-...`](adr/0031-every-outbound-request-uses-pinned-resolver.md) | Latest ADR (0031): every outbound request uses the pinned, redirect-checked resolver (accepted)                                                                                             |
| [`adr/0041-...`](adr/0041-two-area-navigation.md)                         | ADR 0041: two-area navigation, Check-ups and Website Audits, each with its own row (accepted)                                                                                               |
| [`adr/0043-...`](adr/0043-parallel-page-fetching-in-the-website-audit.md) | Latest ADR (0043): parallel page fetching in the Website Audit; 0042: Website Audit reliability and access (accepted)                                                                       |
| [`TESTING.md`](TESTING.md)                                                | Test layout, the two tiers, what to run when, checking real websites, how to add a test                                                                                                     |
| [`CONFIGURATION.md`](CONFIGURATION.md)                                    | Every environment variable, port and data folder                                                                                                                                            |
| [`LANDING_MEASUREMENT.md`](LANDING_MEASUREMENT.md)                        | The optional landing counter: events, what is sent, how to read it, how to turn it off                                                                                                      |
| [`API.md`](API.md)                                                        | The runner's HTTP and event-stream endpoints                                                                                                                                                |
| [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md)                                      | What is built, what is missing, and in what order to close it                                                                                                                               |
| [`tickets/INDEX.md`](tickets/INDEX.md)                                    | Open work, one ticket per row; the status column is the committed record                                                                                                                    |
| [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md)                                  | The agent pipeline, the batch loop, and how tokens are kept down                                                                                                                            |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                                          | Google Cloud Run (runner and static site), Docker and GitHub Actions: how code reaches users                                                                                                |
| [`../SECURITY.md`](../SECURITY.md)                                        | The safety model, how keys are handled, how to report a vulnerability                                                                                                                       |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md)                                | Branches, commits, pull requests, definition of done                                                                                                                                        |
| [`../CHANGELOG.md`](../CHANGELOG.md)                                      | What changed, release by release                                                                                                                                                            |

Product and planning documents that already exist:

- [`PRD.md`](PRD.md): Product Requirements Document (baseline requirements, personas, features, architecture, and roadmap)
- [`PRODUCT_GUIDE.md`](PRODUCT_GUIDE.md): full product specification
- [`E2E_PLATFORM_IMPLEMENTATION_PLAN.md`](E2E_PLATFORM_IMPLEMENTATION_PLAN.md) and [`research/e2e-platform-roadmap.md`](research/e2e-platform-roadmap.md): the end-to-end testing expansion
- [`../PRODUCT_REVIEW.md`](../PRODUCT_REVIEW.md): product review (issues and the fix-first table); the resolution of each item is in [`archive/PRODUCT_REVIEW_RESOLUTION.md`](archive/PRODUCT_REVIEW_RESOLUTION.md)
- [`SEO_AEO_GEO_STRATEGY.md`](SEO_AEO_GEO_STRATEGY.md)

When a doc and the code disagree, the code wins: fix the doc in the same pull request.
