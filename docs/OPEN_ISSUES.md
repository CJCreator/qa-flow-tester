# Open issues

Problems from the security, app and performance reviews and the gap analysis that are still present in the code at HEAD.

All engineering, security, correctness, reliability, performance, wizard, legal, documentation, and product gaps (S1–S12, C1–C9, R1–R10, M1–M9, D3–D8, W1–W20, PERF-1–PERF-5, LAT-1–LAT-14, DOC-1–DOC-4, and G3–G48) have been systematically resolved and verified.

## Resolved Product & Roadmap Gaps

| ID                     | Issue & Problem                                            | Resolution Summary                                                                                                                                   | Status    |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **G3**                 | Planted-defect benchmark automation                        | Superseded and resolved per accepted ADR 0040. Fabricated test sites dropped in favor of deterministic evaluation on real websites.                  | ✅ Closed |
| **G4, G47**            | 15-minute $0 verdict & self-audit of landing page          | Conducted and documented in `docs/SELF_AUDIT.md` (clean release verdict on `qa-check-up-site`) and `docs/VERIFICATION_JOURNEY.md` (3m 42s at $0.00). | ✅ Closed |
| **G6**                 | AI plan quality baseline                                   | Implemented automated deterministic baseline test suite in `packages/core/tests/plan-quality-baseline.test.ts`.                                      | ✅ Closed |
| **G14, G19, G22**      | API traffic intel, selective rerun, self-healing selectors | Implemented `packages/core/src/network-intel.ts`, `self-healing.ts` (ADR 0013), and `rerunTestCaseIds` in `orchestrator.ts`.                         | ✅ Closed |
| **G16**                | CrUX (field data) panel                                    | Integrated Chrome UX Report 75th percentile LCP, INP, CLS field metrics in `packages/checkers/src/performance.ts` (ADR 0035).                        | ✅ Closed |
| **G18**                | Android Chrome run option                                  | Added `android-chrome` engine profile in `packages/core/src/browser.ts` and `templates/qa-check.yml`.                                                | ✅ Closed |
| **G20**                | A11y checklist/statement & Consent/GPC check               | Added WCAG accessibility statement check and GPC behavior verification in `packages/checkers/src/marketing.ts`.                                      | ✅ Closed |
| **G21**                | TLS/DNS checks, SARIF export, OpenAPI spec calls           | Implemented `packages/core/src/sarif-export.ts` (OASIS SARIF v2.1.0) and TLS security enforcement in `packages/checkers/src/security-depth.ts`.      | ✅ Closed |
| **G23–G26**            | Mobile/desktop expansion roadmap                           | Formalized architectural boundaries in `docs/adr/0044-expansion-platform-scope-and-roadmap.md` (Maestro, public API, desktop).                       | ✅ Closed |
| **G28, G30, G43, G44** | User research, GTM plan, transparent pricing               | Authored `docs/GTM_AND_PRICING.md` and added transparent Community ($0), Pro ($49/mo), and Team ($199/mo) tiers to `LandingScreen.tsx`.              | ✅ Closed |
| **G31**                | Versioned release container publication                    | Upgraded `.github/workflows/release.yml` with automated container builds and publication to GitHub Container Registry.                               | ✅ Closed |
| **G32**                | Dependency license compatibility audit                     | Authored `docs/LEGAL_AND_LICENSES.md` auditing `axe-core` MPL-2.0 and Playwright Apache-2.0 compatibility with FSL-1.1-MIT.                          | ✅ Closed |
| **G35 (T-23)**         | Large file modularization                                  | Extracted route controllers to `packages/runner/src/routes/health.ts` and modularized handlers. Marked T-23 done in `docs/tickets/INDEX.md`.         | ✅ Closed |
| **G38**                | Key rotation verification                                  | Formally confirmed key revocation and rotation in `SECURITY.md` with zero active leaks.                                                              | ✅ Closed |
| **G45**                | Public docs, changelog, and case study routes              | Added `/docs`, `/changelog`, and `/case-studies` to public indexing paths in `packages/runner/src/ui-static.ts`.                                     | ✅ Closed |
| **G46**                | Landing audit re-check                                     | Verified Lighthouse pass, dark/light theme switch, above-the-fold layout, and documented in `docs/LANDING_AUDIT_REPORT.md`.                          | ✅ Closed |
| **G48**                | Enhanced marketing checker                                 | Added social card completeness, UTM preservation, and accessibility statement checks in `packages/checkers/src/marketing.ts`.                        | ✅ Closed |

There are no remaining open issues. The repository is production-ready.
