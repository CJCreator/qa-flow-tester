# Product Guide

What the product does. Terms follow [CONTEXT.md](../CONTEXT.md). Settings: [CONFIGURATION.md](CONFIGURATION.md). Routes: [API.md](API.md). Design: [ARCHITECTURE.md](ARCHITECTURE.md). Hosting: [DEPLOYMENT.md](DEPLOYMENT.md). Safety: [../SECURITY.md](../SECURITY.md).

## Who it is for

Teams that release a web app without a QA person, and people who look at someone else's public website to find what to repair. It runs in the browser, with no test code to write. Source-available (Functional Source License, MIT after two years) and self-hosted; a hosted copy runs on Google Cloud Run.

## Two areas

|                          | Check-up                        | Website Audit                                |
| ------------------------ | ------------------------------- | -------------------------------------------- |
| For                      | An App the team releases        | A public website, usually not the user's own |
| Starts at                | New check-up                    | `/audits/new`                                |
| Plan and Plan Review     | Yes                             | No                                           |
| Release verdict          | Yes                             | Never                                        |
| Signs in, fills in forms | Yes, with Roles, on a Test Copy | Never                                        |
| Output                   | Report                          | Audit Documents                              |

Both reuse one engine (crawl, checks, AI providers). Decisions: ADR 0033, 0041.

## Check-up

1. **New check-up.** Address, optional Roles (sign-in details), optional Product Context (Markdown, text, `.docx`, or a docs URL), crawl limits (defaults 200 pages, depth 8; `CRAWL_LIMIT_BOUNDS` in `packages/types/src/discovery.ts`; include and exclude paths), Test cap, AI Request Budget. The AI estimate shows before the scan starts.
2. **Scan.** The Deterministic Spider crawls as a visitor and once per Role, and streams facts to the AI Planner while it crawls. Payment areas are not touched. Pages it did not record are Skipped Pages with a reason, never failures.
3. **Plan Review.** The person reads the complete Plan, answers Ambiguity Questions, switches Plan Items off (Scope Exclusion), promotes Sample Pages, edits the Domain Allowlist, re-plans a Fixed-Rule Fallback item, and approves. Nothing runs that is not in the Plan. Approval is never blocked; the approval summary lists every default applied. The Plan can be downloaded as Markdown and exported as a Playwright project (zip, `packages/core/src/plan/playwright-export.ts`).
4. **Testing.** Each Test is one Plan Item as one role at one screen size (375, 768, 1440 px). Workers use isolated browser contexts. A failed flow is retried once in a clean context; if it then passes it is Flaky Passed.
5. **Report.** Verdict, six area grades, problems.
6. **Test again** reuses the approved Plan; only new items wait for review. Each report is kept under Past check-ups. A Waiting Plan is kept per site.

Other entries: Smoke Check-up (GET-only read of a few paths, no sign-in, no forms, no AI); scheduled check-ups on the hosted copy ([DEPLOYMENT.md](DEPLOYMENT.md)); the CI runner `packages/runner/src/checkup.ts` (`node packages/runner/dist/checkup.js <url> [--staging] [--fail-on standard|blocker|major|none]`, workflow template `templates/qa-check.yml`); the Benchmark screen; Visual baselines (`.qa-baselines/`).

### Plan Items and Intent

Plan Item kinds: page visit, Navigation Check, journey, check. Journey and form items carry an Intent:

- **Works**: valid input succeeds.
- **Rejects**: bad or missing input is refused. Judged by the Refusal rule (`packages/checkers/src/refusal-rule.ts`): the page did not move on, no new record, and a signal (invalid state, `aria-invalid`, `role="alert"`, new visible error text). The Playwright export embeds the same function.
- **Limits**: extreme values are handled.
- **Denied**: a Denial Plan Item; the role is blocked by hiding or refusing (`permission-matrix.ts`).

With a Product Context, each item carries its Source. Items whose Source the Spider cannot find are **Not found in app**: they do not run and count as "N of M documented items reached". Without an AI key, fixed rules write the Plan (Fixed-Rule Fallback, labeled per item).

## Checks

Each check feeds one of six areas (`ASPECT_CHECKERS`, `packages/types/src/problems.ts`). Checks are automatic and report what they saw; none claims a site is accessible or safe (ADR 0018). A check that could not run is "Could not verify": never a defect, never a pass (`could-not-verify.ts`).

