# 0004: Deterministic Structural Fingerprinting for Finding Deduplication

Status: Accepted. The Report Hub this record deduplicates for is retired ([ADR 0005](0005-report-hub-typescript-monorepo-service.md)), so the cross-machine dedupe below was never built. The fingerprint itself is computed (`packages/types/src/fingerprint.ts`) and identifies repeat findings.

## Context and Decision
When multiple developers run flow tests against local dev tunnels, PR previews, or staging environments, identical defects (e.g. failing contrast, broken submit buttons, unhandled API 500s) are detected repeatedly across runs. Duplicating these findings in the Report Hub creates noise and requires manual triage. Conversely, purely string-based error matching is brittle due to dynamic timestamps, session IDs, and port fluctuations.

We decided to deduplicate findings in the Report Hub using a deterministic **Structural Fingerprint** computed at finding creation:
`hash(productId, normalizedRoute, checkerId, ruleCode, targetElementSelector)`

## Deduplication Behavior
- If a finding with an identical fingerprint already exists under the active release target, it links to the existing `Canonical Finding`.
- The `Canonical Finding` increments its occurrence count, updates its `lastSeenAt` and `latestStatus`, and appends the new `Run Finding` as evidence.
- The UI presents a single actionable issue for QA, with a timeline of all runs where it was observed.

## Consequences
- Deduplication is instantaneous, zero-cost, and deterministic (no asynchronous LLM clustering required).
- Transient run attributes (developer machine name, local port, timestamp, random test data) do not cause false duplicate proliferation.
- If an element's selector changes drastically across refactors without data-testid, a new canonical finding may be generated (mitigated by enforcing data-testid locators).
