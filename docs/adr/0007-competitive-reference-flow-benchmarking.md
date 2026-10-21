# 0007: Competitive and Reference Public Flow Benchmarking

Status: Accepted. The benchmark is built (`packages/core/src/competitive`, `packages/runner/src/benchmarks.ts`). Item 4 below (the Hub gallery and the push to the Report Hub) is retired with the Hub ([ADR 0005](0005-report-hub-typescript-monorepo-service.md)).

## Context and Decision
While Phases 1 through 3 focused on internal pre-release quality assurance (functional correctness, Figma design conformance, WCAG accessibility, and multi-developer consolidation), product managers and design leads frequently need to benchmark core user experiences (onboarding wizards, checkout funnels, pricing tiers) against industry leaders and competitors.

We decided to add **Phase 4: Competitive & Reference Public Flow Analysis**, introducing a specialized read-only crawler and multi-dimensional benchmarking engine.

## Architectural Architecture
1. **Safe Interaction Mode**:
   - The crawler explores client-rendered components (interactive tabs, accordions, annual/monthly pricing toggles, step wizards).
   - Deterministic safety filter strictly intercepts and blocks form submit buttons (`input[type="submit"]`, `button[type="submit"]`), outbound links beyond the apex domain, and POST/PUT/DELETE network mutations.
2. **Multi-Dimensional Benchmarking**:
   - Quantifies **Friction Scorecards** (step counts, field density, click depth).
   - Audits **UX Quality & Accessibility** across breakpoints (375px mobile and 1440px desktop).
   - Compares **Interactive Feature Matrices** (SSO providers, toggle patterns, inline validations).
3. **AI UX Gap Analysis & Prioritization**:
   - AI synthesizes friction bottlenecks and drop-off risks.
   - Generates actionable recommendations ranked by effort and impact.
4. **Hub Gallery & CLI Integration**:
   - CLI command `qa-test compare --target <our-url> --reference <competitor-url>` generates local markdown/JSON artifacts and pushes side-by-side journey visual galleries to the Report Hub.

## Consequences
- Product teams can objectively measure flow friction against competitors without third-party SaaS subscriptions.
- Safe interaction prevents accidental spamming, newsletter signups, or unauthorized submissions on third-party domains.
- Enhances the QA tool from a defect-detection utility into a strategic product optimization platform.
