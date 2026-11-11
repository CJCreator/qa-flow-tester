# 0006: Two-Tier Decoupled Design Checker Architecture

## Context and Decision
The Phase 3 specification requires verifying design fidelity against Figma. Directly querying the Figma REST API during every local test run introduces significant problems: rate limits, authentication barriers on developer machines, high test run latency, and failure during offline work. Furthermore, pixel-by-pixel screenshot comparisons fail across Windows, macOS, and Linux due to differing OS font antialiasing and subpixel geometry.

We decided to decouple design checks into a **Two-Tier Architecture**:
1. **Tier 1 (Design Token Conformance)**: The runner extracts live DOM styles via `getComputedStyle()` and deterministically validates them against a version-controlled `design-tokens.json` in the product profile.
2. **Tier 2 (Perceptual Snapshot Diffs)**: Visual regression diffs against approved baseline screenshots using `pixelmatch` with perceptual and anti-aliasing tolerances.
3. **Decoupled Synchronization**: A standalone CLI command (`qa-test figma sync`) fetches fresh tokens and baselines from Figma when designs are updated, keeping local test execution 100% offline and deterministic. The sync command was never built, and its draft module was deleted (T-250); tokens are kept by hand in the product profile.

## Consequences
- Fast, zero-flakiness design validation on local developer machines without requiring Figma API credentials for routine test runs.
- Precise, actionable error reports identifying exact CSS properties and values (e.g. background color `#1E293B` vs expected `#0F172A`) rather than generic visual failure alerts.
- Developers working across macOS, Linux, and Windows get consistent token check results.
