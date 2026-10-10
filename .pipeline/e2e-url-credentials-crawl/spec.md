# Spec: URL + test credentials -> crawl -> all issues

## Goal
User enters an App URL and test credentials only. Tool signs in, crawls every reachable page and flow, runs deterministic checks, and returns one deduplicated issue list, with no Plan editing needed.

## Context
Most of this exists (see recon.md): NewCheckupScreen.tsx, POST /api/runner/run, preflight.ts, deterministic-spider.ts, orchestrator.ts, issues-document.ts. The delta is the "just URL + credentials" path and its gaps, not a new engine.

## Functional requirements (draft, depends on open question)
1. FR1: One screen with only URL, username, password. Everything else defaults (skipReview on, maxPages default, no-AI path works with no key).
2. FR2: Pre-flight sign-in verifies credentials before crawl; failure shows one of the existing reasons (wrong-details, no-form, unreachable, needs-more, session-expired) in plain words.
3. FR3: Crawl runs authenticated, covers all links, nav, forms and role-visible pages up to maxPages; the report states pages found, pages reached, pages skipped and why.
4. FR4: Every Plan Item runs; no item silently dropped. Report lists each as pass/fail/not run with reason.
5. FR5: Output is one Issues list: Canonical Findings deduped, each with evidence, severity, page, repro steps.
6. FR6: Progress streams over the existing SSE.
7. FR7: Same flow runnable headless via `checkup.ts` with URL and credentials from env vars.
8. FR8: Credentials never written to disk, reports, logs or evidence (Redactor); password kept only per ADR 0021 / keychain-if-remember.
9. FR9: Live-host behavior follows the safety model chosen in Open Question 1.

## Non-functional
- No new runtime dependencies without ADR. Node-only code stays out of wizard bundle.
- Terms per CONTEXT.md (Check-up, Plan, Plan Item, Issue wording per its Avoid list).
- Time-to-first-issue target: under 15 min for fixture-size app (matches Phase 1 exit gate).
- Tests added for each FR; existing suite unchanged.

## Out of scope
MFA/CAPTCHA/SSO sign-in; mobile apps; WebKit/Firefox; OpenAPI; self-healing selectors; hosted multi-tenant service.

## Assumptions (flagged)
A1: "all issues" means everything the existing checkers can detect, not proof of absence of bugs.
A2: One role per run is enough for v1; multi-role stays as today.
A3: Works without an AI key via Fixed-Rule Fallback; AI improves Plan quality when a key exists.
A4: No new Plan Review step unless the user opts in.

## Decision (answered)
Q1 = (b) Credentials = consent. Giving test credentials counts as owner confirmation for that App on a live host; Safety Filter still blocks Sensitive Actions. Needs new ADR 0022 amending 0014. Risk: weakens the safety model; the user accepted this.

## Former open question
Q1: On a live (non-test) host, existing safety model allows read-only checks only. Which behavior do you want for "URL + test credentials"?
(a) Keep: full interaction only on owner-confirmed test host; live host gets read-only crawl.
(b) Add: signing in with test credentials counts as owner confirmation for that App; allow interaction, with Safety Filter still blocking Sensitive Actions.
(c) Other.

## Acceptance criteria
AC1: Fixture app, URL + creds only, completes with no other input and yields an Issues list including all labelled fixture issues (benchmark thresholds hold).
AC2: Wrong password stops before crawl with the wrong-details message; no crawl occurs.
AC3: Report page coverage numbers match pages actually visited.
AC4: grep of report, logs and evidence for the test password returns nothing.
AC5: Headless `checkup.ts` run produces the same Issues list as the UI run.
AC6: Behavior on a non-test host matches Q1 answer, covered by test.
AC7: Full suite equals baseline plus new tests, no regressions; `pnpm build` and `pnpm lint` pass.
