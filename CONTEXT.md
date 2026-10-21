# AI Discovery and Readiness Testing

The domain model for automated web application discovery, test planning, and deterministic pre-release quality evaluation.

## Language

**App**:
Anything the tool tests that its team releases on its own: a website, a phone app (its iOS and Android builds together), a desktop app, or a public API. Each App has its own check-ups and its own verdict. The API calls a website makes are tested inside that website's check-up, not as a separate App.
_Avoid_: Product, project, target; "site" only for web-only ideas such as the Domain Allowlist

**Discovery Agent**:
The component that runs a scan: it drives the Deterministic Spider for each role and hands the facts to the AI Planner while the Spider is still crawling.
_Avoid_: Web scraper, spider, bot

**Deterministic Spider**:
A rule-based browser crawler that finds every reachable page on the site, the links and navigation buttons between them, and each page's buttons and forms. It gathers facts; it never decides what to test.
_Avoid_: Discovery agent, AI crawler

**AI Planner**:
The AI step that writes every Plan Item from the Deterministic Spider's facts, batched by Layout Group. Its output is checked for coverage, real selectors and safety before anyone sees it. It never drives the browser.
_Avoid_: AI crawler, test generator

**Flow**:
A sequence of user interactions and state transitions achieving a distinct functional goal within the application.
_Avoid_: Path, scenario, route

**User Flow**:
The chronological human actions taken within a specific role to achieve an outcome.
_Avoid_: Journey, clickstream

**App Flow**:
The page graph: which page links to which, through which link or navigation button, as each role sees it. Navigation Checks are planned from it.
_Avoid_: Backend flow, network flow, sitemap

**Inferred Business Rule**:
A functional constraint (validation, permission limit, calculation, state precondition) deduced by the AI from application behavior or product context.
_Avoid_: Requirement, spec rule (when unconfirmed)

**Product Context**:
External reference material (PRDs, user stories, design documents) provided by QA or product managers to guide discovery and planning. Markdown, text or Word (.docx) files, or a docs URL. With no AI key, fixed rules turn it into Plan Items (User Flows, route access, Denial items), each with its Source; expectations they cannot check go under Needs your judgement.
_Avoid_: Documentation, requirements doc

**Requirement**:
A functional or non-functional capability that the Product Context states the application must fulfill, or that the person confirmed during review. Whether the Spider reached it is an outcome the report counts ("N of M documented items reached"), not part of what a Requirement is.
_Avoid_: Feature request, acceptance criteria

**Source**:
The part of the Product Context a Plan Item was planned from: the document name, the section, and the Requirement it describes. A Plan Item with no Source came from live exploration only. The AI Planner proposes which roles a Source applies to; the person confirms in Plan Review.
_Avoid_: Test case, trace link, doc reference

**Discovered Flow**:
A user or application flow identified by the Discovery Agent through live exploration.
_Avoid_: Tested flow (until executed)

**Unstated Flow**:
A flow discovered on the live application that was not documented or anticipated in the Product Context.
_Avoid_: Orphan flow, rogue flow, undocumented feature

**Check-up**:
One pass of the tool over an App, as the person sees it: the scan, the Plan Review, testing and the report. Each finished check-up keeps its report under Past check-ups.
_Avoid_: Run, scan or check (in UI text; "check" means a Navigation Check or a graded check)

**Check-up Session**:
The module in the runner that owns the state of one Check-up and the operations on it: the run slot, the Plan under review (and parked waiting Plans), the report, the event log, and the run's session secrets. It owns state and operations, never transport or policy (access tokens, allowed origins, beta limits, and host policy stay in the server).
_Avoid_: Run manager, session object, runner state

**Plan**:
The complete list of everything a run does: every page visit, Navigation Check, journey and check, at each screen size and for each role, plus what won't run and why. Nothing runs that isn't in the Plan.
_Avoid_: Test case matrix, test suite, spec

**Plan Item**:
One entry in the Plan: a page visit, a Navigation Check, a journey or a check. Each one can be switched off or re-planned, and a page from a Layout Group can be promoted to be tested on its own.
_Avoid_: Test (for the unexpanded entry), step

**Denial Plan Item**:
A Plan Item that checks a role is blocked from something its Source describes for another role, such as a Viewer being unable to create a user. It passes when the action is hidden or refused.
_Avoid_: Negative test, permission test