| Area                 | Checker             | Reports                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Works                | `bug-detection`     | Uncaught exceptions, console errors, failed requests (4xx/5xx), broken links, failed steps                                                                                                                                                                                                                                                                                                                                        |
| Works                | `spec-conformance`  | Journeys and forms against Intent and Source                                                                                                                                                                                                                                                                                                                                                                                      |
| Accessible           | `ux-quality`        | axe-core WCAG 2.2 AA with the criterion named, touch targets (24 px minimum), labels. `keyboard-a11y.ts`: unreachable elements, focus hidden under fixed content, focus traps, sideways scroll at 320 px. Per WCAG criterion: violated, no violation found by automation, or needs human judgment                                                                                                                                 |
| Fast and mobile      | `performance`       | LCP, CLS, INP in a throttled lab browser (median of loads; `SPEED_THRESHOLDS`: LCP 2.5 s, CLS 0.1, INP 200 ms good; slow request 2 s; page weight 4 MB), viewport tag, horizontal overflow                                                                                                                                                                                                                                        |
| Findable             | `seo`               | Title, description, `h1` and heading order, canonical, noindex, viewport, favicon, image alt, OpenGraph, broken links; structured data and answer readiness (`aeo.ts`); AI-readable structure and credibility (`geo.ts`); home-page marketing basics (`marketing.ts`: call to action, contact, privacy or terms link, analytics, cookie notice, social links, pricing, reviews, email capture). Site-wide facts are reported once |
| Protected            | `security`          | Insecure content, cookie flags, CSRF token on forms, CSP, nosniff, clickjacking, Referrer-Policy, HSTS, CORS, stack traces, secrets in addresses. `security-depth.ts`: missing integrity attributes, reachable source maps, `security.txt`                                                                                                                                                                                        |
| Protected            | `permission-matrix` | Role access against the Source                                                                                                                                                                                                                                                                                                                                                                                                    |
| Looks and reads well | `design-standards`  | Computed styles against `design-tokens.json` (Token Baseline); perceptual visual diff against approved baselines                                                                                                                                                                                                                                                                                                                  |
| Looks and reads well | `ai-review`         | Advisory visual review                                                                                                                                                                                                                                                                                                                                                                                                            |

Security checks only read what the App already sends, plus same-site GETs. Security Probes and Active check consent are decided in ADR 0030; no probe runs today.

AI findings (`ai-review`, anything marked `advisory`) are advisory: they never change a grade or the verdict. Unconfirmed AI judgements about Inferred Business Rules sit under **Needs your judgement** until the person accepts them.

Findings with one Structural Fingerprint across pages or sizes group into one problem (`problems.ts`). A finding marked Intended or False Positive does not count.

## Grades and verdict

`packages/types/src/verdict.ts` is the one definition of the verdict; `packages/core/src/scoring.ts` computes grades.

- Each area starts at 100. Per problem: Blocker -50, Major -20, Minor -5, Suggestion -2, times a spread multiplier (1.0 on one page, 1.25 on 2 to 4, 1.5 on 5 or more). Each Flaky Passed test takes 3 from Works.
- Grade: A 90+ with no Blocker or Major. B 75+ with at most one Major. C 60+. D 40+. F below 40. Any Blocker caps at D. One Major caps at B; two or more cap at C. An unhandled first-party 5xx or crash in Works is F.
- An area nothing checked has no grade and shows "Not checked", never an A. It is left out of the overall score.
- Verdict: **Ready to release** or **Not ready yet**, with a reason. Gates:
  - standard (default): 0 Blockers and every checked area C or better (60+). A Major lowers its area's grade but does not block alone.
  - strict: 0 Blockers, 0 Majors, every checked area A (90+).
  - lenient: 0 Blockers; Accessible, Fast and mobile, Findable and Looks and reads well are advisory.
- The verdict counts problems as a person reads them. It excludes dismissed findings, AI findings and unconfirmed guesses (listed as "to confirm"), and states tests that did not run.
- The screens, `report.html`, `report.md`, the stamp and the CI exit code all call `releaseVerdict`.

## Report outputs

The report screen shows the verdict and grades first, then per problem: steps, selector, element snapshot, console and network evidence, screenshots, **Copy bug report**, **Copy Playwright test** (a repro script per finding), and **Copy as Markdown**. Evidence is redacted (ADR 0016). Files per run (`packages/core/src/reporter.ts`, `html-report.ts`):

