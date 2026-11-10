# Documentation

Read in this order when you are new to the project.

| Doc                                                                                      | What it answers                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`../README.md`](../README.md)                                                           | What the tool is, quick start, running it                                                         |
| [`../CONTEXT.md`](../CONTEXT.md)                                                         | The domain glossary. Use these terms exactly, in code, UI text and docs                           |
| [`PRODUCT_GUIDE.md`](PRODUCT_GUIDE.md)                                                   | What the product does: Check-ups, Website Audits, Plans, verdicts, reports                        |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                                                     | Packages, how a run flows through them, where state lives                                         |
| [`adr/`](adr/)                                                                           | Why the big decisions were made. Read the relevant one before changing behavior                   |
| [`API.md`](API.md)                                                                       | The runner's HTTP and event-stream endpoints                                                      |
| [`CONFIGURATION.md`](CONFIGURATION.md)                                                   | Every environment variable, port and data folder                                                  |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                                                         | How code reaches users: Google Cloud Run, Docker, GitHub Actions                                  |
| [`CONTAINER_DEPLOYMENT.md`](CONTAINER_DEPLOYMENT.md)                                     | Running it with Docker Compose, a single container, or Kubernetes                                 |
| [`TESTING.md`](TESTING.md)                                                               | Test tiers, what to run when, checking real websites                                              |
| [`LANDING_MEASUREMENT.md`](LANDING_MEASUREMENT.md)                                       | The optional landing counter: events, what is sent, how to turn it off                            |
| [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md)                                                 | The local agent pipeline (`.claude/`, not part of a clone)                                        |
| [`tickets/INDEX.md`](tickets/INDEX.md)                                                   | Open work, one row per ticket. The status column is the record                                    |
| [`tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md`](tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md) | The plan behind the open Website Audit tickets                                                    |
| [`findings.schema.json`](findings.schema.json)                                           | The JSON schema of `findings.json` in a report                                                    |
| [`LEGAL_AND_LICENSES.md`](LEGAL_AND_LICENSES.md)                                         | The project's licence and the licences of its runtime dependencies                                |
| [`GTM_AND_PRICING.md`](GTM_AND_PRICING.md)                                               | Draft notes on audience and pricing. Nothing in it is built or decided                            |
| [`../SECURITY.md`](../SECURITY.md)                                                       | The safety model, how keys are handled, how to report a vulnerability                             |
| [`../PRIVACY.md`](../PRIVACY.md)                                                         | What the software and the shared online copy store, for a self-hosted copy and for the hosted one |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md)                                               | Branches, commits, pull requests, definition of done                                              |
| [`../CHANGELOG.md`](../CHANGELOG.md)                                                     | What changed, release by release                                                                  |

When a doc and the code disagree, the code wins: fix the doc in the same pull request.