**Intent**:
What a journey or form Plan Item expects to happen: **Works** (valid input succeeds), **Rejects** (bad or missing input shows an error), **Limits** (extreme values such as very long text, zero or negative numbers are handled) or **Denied** (the role is blocked, which is a Denial Plan Item). Page visits and Navigation Checks have no Intent.
_Avoid_: Category, positive/negative test, happy path, scenario type

**Refusal rule**:
How a Rejects item passes or fails, the same in the Check-up and in the Playwright export (`expectRefused`). It passes when the page did not move on (no success redirect, no new record) and something signalled refusal: the browser's invalid state, `aria-invalid`, `role="alert"`, or new visible error text. It fails if the app accepted the input, or crashed. The exact message is compared only when the Source states it. No AI judges it.
_Avoid_: Validation check, negative test

**Opening steps**:
The recorded clicks that reach a form inside a modal, drawer, tab or accordion. They sit on the Plan Item, show in Plan Review and run before the form steps. If the opener is gone at run time the result is "Could not verify" (could not reach it), not a form failure.
_Avoid_: Setup steps, precondition

**Test cap**:
The most Tests one Check-up may run, 2000 unless the person sets another number. Plan Items past it stay in the Plan, switched off with the reason "over the Test cap", and the approval summary says how many. It counts Tests, not AI requests.
_Avoid_: Limit, quota, AI Request Budget (that one counts AI requests)

**Not found in app**:
A Plan Item whose Source describes something the Spider could not find in the app as that role. It does not run, is not a failure, and counts only in the report's "N of M documented items reached". The person removes it, fixes the document, or points to the page.
_Avoid_: Missing feature, failed requirement

**Needs your judgement**:
The report section, per role, for Inferred Business Rules that only the AI judged to be wrong. Each shows its evidence and stays out of the verdict and grades until the person accepts it.
_Avoid_: AI bugs, suspected bugs, low-confidence findings

**Test**:
One Plan Item run as one role at one screen size. It is the unit the approval summary counts ("412 tests").
_Avoid_: Test case (in UI text), check

**Plan Review**:
The step where the person reads the complete Plan, answers Ambiguity Questions, changes the Plan and approves it before anything runs. Approval is never blocked; the approval summary states every default that will be applied.
_Avoid_: Confirmation phase, sign-off, gating, triage

**Navigation Check**:
A Plan Item that clicks one link or navigation button as a person would. It passes when the planned page opens and works (no error page, 404 or blank screen). Shared header and footer menus get one check for the whole site; a link that leaves the site is only checked for being broken.
_Avoid_: Link test, crawl check

**Layout Group**:
The pages built from the same template, told apart by the crawler's layout fingerprint, such as every product page.
_Avoid_: Template, page type, cluster

**Sample Page**:
One of the pages from a Layout Group (three by default) that is planned and tested on behalf of the whole group. The rest are listed as covered by the sample.
_Avoid_: Representative, example page

**Fixed-Rule Fallback**:
A Plan Item planned by fixed rules because the AI couldn't plan it: the AI Request Budget ran out, the model stopped before it answered, the service didn't answer, the answer was unusable after repair, the scan was stopped early, or there's no AI. Each item records which. It is always labeled in the Plan and can be re-planned with one click.
_Avoid_: Default plan, template plan, heuristic plan

**AI Request Budget**:
The number of AI requests a Plan needs, compared with what the AI key has left today, as the provider reports it. The person can also set a cap per check-up, in requests or dollars. It is estimated on the new check-up screen before the scan starts (repairs and the visual review included), and items past the budget or the cap use the Fixed-Rule Fallback.
_Avoid_: Quota, token budget

**Waiting Plan**:
A Plan that is waiting for its Plan Review. Each site can have one: checking another site keeps it aside, and it can be opened again from the new check-up screen. A new check-up of the same site replaces it.
_Avoid_: Draft, pending run

**Ambiguity Question**:
A targeted question generated by the AI when encountering untracked side effects (payments, deletes, emails) or ambiguous form actions requiring human decision.
_Avoid_: Prompt, clarification, round 2 question

**Scope Exclusion**:
A Plan Item (page, link, journey or check) that the person deliberately switched off in the Plan Review, so it is excluded from the current run.
_Avoid_: Ignored test, disabled check, bypass

