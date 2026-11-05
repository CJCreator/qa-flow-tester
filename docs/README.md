# Documentation

Read in this order when you are new to the project.

| Doc | What it answers |
|---|---|
| [`../README.md`](../README.md) | What the tool is, quick start, running it |
| [`../CONTEXT.md`](../CONTEXT.md) | The domain glossary. Use these terms exactly, in code, UI text and docs |
| [`PRODUCT_GUIDE.md`](PRODUCT_GUIDE.md) | What the product does: Check-ups, Website Audits, Plans, verdicts, reports |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Packages, how a run flows through them, where state lives |
| [`adr/`](adr/) | Why the big decisions were made. Read the relevant one before changing behavior |
| [`API.md`](API.md) | The runner's HTTP and event-stream endpoints |
| [`CONFIGURATION.md`](CONFIGURATION.md) | Every environment variable, port and data folder |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | How code reaches users: Google Cloud Run, Docker, GitHub Actions |
| [`TESTING.md`](TESTING.md) | Test tiers, what to run when, checking real websites |
| [`LANDING_MEASUREMENT.md`](LANDING_MEASUREMENT.md) | The optional landing counter: events, what is sent, how to turn it off |
| [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md) | The local agent pipeline (`.claude/`, not part of a clone) |
| [`tickets/INDEX.md`](tickets/INDEX.md) | Open work, one row per ticket. The status column is the record |
| [`OPEN_ISSUES.md`](OPEN_ISSUES.md) | Known problems not yet fixed, with file locations |
| [`findings.schema.json`](findings.schema.json) | The JSON schema of `findings.json` in a report |
| [`../SECURITY.md`](../SECURITY.md) | The safety model, how keys are handled, how to report a vulnerability |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Branches, commits, pull requests, definition of done |
| [`../CHANGELOG.md`](../CHANGELOG.md) | What changed, release by release |

When a doc and the code disagree, the code wins: fix the doc in the same pull request.
