# Gap analysis: intended use vs what exists

_Written 2026-10-07 from the plans (`docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md`, `docs/research/e2e-platform-roadmap.md`,
`URL_FIRST_IMPLEMENTATION_PLAN.md`, `UX_IMPLEMENTATION_PLAN.md`, `PRODUCT_REVIEW.md`) checked against the code in `packages/`.
"Not found" means a search of `packages/*/src`, `scripts`, `templates` and `.github` found no trace. I could not run the test
suite or the app (see G1), so "built" means the code exists, not that it passes._

## Intended use

A small team that is about to release a website pastes an address (or points its CI at a preview URL) and gets, with nothing to install:
a readable Plan it can change, a run with a real browser, and one honest verdict, "Ready to release" or "Not yet", with A to F grades for six areas,
ranked fixes, and evidence. Plain words on top, developer detail underneath. Deterministic results; AI plans but never judges. Free to host.
Longer term: grow into an end-to-end platform (API, mobile web, phone apps).

## What is built (code exists)

| Area                   | State                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and planning | Spider, AI Planner with fixed-rule fallback, Layout Groups, safety filters, Plan Review (edit, re-plan, approve, add sign-in)                                                         |
| Checks                 | Bug detection, accessibility (axe, WCAG 2.2 wording), performance (real LCP/CLS/INP, repeat runs), security, SEO, AEO, GEO, design/UX, marketing, permission matrix, spec conformance |
| Judgement              | Deterministic grades and release verdict with strict/standard/lenient gates; grouped problems; "not a problem / intended" triage; AI guesses never count until confirmed              |
| Reports                | Self-contained `report.html`, `report.md`, `findings.json`; past check-ups; "Test again"; per-site memory and history; visual review; baselines screen                                |
| UI                     | One wizard: landing, new check-up, scanning, Plan Review, testing, report, past check-ups, settings, benchmark, visibility, visual baselines; phone layouts                           |
| Delivery               | One-shot CI command (`checkup.ts`) with `--fail-on` exit code and job summary; generated GitHub Actions workflow; Vercel front end; Render beta; Docker image; deploy workflow        |
| Safety                 | Read-only default, test-copy switch, host confinement, redaction, beta sessions in memory, access token, loopback host check                                                          |
| Docs and agents        | ADRs 0001-0012, 0018; glossary; the docs and agent pipeline added today                                                                                                               |

Plan status per the docs: Phase 0 (stop misleading people) code complete; Phase 1 (free hosting) code complete; UX plan phases 1-3 built;
product review T/F/L/U/P items all addressed (Oct 1). **Phases 2 to 7 of the end-to-end plan: not started** (confirmed by code search, G18 to G27).

## Gaps