**AI Provider**:
A pluggable adapter interface connecting the Discovery Agent and Test Planner to LLM backends (Anthropic Claude, OpenAI, Google Gemini, OpenRouter).
_Avoid_: Model wrapper, AI client

**Bring Your Own Key (BYOK)**:
The capability for individual developers or teams to supply their own API credentials and model preferences for AI discovery.
_Avoid_: Custom token, user secret

**Sensitive Action**:
An interactive element or form submission that can trigger destructive side effects (deletions, payments, external notifications, administrative changes).
_Avoid_: Risky button, danger action

**Safety Filter**:
A deterministic barrier intercepting and pausing actions matching forbidden keywords or profile restrictions before the browser executes them.
_Avoid_: Guardrail, sandbox

**Test Copy**:
A copy of an App that is safe to fill in and send forms on: an address on this computer or a private network, a dev tunnel, or an address the person marked as a test copy. When the tool runs on shared machines instead of the person's own computer, only an address under a Verified Domain can be marked. Full testing and Security Probes need a Test Copy and the owner's say-so; any other App is only looked at. Exception (ADR 0022): on the person's own computer, test sign-in details plus an accepted notice allow full testing of that App for that one run.
_Avoid_: Staging, test host (in UI text), sandbox

**Verified Domain**:
A domain whose owner has proved control once, with a file served on its exact address. Addresses under it, such as preview URLs, can be marked as Test Copies on shared machines.
_Avoid_: Claimed site, owned domain

**Security Probe**:
A security check that sends something the owner could mistake for an attack, such as repeated sign-in attempts, crafted inputs or redirect tricks. Probes run only on a Test Copy; every other security check only reads what the App already sends.
_Avoid_: Scan, attack, pentest

**Domain Allowlist**:
The hosts the crawler may follow links into: the host the start address lands on after redirects, its `www` twin, and any other host the person ticks in the Plan Review. Links to any other host are listed as leaving the site and only checked for being broken.
_Avoid_: Host filter, URL scope

**Role**:
One set of sign-in details the person gave for an App: a role name, a username and a password, plus optional custom headers, a token or `localStorage` entries. A Check-up crawls once as a visitor and once per Role, starting from the page that Role landed on. A Role counts as signed in only when its sign-in ran and succeeded: a Role that was never attempted (no browser to sign in with) is reported as not signed in, never as verified.
_Avoid_: User, account, persona

**Sign-in Wall**:
A page the App will not open without a sign-in: it answered 401, it is the Role's sign-in page, or the App sent the crawl to a page that is nothing but a sign-in form. A page that merely shows a password field — a change-password form, a two-factor step — is not a wall. A wall is reported with the path that was asked for, not the route key.
_Avoid_: Login page, auth wall, bounce

**Skipped Page**:
A page the crawl found but did not record, with one reason: `page-limit`, `did-not-load`, `robots`, `sign-in`, `http-error`, `timeout`, `off-site-redirect`, `time-limit`, `trap-limit`, `session-lost` or `duplicate`. The Plan lists them under what was not reached; a Skipped Page is never a failure.
_Avoid_: Ignored page, missing page

**Route Telemetry**:
One row per route the crawl attempted: the path asked for (redacted), the HTTP status, where it landed, the outcome (`recorded` or `skipped`), the skip reason when skipped, how many attempts, how long it took, and which Role or visitor it was. Route Telemetry is the crawl's own account of itself, so the page count and the Plan's map can be checked against it.
_Avoid_: Crawl log, request log, trace

**Structural Fingerprint**:
A deterministic hash generated from invariant finding attributes (`productId`, `normalizedRoute`, `checkerId`, `ruleCode`, `targetElementSelector`) used to recognize identical issues regardless of run environment, developer, or timestamp.
_Avoid_: Error hash, bug signature, checksum

**Run Finding**:
The concrete occurrence of a finding captured during a single test execution run on an individual machine, preserving raw run-level evidence (screenshots, DOM snapshots, network logs).
_Avoid_: Local bug, run result, raw failure

**Evidence Bundle**:
The complete collection of persistent binary and textual artifacts (screenshots, video recordings, Playwright trace files, DOM snapshots, network logs) produced by a test run.
_Avoid_: Artifact zip, logs folder, media attachments