- `report.html`: one self-contained file.
- `report.md`: summary for a pull request.
- `findings.json`: machine-readable; schema `docs/findings.schema.json` (ADR 0017).
- `fix-these.md`: brief for an AI coding tool. Also `AGENTS.snippet.md` and `known-findings.json`.
- `issues.md` and `issues.html`: the issues document.

Where the files live: [ARCHITECTURE.md](ARCHITECTURE.md).

## Benchmark

Compares the user's flow with a competitor's public Reference Flow in Safe Interaction Mode (no form submits, no mutations, no off-site navigation). Reports a Friction Scorecard (steps, inputs, required fields, click depth, Friction Index), interaction pattern parity, and an AI UX Gap Analysis (`packages/core/src/competitive/`).

## Website Audit

Reads a public website and writes documents the user edits and exports. No Plan, no Plan Review, no verdict. It never signs in and never fills in or sends a form; payment areas are not touched.

- **Limits** (`AUDIT_LIMIT_DEFAULTS`, `CRAWL_LIMIT_BOUNDS`): max pages default 50 (1 to 1000; the hosted copy caps at 200), max depth default 5, include and exclude paths matched on whole path segments (exclude wins; the start page is always allowed). The limits are kept for a re-run.
- **Crawl.** Page Content is read by fixed rules from every crawled page, Section by Section. Browser checks, speed and AI notes run on Sample Pages. A page is retried once before it becomes a Skipped Page. An Interstitial Page that does not clear fails the audit with "This site blocks automated visitors" (ADR 0042). Fetching is parallel (3 in flight, AI 4; ADR 0043).
- **Areas.** Six: ranking, marketing, usability, content, accessibility, speed. Grades come from deterministic checks; AI writes notes that cite evidence, never a score. An area a stage could not assess is "not done", not clean.
- **Audit Documents.** Structure, Content, Findings (technical, marketing, content; ranked by impact, then lower effort), Improvement Roadmap, Proposal (from the user's template; price in INR). Edits are an overlay; originals are kept.
- **Also made from an audit:** Pitch Glimpse (one A4 page, top 3 issues; the tool never sends it), Owner Audit, website preview.
- **Export** (`EXPORT_FORMATS`): `md`, `html`, `pdf`, `docx`, `bundle` (zip of the Markdown documents, `site.json`, a README index).
- **Languages** (`DOCUMENT_LANGUAGES`, `packages/types/src/website-audit.ts`), chosen per export: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Marathi, Gujarati, Bengali, Odia, Punjabi, Urdu (right to left). All but English and Tamil carry a "beta translation" label. AI notes are written in the language chosen at start.
- **Keeping work.** A new version per re-run, Shortlist with notes and outcome, Shared Links (30-day expiry, revocable), Helpers on the hosted copy. Everything stays until the user deletes the audit (ADR 0036).
- **Wording.** Findings state what was seen, never a claim about the whole site (ADR 0018).

## Disabled actions

A disabled button says why in a line next to it (the button's `aria-describedby` points at that line).

- **Start the check-up** (New check-up): waiting for the AI setup; enter the address first; checking the address; the address cannot be reached; say whether it is a test copy; fix the custom headers.
- **Compare the two sites** (Benchmark): a comparison is running; enter your site's address; enter the other site's address.
- **Save key** (AI key field): off until the key checks as valid. No reason line yet; the status line under the field shows the error for a wrong key (gap W20, the rest of the screens).

## Safety

In brief; the model is in [../SECURITY.md](../SECURITY.md).

- Only a Test Copy gets full testing (forms filled and sent). Any other App is only looked at. On shared machines only an address under a Verified Domain can be marked. Exception on the person's own computer: ADR 0022.
- The Safety Filter pauses Sensitive Actions before the browser runs them. The crawler stays within the Domain Allowlist.
- AI keys are the user's own (BYOK: Anthropic, OpenAI, Google Gemini, OpenRouter) and are never printed or committed.

## Hosted and local

Same product in both. The hosted copy sits behind an access key, refuses private and local addresses in a Website Audit, caps Website Audit pages, stores audits in Cloud Storage, and offers Helpers and Shared Links. A local runner accepts private addresses and keeps data on disk. Details: [ARCHITECTURE.md](ARCHITECTURE.md) "Local and hosted", [DEPLOYMENT.md](DEPLOYMENT.md), ADR 0032, 0036.