Priority: **P0** do before building more; **P1** needed for the intended use; **P2** adoption; **P3** depth; **P4** expansion.
Size: S = a day or two, M = about a week, L = several weeks (the plan's scale).

### A. Confidence in what exists (P0)

| ID  | Gap                                                                                                                                                                                                                           | Evidence                                                                                     | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---- |
| G1  | **Closed (2b59db1, verified 2026-10-09).** Test suite status unknown. Phase 0's exit gate "`pnpm test` is green" is unchecked: the full suite was not re-run after the last changes                                           | E2E plan, Phase 0 exit gate. My shell could not run it (Windows `node_modules`, no `pnpm`)   | S    |
| G2  | CI runs only a slice. Pull-request CI and the deploy test job run `packages/wizard` plus two runner tests. No checkers, core, types or other runner tests, and no `wizard-e2e`                                                | `.github/workflows/ci.yml`, `deploy.yml`                                                     | S    |
| G3  | Benchmark (planted defects and false-positive rate) is not automated; Swag Labs and TodoMVC were never re-run after Phase 0                                                                                                   | E2E plan, Phase 0 gate; `scripts/benchmark.ts`                                               | M    |
| G4  | Phase 1 exit gate never proven: new user to verdict in under 15 minutes, private preview URL, $0 with no card. Actions minutes and memory of a full check-up not recorded; whether Chromium fits Render's 512 MB not recorded | E2E plan, "Phase 1: open items" (may be stale: deploy workflow suggests the sites now exist) | S-M  |
| G5  | **Closed (7130d22, verified 2026-10-09).** No lint or format setup. `pnpm lint` runs ESLint, which is not installed or configured; no Prettier config                                                                         | `package.json`, repo root                                                                    | S    |
| G6  | AI plan quality depends on free models. Journeys were the weak spot in the last live check; plan quality with no key, or with other providers, is not measured against a baseline                                             | `PRODUCT_REVIEW.md` Resolution                                                               | M    |

### B. Known defects and unbuilt promises in shipped phases (P1)

| ID  | Gap                                                                                                                                                                                                           | Evidence                                                    | Size |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---- |
| G7  | **Closed (2b59db1, verified 2026-10-09).** A step whose element is missing waits about 35 s per try (fallback chain), so a failing flow plus its retry is very slow                                           | E2E plan "Known gaps"                                       | S-M  |
| G8  | **Closed (2b59db1, verified 2026-10-09).** A retried flow on a Test Copy can send a form twice and create duplicate records. Needs namespaced test data                                                       | E2E plan "Known gaps"; only `entity-namespacing.ts` exists  | M    |
| G9  | **Closed (2b59db1, verified 2026-10-09).** "Slower than last time" rule (20% and 300 ms) decided, not built                                                                                                   | `slower than last` not found                                | S    |
| G10 | **Closed (2b59db1, verified 2026-10-09).** Hosted beta has no per-visitor usage or daily limits; only a 50-session cap, 24 h life. Plan row 21 calls for a daily limit and a second host                      | `runner/src/beta.ts`; no rate/quota code found              | M    |
| G11 | **Closed (2b59db1, verified 2026-10-09).** Verified Domains and hardened `isTestHost` (DNS resolution, SSRF and private-IP checks, shared machines) not built. Required before any wider hosted use or Probes | `verified domain` not found; `isTestHost` in `live-site.ts` | M    |

### C. Product features in the plan, not built

| ID  | Gap (plan item)                                                                                                                                                                                                                                                               | P   | Size   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ |
| G12 | **Closed (2b59db1, verified 2026-10-09).** **Findings contract** (1.1): `schemaVersion`, published JSON Schema, fingerprint in `findings.json`, per-finding briefs, `fix-these.md`, `known-findings.json`, AGENTS.md snippet, GitHub annotations, trend strip, release record | P2  | M      |
| G13 | **Closed (2b59db1, verified 2026-10-09).** **Playwright export** of the approved Plan (1.2): runs with `npx playwright test`, per-role storage state. The "no lock-in" promise                                                                                                | P2  | M      |
| G14 | **API traffic intelligence** (1.3): capture with redaction, shapes, hidden errors, slow endpoints, drift, role replay; GraphQL-on-live-sites decision (ADR 0015)                                                                                                              | P3  | L      |
| G15 | **Visual baseline polish** (1.4): approve flow and screen exist; page stabilising and automatic masking of dates and ads not found in core; old/new/diff in the HTML report to confirm                                                                                        | P3  | M      |
| G16 | **Accessibility and security depth** (1.5): keyboard traversal, focus-obscured and trap checks, 320 px reflow, CrUX panel, SRI, source maps, `security.txt`, fuller CSP                                                                                                       | P3  | M      |
| G17 | **Closed (2b59db1, verified 2026-10-09).** **Sign-in robustness** (1.6): test-sign-in button, two-step and modal login, four named failure reasons. Sign-in on the form exists                                                                                                | P2  | M      |
| G18 | **WebKit and Firefox** pass on Sample Pages, labelled "WebKit (Playwright build)"; **Android Chrome** in the user's CI (2.1, 2.2)                                                                                                                                             | P3  | M+M    |
| G19 | Re-run only what failed or changed (3.2)                                                                                                                                                                                                                                      | P3  | M      |
| G20 | Accessibility checklist and draft statement (3.4); consent and GPC check (3.5)                                                                                                                                                                                                | P3  | M      |
| G21 | TLS and mail DNS checks (3.6); OpenAPI check and draft export (3.7); SARIF export (3.8)                                                                                                                                                                                       | P3  | M each |
| G22 | Self-healing selectors with human approval (3.1)                                                                                                                                                                                                                              | P3  | M      |
| G23 | Controlled Security Probes on verified test copies (3.9). Needs G11, ADR 0014 and legal review. May be cut                                                                                                                                                                    | P4  | L      |
| G24 | Phone apps via Maestro (4.1 to 4.4)                                                                                                                                                                                                                                           | P4  | L      |
| G25 | Public API as its own App (5.1)                                                                                                                                                                                                                                               | P4  | M      |
| G26 | Desktop via Electron (5.2), only when asked                                                                                                                                                                                                                                   | P4  | L      |
| G27 | ADRs the plan needs: 0014 (verified domains) and 0016 (redaction) are written; 0013 (self-healing), 0015 (GraphQL), 0017 (findings contract) are not                                                                                                                          | P2  | S each |

### D. Users, adoption and business (P1-P2)

| ID  | Gap                                                                                                                                                                                                               | Evidence                                         | Size          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------- |
| G28 | **Gate G1 (user conversations) not done.** No note in `docs/research/`. Phase 4 and the whole "signed-in" direction depend on it, and Phase 1's assumption that users have and want GitHub Actions is untested    | `ls docs/research`                               | calendar time |
| G29 | No documented way to measure adoption, drop-off or feedback (no usage metrics, feedback channel, or success criteria)                                                                                             | not found in docs or code                        | S-M           |
| G30 | No revenue or pricing model. Hosting is "$0 until revenue", the FSL licence signals commercial intent, but nothing says what is sold, to whom, or when                                                            | `ADR 0012`, `LICENSE`; no pricing doc            | M (thinking)  |
| G31 | No versioned releases. No git tags, version 0.1.0, no published image or package; the generated workflow fetches the tool from a ref placeholder (`__QA_TOOL_REF__`), so users track whatever the ref resolves to | `git tag` empty; `templates/qa-check.yml`        | S             |
| G32 | Repo visibility and dependency licence fit undecided: the workflow needs the tool repo to be fetchable, and axe-core (MPL-2.0), Pa11y (LGPL), MobSF (GPL), k6 (AGPL) were never checked against FSL               | E2E plan "Phase 1 open items", "Not yet checked" | S             |

### E. Maintainability and hygiene (P1-P2)

| ID  | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Evidence                  | Size   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------ |
| G33 | **Closed (7130d22, verified 2026-10-09).** **Docs and status drift.** `PRODUCT_GUIDE.md` still describes the `qa-test` CLI, a Report Hub with PostgreSQL/S3, a dashboard and port 4000, none of which have source in the repo any more (README also mentions the Hub). E2E plan status says Render "not created" and phases unrun while deploy workflow points at live URLs. `URL_FIRST_IMPLEMENTATION_PLAN.md` links a `GAP_REVIEW.md` that does not exist and says "Not started" for built work | grep in docs; `ls`        | S-M    |
| G34 | **Closed (7130d22, verified 2026-10-09).** **Dead and legacy code.** Removed the retired Hub client code and tests, hub-only types, leftover old build output of three packages, and a stale worktree copy. `.env.example` was rewritten under G33.                                                                                                                                                                                                                                               | `ls packages`             | S-M    |
| G35 | **Large files.** `runner/src/server.ts` 3,882 lines, `core/orchestrator.ts` 1,059, `types/src/index.ts` 1,074, `wizard/src/App.tsx` 703. Hard for people and agents to change safely; routes, beta rules and handlers live in one file                                                                                                                                                                                                                                                            | `wc -l`                   | M-L    |
| G36 | No dependency or security automation: no Dependabot, `pnpm audit` or secret scan in CI; no coverage figure                                                                                                                                                                                                                                                                                                                                                                                        | `.github/`                | S      |
| G37 | **Closed (7130d22, verified 2026-10-09).** Playwright is pinned in two places that must match (lockfile and the Docker image tag); nothing enforces it                                                                                                                                                                                                                                                                                                                                            | `Dockerfile`              | S      |
| G38 | Exposed API key from a saved Claude permission rule still needs rotating at the provider (removed from the file today)                                                                                                                                                                                                                                                                                                                                                                            | `SECURITY.md`, CHANGELOG  | S, you |
| G39 | **Closed (7130d22, verified 2026-10-09).** Open work lives only in long markdown plans: no TODO markers in code and no issue tracker or task list. The agent backlog (`.claude/work/backlog.md`) is local and git-ignored                                                                                                                                                                                                                                                                         | code search, `.gitignore` | S      |

### F. Marketing: the product's own, and the marketing checks it runs (added 2026-10-07)

**Built.** (1) A marketing checker (`checkers/src/marketing.ts`) runs on the site being tested: share previews, call to action, contact route, privacy/terms link,
analytics, social links, pricing, trust signals, email capture, cookie notice. It feeds a "marketing basics" checklist and a sub-score in the report.
(2) The product's own public page: landing page with sample report, FAQ, a pricing section, JSON-LD, `llms.txt`, `robots.txt`, `sitemap.xml`, Open Graph and Twitter tags
(`docs/SEO_AEO_GEO_STRATEGY.md`, `docs/design/landing-and-home-spec.md`).

| ID  | Gap                                                                                                                                                                                                                                                                                                               | Evidence                                                         | P     | Size         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----- | ------------ |
| G40 | No measurement of the landing page: no visits, clicks or conversion counter, so the goal "a visitor completes a free check-up" can't be judged                                                                                                                                                                    | landing audit P1-1; no analytics code found in `packages/wizard` | P1    | S            |
| G41 | Share image is an SVG; LinkedIn, X and Slack don't render SVG previews, so shared links look empty                                                                                                                                                                                                                | `public/og-image.svg`; audit P1-2                                | P1    | S            |
| G42 | No way to reach the owner or capture interest: no email sign-up, waitlist, contact link or feedback form (only the GitHub link)                                                                                                                                                                                   | no `mailto`, form or newsletter code found                       | P1    | S            |
| G43 | Pricing is a placeholder ("Free while we're in beta, paid plans planned"). No plans, limits or billing. Same root as G30                                                                                                                                                                                          | `LandingScreen.tsx` pricing section                              | P2    | M            |
| G44 | No go-to-market plan: target customer, positioning against Playwright/axe/Lighthouse and paid tools, launch channels, content plan. The roadmap holds market research, not a marketing plan                                                                                                                       | not found in `docs/`                                             | P1    | M (thinking) |
| G45 | Only one public page plus the sample report (the sitemap lists two URLs). No docs site, blog, changelog page, case studies or testimonials                                                                                                                                                                        | `public/sitemap.xml`                                             | P2    | M            |
| G46 | landing audit items still open: sample report goes stale when the report format changes (P1-3), long form above the fold (P1-4), developer shortcuts shown to first-time visitors (P1-5), wake-time limit fixed at 90 s, area list not linked to the sample, no theme toggle, no screen-reader or Lighthouse pass | audit P1-3 to P2-4                                               | P1-P2 | S-M          |
| G47 | Not yet used on itself: the product's own landing page was never run through its own check-up, and it would likely trip its own marketing checks (no analytics, no contact route, no testimonials). The strategy doc says to do this                                                                              | `SEO_AEO_GEO_STRATEGY.md` last bullet                            | P1    | S            |
| G48 | The marketing checker is a checklist of 11 present-or-missing facts read from the home page. Not found in it: message and copy quality, signup or checkout funnel tests, tag and pixel validation, UTM handling, consent behavior (plan item 3.5, not built), email deliverability                                | `marketing.ts` rules list                                        | P3    | M            |

## Suggested order

_Test deferral is on (see `docs/AGENT_WORKFLOW.md`): G1 (run the suite and fix) and G3 (benchmark) become the single final verification phase after all other tickets are built, not the first step._

1. **P0 (about a week):** G1 run and fix the full suite, G2 widen CI to run everything except the browser test, G5 lint/format, G38 rotate the key, G33/G34 cleanup so agents stop reading stale or dead material.
2. **Prove the product (parallel, calendar time):** G28 talk to 3 to 5 users; G4 run the whole path once from a clean repo and record minutes and memory; G3 benchmark in CI.
3. **Make it usable and keepable (P1-P2):** G7, G8/G9, G10, G11, then G12 and G13 (findings contract and Playwright export), G17, G31, G27.
4. **Depth (P3):** G14, G15, G16, G18 to G22, in the plan's order, one at a time, benchmark after each.
5. **Expansion (P4):** only after users ask: G23 to G26.

## Turn this into work

Plan each item with the agents, then build the approved ones in a batch (`docs/AGENT_WORKFLOW.md`):

```
/ship plan G1 run the full test suite, fix what fails, and record the result in the Phase 0 exit gate
/ship plan G2 make pull-request CI run all non-browser tests
/ship plan G33 bring PRODUCT_GUIDE, README and plan status docs in line with the code; remove retired CLI, Hub and Dashboard descriptions
```

Keep this file current: when a gap closes, change its row to "closed" with the commit, rather than deleting it.