**Design Token Conformance**:
The deterministic verification of an interactive element's live `getComputedStyle()` attributes (colors, typography, border radii, spacing) against declared design system variables.
_Avoid_: CSS linting, style check, visual check

**Perceptual Visual Diff**:
A comparison between captured Playwright viewport snapshots and approved reference frames using perceptual tolerance and antialiasing filtering.
_Avoid_: Pixel diff, screenshot test

**Token Baseline**:
The committed specification of approved design tokens (`design-tokens.json`) stored within the product profile, against which computed DOM styles are audited without requiring live Figma API access during test runs.
_Avoid_: Figma cache, style reference

**State-Aware UX Check**:
An automated evaluation executed at discrete settled interaction points (e.g. post-click, open modal, invalid form submission) auditing accessibility (WCAG 2.2 AA via axe-core) and heuristic usability (target sizes, horizontal overflow, missing feedback).
_Avoid_: Page scan, static audit, visual lint

**Interactive State**:
A dynamic condition of the user interface (open modal, dropdown menu, visible form validation banner, spinner) achieved only through sequential interaction.
_Avoid_: Screen, page view, template

**Intra-Run Route Deduplication**:
The suppression of duplicate rule violations identified on the same route across multiple steps within a single run, presenting a clean summary per route.
_Avoid_: Log muting, error filter

**Account Pool**:
A configured collection of distinct user credentials per role leased to concurrent test workers during parallel execution to prevent session invalidations.
_Avoid_: User list, credential list, test logins

**Entity Namespacing**:
The automatic application of unique run and worker tokens to newly created entities during test execution, ensuring parallel flows do not collide or mutate shared state.
_Avoid_: Random naming, unique tag, test prefix

**Worker Context Isolation**:
The separation of parallel test runners into independent Playwright `BrowserContext` instances with zero shared cookies, storage, or cache.
_Avoid_: Thread isolation, process sandbox

**Clean Flow Retry**:
The recovery strategy that aborts a failed flow, preserves failure diagnostics, and restarts execution from the initial step inside a pristine `BrowserContext` to avoid contaminated UI or session state. Used only for transient failures (a navigation timeout, a network error, a browser crash); a real failure is reported once.
_Avoid_: Step repeat, in-place retry, blind re-click

**Flaky Passed**:
An execution outcome where an initial attempt failed due to transient conditions but a clean retry succeeded. It counts as passed, and the report shows it as an instability signal.
_Avoid_: Soft pass, intermittent green, pass on retry

**Reference Flow**:
A sequence of user interactions and states extracted from a public third-party or competitor website, serving as an external benchmark for comparison.
_Avoid_: Competitor journey, third-party flow, external trace

**Competitive Benchmark**:
A structured comparative evaluation contrasting our product's flow against a Reference Flow across friction metrics, UX heuristics, accessibility, and interactive patterns.
_Avoid_: Competitor audit, teardown, site comparison

**Safe Interaction Mode**:
A restricted crawler policy enabling exploration of client-rendered controls (tabs, pricing toggles, preview wizards) while strictly blocking form submissions, API mutations, and external navigation.
_Avoid_: Read-only sandbox, passive crawl

**Friction Scorecard**:
A quantitative assessment evaluating user effort within a flow, based on total step count, required input fields, clicks to completion, and layout obstacles.
_Avoid_: Step score, complexity index

**UX Gap Analysis**:
An AI-driven strategic synthesis identifying friction disparities, conversion drop-off risks, and prioritized UX improvements relative to benchmarked competitors.
_Avoid_: Teardown report, critique, competitor notes

**Smoke Check-up**:
The quick preset that only reads a few known paths of a deployed App, health first. GET only; no sign-in, no forms, no AI.
_Avoid_: Canary, uptime monitor, smoke test

**Active check consent**:
The owner's explicit, per-run say-so (plus a Test Copy) for any check that sends something an owner could mistake for an attack. Never remembered. See ADR 0030.
_Avoid_: Pentest mode, attack mode

**WCAG criterion status**:
Per WCAG criterion, one of "violated", "no violation found by automation", "needs human judgment". Never "passes" or "compliant".
_Avoid_: Accessibility score, compliance percentage
