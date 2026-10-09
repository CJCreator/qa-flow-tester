# Tickets

Source: `docs/GAP_ANALYSIS.md`. Status: todo, planned, approved, built, done, blocked. A gap closes only after its wave's /verify-all passes. Human items: [HUMAN_TODO.md](HUMAN_TODO.md). This table is the committed record; `.claude/work/backlog.md` is git-ignored scratch and loses on conflict. New TODOs in code use `TODO(T-nn)` (see CONTRIBUTING.md).

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-01](T-01-full-suite-and-ci.md) | Run and fix the full suite; CI runs every non-browser test | G1, G2 | P0 | S | 0 | blocked | - |
| [T-02](T-02-lint-and-format.md) | ESLint and Prettier configured and runnable | G5 | P0 | S | 0 | done | - |
| [T-03](T-03-dependency-and-secret-scanning.md) | Dependabot, audit, secret scan, coverage figure | G36 | P1 | S | 0 | done | T-01 |
| [T-04](T-04-playwright-version-check.md) | Enforce Playwright version equals Docker image tag | G37 | P2 | S | 0 | done | T-01 |
| [T-05](T-05-docs-and-dead-code-cleanup.md) | Bring docs in line with code; remove dead code | G33, G34 | P0 | S-M | 0 | done | - |
| [T-06](T-06-task-tracking.md) | Make open work trackable in the repo | G39 | P2 | S | 0 | done | - |
| [T-07](T-07-benchmark-automation.md) | Automate the planted-defect benchmark | G3 | P1 | M | 0 | done | T-01 |
| [T-08](T-08-fast-fail-missing-element.md) | Missing element fails fast, not after about 35 s | G7 | P1 | S-M | 1 | done | - |
| [T-09](T-09-retry-duplicate-records.md) | Retried flow on a Test Copy cannot create duplicates | G8 | P1 | M | 1 | done | - |
| [T-10](T-10-slower-than-last-time.md) | "Slower than last time" rule (20% and 300 ms) | G9 | P1 | S | 1 | done | - |
| [T-11](T-11-beta-usage-limits.md) | Per-visitor and daily limits on the hosted beta | G10 | P1 | M | 1 | done | - |
| [T-12](T-12-verified-domains.md) | Verified Domains and hardened isTestHost | G11, G27 (ADR 0014) | P1 | M | 1 | done | - |
| [T-13](T-13-landing-measurement-and-contact.md) | Analytics counter, PNG share image, contact and sign-up | G29, G40, G41, G42 | P1 | S-M | 2 | done | - |
| [T-14](T-14-landing-audit-items.md) | Close remaining landing audit items | G46 | P1 | S-M | 2 | built (sample report regenerated 2026-10-09; owner items remain) | T-13 |
| [T-15](T-15-self-checkup-landing.md) | Run our own check-up on our landing page | G47 | P1 | S | 2 | built | T-13, T-14 |
| [T-16](T-16-findings-contract.md) | Findings contract and its outputs | G12, G27 (ADR 0017) | P2 | M | 3 | done | - |
| [T-17](T-17-playwright-export.md) | Export the approved Plan as Playwright tests | G13 | P2 | M | 3 | built | T-16 (soft) |
| [T-18](T-18-signin-robustness.md) | Sign-in robustness | G17 | P2 | M | 3 | done | - |
| [T-19](T-19-versioned-releases.md) | Version 0.1.0 and a release workflow | G31 | P2 | S | 3 | built | T-01 |
| [T-20](T-20-adr-0016-redaction.md) | ADR 0016: redaction | G27 | P2 | S | 3 | done | - |
| [T-21](T-21-visual-baseline-polish.md) | Visual baseline polish | G15 | P3 | M | 4 | built | - |
| [T-22](T-22-a11y-security-depth.md) | Accessibility and security depth | G16 | P3 | M | 4 | built | - |
| [T-23](T-23-split-large-files.md) | Split large files by area | G35 | P3 | L | 4 | built (23a only) | T-01 |
| [T-24](T-24-suite-failures.md) | Diagnose and fix the 5 failing suite tests | G1 (remaining) | P0 | S-M | 1 | todo | - |

Later (no ticket yet): G6, G14, G18-G22, G23-G26, G45, G48.
