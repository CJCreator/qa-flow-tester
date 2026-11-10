# T-221: `docs/README.md` indexes every doc that exists

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | docs | todo |

**Files you may edit (no others):**
- `docs/README.md`

**Do not build in parallel with:** T-217 (same file). Build T-217 first: it deletes the snapshot docs and the
`OPEN_ISSUES.md` row.

## Problem
`docs/README.md` is the docs index ("Read in this order when you are new to the project"). Five tracked docs
are missing from it, so a reader never finds them:

- `docs/CONTAINER_DEPLOYMENT.md`
- `docs/LEGAL_AND_LICENSES.md`
- `docs/GTM_AND_PRICING.md`
- `docs/tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md`
- `PRIVACY.md` (repository root)

## Current code
`docs/README.md:5-23` (branch `worktree-audit-cleanup`; after T-217 the `OPEN_ISSUES.md` row is gone)
```markdown
| Doc                                                | What it answers                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`../README.md`](../README.md)                     | What the tool is, quick start, running it                                       |
| [`../CONTEXT.md`](../CONTEXT.md)                   | The domain glossary. Use these terms exactly, in code, UI text and docs         |
| [`PRODUCT_GUIDE.md`](PRODUCT_GUIDE.md)             | What the product does: Check-ups, Website Audits, Plans, verdicts, reports      |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)               | Packages, how a run flows through them, where state lives                       |
| [`adr/`](adr/)                                     | Why the big decisions were made. Read the relevant one before changing behavior |
| [`API.md`](API.md)                                 | The runner's HTTP and event-stream endpoints                                    |
| [`CONFIGURATION.md`](CONFIGURATION.md)             | Every environment variable, port and data folder                                |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                   | How code reaches users: Google Cloud Run, Docker, GitHub Actions                |
| [`TESTING.md`](TESTING.md)                         | Test tiers, what to run when, checking real websites                            |
| [`LANDING_MEASUREMENT.md`](LANDING_MEASUREMENT.md) | The optional landing counter: events, what is sent, how to turn it off          |
| [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md)           | The local agent pipeline (`.claude/`, not part of a clone)                      |
| [`tickets/INDEX.md`](tickets/INDEX.md)             | Open work, one row per ticket. The status column is the record                  |
| [`OPEN_ISSUES.md`](OPEN_ISSUES.md)                 | Known problems not yet fixed, with file locations                               |
| [`findings.schema.json`](findings.schema.json)     | The JSON schema of `findings.json` in a report                                  |
| [`../SECURITY.md`](../SECURITY.md)                 | The safety model, how keys are handled, how to report a vulnerability           |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md)         | Branches, commits, pull requests, definition of done                            |
| [`../CHANGELOG.md`](../CHANGELOG.md)               | What changed, release by release                                                |
```

## Change
1. Add this row directly after the `DEPLOYMENT.md` row:
   ```markdown
   | [`CONTAINER_DEPLOYMENT.md`](CONTAINER_DEPLOYMENT.md) | Running it with Docker Compose, a single container, or Kubernetes |
   ```
2. Add this row directly after the `tickets/INDEX.md` row:
   ```markdown
   | [`tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md`](tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md) | The plan behind the open Website Audit tickets |
   ```
3. Add these two rows directly after the `findings.schema.json` row:
   ```markdown
   | [`LEGAL_AND_LICENSES.md`](LEGAL_AND_LICENSES.md) | The project's licence and the licences of its runtime dependencies |
   | [`GTM_AND_PRICING.md`](GTM_AND_PRICING.md) | Draft notes on audience and pricing. Nothing in it is built or decided |
   ```
4. Add this row directly after the `../SECURITY.md` row:
   ```markdown
   | [`../PRIVACY.md`](../PRIVACY.md) | What the software and the shared online copy store, for a self-hosted copy and for the hosted one |
   ```
5. If the `OPEN_ISSUES.md` row is still present (T-217 not built yet), stop: build T-217 first.

## Tests
```
pnpm exec prettier --write docs/README.md
pnpm format:check
pnpm exec vitest run packages/runner/tests/config-docs.test.ts
```
Every doc must be indexed. This must print nothing:
```
for f in docs/*.md; do b=$(basename "$f"); [ "$b" = "README.md" ] || grep -q "($b)" docs/README.md || echo "not indexed: $b"; done
```

## Done when
- [ ] The five rows are in the table and every link opens a file that exists.
- [ ] The loop above prints nothing.
- [ ] `config-docs.test.ts` passes (it checks every relative link in `docs/README.md`).

## Notes
- Prettier re-aligns the table columns; that is expected.
- The `GTM_AND_PRICING.md` description matches T-225, which marks that doc as a draft.
- `PRIVACY.md` opens: "This policy covers the QA Flow Tester (Release check-up) software and the shared online
  copy of it." The description in step 4 is taken from that.
