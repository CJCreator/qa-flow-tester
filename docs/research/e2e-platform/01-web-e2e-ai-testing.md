# Cluster 01: AI and scripted web testing

Checked 2026-10-05. Follows [00-brief.md](00-brief.md). Vendor marketing is marked *(vendor claim)*. Anything I couldn't confirm is marked *(unverified)*.

## 1. Scope

This file covers how web apps get end-to-end tests today, by hand and with AI: finding what to test, generating tests, keeping them from breaking, running them, spotting flaky ones, and exporting them as code the user owns. It also covers test data and signed-in flows, including the three possible meanings of "signed-in flows" the early users keep raising. API checks from recorded traffic are in [06-api-testing.md](06-api-testing.md). Visual diffs, browsers and reporting are in cluster 02. The comparison is a founder or developer who would otherwise write Playwright or Cypress scripts, or ask a coding AI to write them.

## 2. Market map

Prices are as listed on each vendor's own page on 2026-10-05. Where I could only reach a third-party page, the row says so.

| Tool | Category | What's relevant here | Free tier / price | Source |
|---|---|---|---|---|
| Playwright (Microsoft) | Open-source test framework | Codegen, trace viewer, `--only-changed`, `--last-failed`, retries with a "flaky" outcome. Test Agents (planner, generator, healer) since v1.56. v1.63 is the latest release notes entry. | Free | [agents](https://playwright.dev/docs/test-agents), [release notes](https://playwright.dev/docs/release-notes), [CLI](https://playwright.dev/docs/test-cli) |
| Playwright MCP | Browser control for AI agents | Drives a browser from an accessibility snapshot, no vision model needed. The docs say it "is not a security boundary". | Free | [repo](https://github.com/microsoft/playwright-mcp) |
| Cypress / Cypress Cloud | Test framework plus paid dashboard | `cy.prompt` turns plain English into Cypress code. It is in beta since 15.13.0, Chromium only, and needs a Cypress Cloud account. | Starter free: 10 users, 500 test results a month. Team $799 a year. Business $3,199 a year. | [pricing](https://www.cypress.io/pricing), [cy.prompt](https://docs.cypress.io/api/commands/prompt) |
| Momentic | AI testing platform | Plain-language steps, hosted browsers, Android and iOS. Pricing is by credit, not seat. | Free: 2,000 credits a month (about 200 runs). Pay-as-you-go $125 a month for 10,000 credits. A step an AI action generates costs 2 credits. | [pricing](https://momentic.ai/pricing) |
| QA Wolf | AI platform plus managed service | Connects to the user's coding agent over MCP, which explores the app and writes the test. Uses open-source Playwright, and tests can be exported *(vendor claim)*. | Self-serve: 1 cent per AI credit, 15 cents per runner minute, free trial. Managed service is quoted per test. | [pricing](https://www.qawolf.com/pricing), [docs](https://docs.qawolf.com) |
| mabl | AI testing platform | Auto-healing, API and mobile testing, credit-based cloud runs | 14-day trial. Plans are by quote. Starts at 500 credits a month. | [pricing](https://www.mabl.com/pricing), [blog](https://www.mabl.com/blog) |
| Checkly | Monitoring as code on Playwright | Runs Playwright checks on a schedule, with AI root-cause analysis | Hobby free: 1,000 browser runs a month. Starter $24 and Team $64 a month, billed yearly. | [pricing](https://www.checklyhq.com/pricing/) |
| Autify | AI testing (Aximo, Nexus) | Aximo is autonomous and credit-based. Nexus is Playwright-based and priced by user. | Aximo free: 2,000 one-time credits. Aximo Core $99 to $120 a month. Nexus free for local testing only, Professional $3,600 a year. | [pricing](https://www.autify.com/pricing) |
| Functionize | AI testing agent (Studio) | Credits cover each agent task. Includes email and SMS testing. | Free: 800,000 credits a month, 5 parallel runs. Growth $20 and Scale $100 a month. | [pricing](https://www.functionize.com/pricing) |
| SmartBear Reflect | No-code web testing | Still sold, under SmartBear's name | 14-day trial. Premium 5,000 credits a month. Prices not shown. | [pricing](https://smartbear.com/product/reflect/pricing/) |
| Ghost Inspector | Record and replay | Browser recorder, email testing on Growth and above | 14-day trial only. Starter $109 a month billed yearly, for 10,000 runs. | [pricing](https://ghostinspector.com/pricing/) |
| Meticulous | Session-replay regression tests | Adds a recorder script to dev and staging. Replays recorded sessions against a new build, with mocked backend responses *(vendor claim)*. | Not stated on its page. Third-party sites list a free tier and a $600 a month Pro plan *(unverified)*. | [site](https://www.meticulous.ai) |
| testRigor | Plain-English tests | Not confirmed from its own page: the pricing URL returned 404 | Third-party sites mention a free public-tests plan and a Pro plan near $900 a month *(unverified)* | [sign-up](https://testrigor.com/sign-up/) |
| Stagehand (Browserbase) | AI browser SDK | `act`, `extract` and `observe`. Its `observe` returns real selectors so credentials need not reach the model. Calls can be cached. | MIT licence. Caching runs through Browserbase's paid cloud. | [repo](https://github.com/browserbase/stagehand) |
| Currents | Playwright dashboard | Flaky-test detection, analytics, orchestration | Scale $49 a month for 10,000 test results. No free plan listed, but a trial exists. | [pricing](https://currents.dev/pricing) |
| Trunk Flaky Tests | Flaky-test quarantine | Quarantine on all tiers | Free for teams up to 5 committers | [pricing](https://trunk.io/pricing) |
| BuildPulse | Flaky-test detection | Detection and quarantine | Startup $99 a month. No free plan listed. | [pricing](https://buildpulse.io/pricing) |
| Mailosaur | Test email and SMS inboxes | SMS is an add-on from $37.50 a month | 14-day trial. Personal $20 a month billed yearly. | [pricing](https://mailosaur.com/pricing) |
| MailSlurp | Test email and SMS inboxes | Phone numbers and SMS need Pro | Free: 500 emails received a month. Starter $19.99, Pro $49.99 a month. | [pricing](https://app.mailslurp.com/pricing/) |

**Gone or changed**
- **Octomind** has shut down. A comparison page says its app "turns off at the end of May 2026" and links its farewell letter ([comparison](https://vostride.com/product-comparison/agent-qa-vs-octomind), [letter](https://octomind.dev/blog/a-letter-to-our-users-customers-and-readers/)). I could not open the letter, because `octomind.dev` did not resolve from here, so the date is *(unverified)* at the primary source. What I did confirm: the CLI repo was archived on 14 July 2026, and the company's other repos are archived too ([repo](https://github.com/OctoMind-dev/cli), [org](https://github.com/OctoMind-dev)).
- **Testim** now belongs to Tricentis. A third-party page says it lacks standalone pricing *(unverified)* ([Capterra](https://www.capterra.com/p/165430/Testim/)).
- **Reflect** now sits under SmartBear ([pricing](https://smartbear.com/product/reflect/pricing/)).
- **Rainforest QA**: its pricing page said "Rainforest is not available in your region" from here, so I could not check its price or status *(unverified)* ([page](https://www.rainforestqa.com/pricing)).

## 3. Capabilities

Verdicts are judged against the decided direction: teams without QA staff, browser-only, $0 hosting, a free tier plus monthly plans, deterministic tests, source-available licence.

### 3.1 Test discovery and crawling

- **What leading tools do:** Playwright's planner agent "explores the app and produces a Markdown test plan" ([docs](https://playwright.dev/docs/test-agents)). QA Wolf's agent explores through MCP ([docs](https://docs.qawolf.com)). Meticulous skips crawling and learns from recorded sessions ([site](https://www.meticulous.ai)). Nearly every tool needs an LLM in the loop for discovery.
- **QA Tool today:** a rule-based crawler, the Deterministic Spider, with no AI in the loop. It handles up to 200 pages for each role, notes pages that sent it to a sign-in form, and merges what each role saw ([deterministic-spider.ts](../../../packages/core/src/discovery/deterministic-spider.ts), [discovery-agent.ts](../../../packages/core/src/discovery/discovery-agent.ts)).
- **Gap:** small. Layout Groups and Sample Pages already answer "don't test 500 product pages". The real gap is states the crawl can't reach without data, such as an empty cart or a paid account.
- **Applies to:** Website. Phone apps need an app-side version (cluster 07). Desktop: not yet.
- **Verdict: Build now** (finish, don't rebuild). It is the tool's strongest asset, and it needs no AI key to run.

### 3.2 Test generation (from crawls, recordings, plain language, requirements)

- **What leading tools do:**
  - Recording: `npx playwright codegen` picks locators by "role, text and test id" and can generate visibility, text and value assertions ([docs](https://playwright.dev/docs/codegen)).
  - Plain language to code: Cypress `cy.prompt` (beta, shows and exports the generated Cypress commands) ([docs](https://docs.cypress.io/api/commands/prompt)). Momentic, Functionize and Autify do the same in their own formats.
  - Agent loop: Playwright's generator reads a plan and writes test files, verifying selectors live. It needs the user's own LLM tool (VS Code, Claude Code, Codex or OpenCode) ([docs](https://playwright.dev/docs/test-agents)).
- **QA Tool today:** the AI Planner writes the Plan from crawl facts, and a person approves it. It never drives the browser ([CONTEXT.md](../../../CONTEXT.md)). Every Plan Item runs as a deterministic test, and nothing is exported as a test suite yet. The only code output is a one-off `repro-<finding>.ts` that clicks and fills from a failed test case ([repro-generator.ts](../../../packages/core/src/repro-generator.ts)).
- **Gap:** no export of an approved Plan as Playwright tests, and no way to author a test from plain language or a recording. The user cannot "write a test for my checkout" and keep it.
- **Applies to:** Website first. Phone apps need a different driver, and the plain-language layer would be shared.
- **Verdict: Build now** for the Plan-to-Playwright export (decided in the brief). **Build later** for plain-language authoring. Both existing approaches (Cypress, Playwright agents) depend on the user's AI tool or a cloud account.

### 3.3 Light requirements traceability

- **What leading tools do:** Playwright lets tests carry tags and custom annotations such as an `issue` link, and these show in reports ([docs](https://playwright.dev/docs/test-annotations)). Full test-management tools (Xray, TestRail) are cluster 02.
- **QA Tool today:** Product Context and Requirements are in the domain model ([CONTEXT.md](../../../CONTEXT.md)), and `spec-conformance` checks expected URLs, text and element states. I did not verify a link from a Requirement to a Plan Item in code *(unverified)*.
- **Gap:** a report line saying "Requirement X: covered by these 3 tests, last passed today".
- **Verdict: Build later.** Carry a requirement ID as a Playwright tag in the export, and list covered and uncovered requirements in the report. Skip a test-management product.

### 3.4 Self-healing selectors

- **What leading tools do:**
  - Playwright's healer "executes the test suite and automatically repairs failing tests" by replaying and inspecting the UI ([docs](https://playwright.dev/docs/test-agents)).
  - Stagehand's `act()` "adapts" when a site is redesigned *(vendor claim)* ([repo](https://github.com/browserbase/stagehand)).
  - Momentic charges 2 credits for a step an AI action or failure recovery produces, against 1 for a normal step ([pricing](https://momentic.ai/pricing)). Healing costs money each time it fires.
- **QA Tool today:** nothing. A step whose selector is gone fails. The only "repair" in the code is for malformed AI JSON ([ai-planner.ts](../../../packages/core/src/plan/ai-planner.ts)).
- **Gap:** a failed selector is reported as a bug in the App, when it may be a Plan that went stale.
- **Applies to:** Website. Phone apps: accessibility ids make this easier. Desktop: not yet.
- **Verdict: Build later.** It matches the brief's rule: AI proposes a fix, a person approves it, and the test stays deterministic afterwards. It only matters once Plans are saved and re-run, which waits on the export.

### 3.5 Regression runs, change-based and risk-based selection

- **What leading tools do:**
  - Playwright has `--only-changed` ("only run test files that have been changed"), `--last-failed` and `--shard` ([CLI](https://playwright.dev/docs/test-cli)).
  - Cypress Cloud's Business plan adds spec prioritisation and auto-cancellation ([pricing](https://www.cypress.io/pricing)).
  - Meticulous replays real sessions against each pull request *(vendor claim)* ([site](https://www.meticulous.ai)).
- **QA Tool today:** every check-up re-scans from scratch. Site Memory and site history are saved between check-ups ([site-memory.ts](../../../packages/core/src/site-memory.ts), [site-history.ts](../../../packages/core/src/site-history.ts)), and the Report Hub tracks findings across releases. I found nothing that chooses which Plan Items to re-run.
- **Gap:** a "re-run only what changed or failed" mode. `qa-test verify <finding>` already re-runs one finding.
- **Verdict: Build later.** A cheap first version is "re-run the items that failed last time, plus pages whose content hash changed" using Site Memory. Skip AI-assisted prioritisation: a small site's whole Plan runs in minutes.

### 3.6 Flaky-test detection, quarantine and retries

- **What leading tools do:**
  - Playwright retries failures and labels a pass-on-retry "flaky". It has `--fail-on-flaky-tests` and records traces on the first retry ([retries](https://playwright.dev/docs/test-retries), [CLI](https://playwright.dev/docs/test-cli), [trace viewer](https://playwright.dev/docs/trace-viewer-intro)).
  - Trunk quarantines flaky tests on its free plan for up to 5 committers ([pricing](https://trunk.io/pricing)). Currents starts at $49 a month, and BuildPulse at $99 ([Currents](https://currents.dev/pricing), [BuildPulse](https://buildpulse.io/pricing)). Cypress Cloud's flake detection starts at its $799 a year plan ([pricing](https://www.cypress.io/pricing)).
- **QA Tool today:** `RetryRunner.runWithCleanRetry` returns `PASSED`, `FLAKY_PASSED` or `FAILED` ([retry-runner.ts](../../../packages/core/src/retry-runner.ts)). I found no caller outside its own file and tests under `packages/*/src`, so a check-up does not seem to use it. The Hub's `flakyFlowsCount` is a hard-coded `0` (`db.ts`, `ui.ts` in historical `packages/hub`, retired in ADR 0005/0008). Only the glossary and the type exist ([CONTEXT.md](../../../CONTEXT.md)).
- **Gap:** the model is ahead of the product. Wiring it in is the gap. Quarantine across check-ups is not built.
- **Applies to:** every App. Phone apps are flakier (device state, animations), so this matters more there later.
- **Verdict: Build now** for wiring Clean Flow Retry and "flaky passed" into the report. **Skip** a standalone quarantine service. The dashboards above exist for large suites, and a Plan of 400 tests doesn't need one.

### 3.7 Test analytics

- **What leading tools do:** Currents and Cypress Cloud chart duration, failure rate and flake rate by test ([Currents](https://currents.dev/pricing), [Cypress](https://www.cypress.io/pricing)). Checkly adds AI root-cause analysis, from 10 uses a month on its free plan ([pricing](https://www.checklyhq.com/pricing/)).
- **QA Tool today:** six area scores, "Ready to release" or "Not ready yet", and a Report Hub that tracks findings (open, fixed, came back, accepted risk).
- **Gap:** no per-test history, such as "this journey got slower for 3 releases".
- **Verdict: Build later**, from data the Hub already holds. **Connect** for round-the-clock monitoring: point to Checkly's free plan, as cluster 06 does.

### 3.8 Autonomous AI explorers, and keeping them safe and repeatable

- **What leading tools do:**
  - Playwright MCP gives an agent a browser. Its own repo says it "is not a security boundary" ([repo](https://github.com/microsoft/playwright-mcp)).
  - Stagehand caches repeated calls so the same instruction doesn't call the model again, but caching runs through Browserbase's cloud ([repo](https://github.com/browserbase/stagehand)).
  - Vendors say little about guardrails beyond "runs in a sandbox" *(vendor claim)*. I found no vendor that publishes an action allow-list.
- **QA Tool today:** an AI explorer is not built. The safety base is: forms are sent only on a Test Copy, and a Safety Filter pauses forbidden actions ([CONTEXT.md](../../../CONTEXT.md)).
- **Gap:** an opt-in explorer for Test Copies, as decided.
- **Applies to:** Website. Phone apps: Firebase Robo and Monkey are the non-AI versions (cluster 07).
- **Verdict: Build later.** The existing Safety Filter, Test Copy and Verified Domain rules are a better safety story than the tools above. Keep two rules: the explorer only runs on a Test Copy, and everything it does is recorded as a Plan so the next run is deterministic.

### 3.9 Export to Playwright code

- **What leading tools do:** Playwright is the common ground. QA Wolf runs open-source Playwright and says tests can be exported *(vendor claim)* ([pricing](https://www.qawolf.com/pricing)). Autify Nexus and Checkly are built on it ([Autify](https://www.autify.com/pricing), [Checkly](https://www.checklyhq.com/pricing/)). Octomind kept its tests as YAML, pulled and pushed through a CLI, and the company has now gone ([repo](https://github.com/OctoMind-dev/cli)). That is a lock-in case worth citing.
- **QA Tool today:** the one-off repro script only (3.2).
- **Gap:** the whole Plan, per role, with locators chosen the way codegen does ("role, text and test id" first) ([docs](https://playwright.dev/docs/codegen)), credentials as environment variables, and storage state per role ([auth docs](https://playwright.dev/docs/auth)). The existing `credentials.ts` already swaps typed sign-in details for placeholders ([credentials.ts](../../../packages/core/src/credentials.ts)).
- **Applies to:** Website. Phone apps and desktop get their own driver's format.
- **Verdict: Build now.** It is the exit door that makes a source-available tool safe to adopt, and the cheapest feature on this list.

### 3.10 Test data: seeding, synthetic data, isolation, cleanup, inboxes

- **What leading tools do:**
  - Playwright's own guidance: one account for read-only tests, one account for each parallel worker (by `parallelIndex`) when tests change data ([auth docs](https://playwright.dev/docs/auth)).
  - Test inboxes: Mailosaur from $20 a month (SMS is an add-on), MailSlurp free for 500 emails a month, with SMS on Pro ([Mailosaur](https://mailosaur.com/pricing), [MailSlurp](https://app.mailslurp.com/pricing/)). Functionize includes email and SMS testing on its free plan ([pricing](https://www.functionize.com/pricing)).
- **QA Tool today:** the building blocks exist as library code: an Account Pool, Entity Namespacing, and per-worker context isolation ([account-pool.ts](../../../packages/core/src/account-pool.ts), [entity-namespacing.ts](../../../packages/core/src/entity-namespacing.ts)). Both are exported from the core index. I found no use of either in `orchestrator.ts`, so I can't confirm they run in a check-up *(unverified)*. There are no inbox integrations.
- **Gap:** seed and cleanup hooks, and an inbox. Neither is available to a user today.
- **Applies to:** every App. Test Copy only. A live site gets no data written.
- **Verdict:** **Build later** for namespaced create and cleanup on Test Copies. **Connect** for inboxes (MailSlurp's free plan first), and **Skip** building our own.

### 3.11 Signed-in flows

What the QA Tool does now:
- A role's email and password go through a form sign-in that finds the password field, fills the form, submits it and saves the session as Playwright storage state ([preflight.ts](../../../packages/core/src/preflight.ts)).
- Pages that send a visitor to a sign-in form are listed as "not reached", and a role whose sign-in failed is named ([discovery-agent.ts](../../../packages/core/src/discovery/discovery-agent.ts)).
- I found no handling of CAPTCHA, one-time codes or magic links in `packages/*/src`.

Early users ask for "signed-in flows", yet their apps use email and password, which already works. The request could mean one of three things.

| Meaning | What would be happening | What it would need | Verdict |
|---|---|---|---|
| **A. Hard to find or set up** | Users don't realise roles exist, or the sign-in form isn't recognised (custom page, username on a first step, a modal, an SPA that never navigates). The check-up quietly reports "not reached". | Better prompts and wording in the wizard. A "test this sign-in" button. Handling for two-step forms and modals. Clear "sign-in failed because…" messages. | **Build now.** Mostly interface and detection work, with no new infrastructure. |
| **B. Sign-in gets blocked** | The site's bot protection, CAPTCHA or rate limit rejects an automated browser. Two-factor, magic links and email codes also block it. | Test Copy first: use vendor test keys, disable the check, or add a test-only bypass. Turnstile has dummy sitekeys that always pass and a forced-challenge key ([docs](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)). reCAPTCHA v2 has a test key pair that always passes and shows a warning banner ([FAQ](https://developers.google.com/recaptcha/docs/faq)). A TOTP secret can generate codes inside a test ([Checkly guide](https://www.checklyhq.com/docs/learn/playwright/bypass-totp/)). Email links and codes need an inbox (3.10). On live sites: the owner can skip bot rules for a runner's IP or header, except Cloudflare's free Bot Fight Mode ([docs](https://developers.cloudflare.com/waf/custom-rules/skip/)). | **Build later**, in this order: tell the user what blocked us, test keys on Test Copies, then TOTP. **Skip** solving CAPTCHAs: it conflicts with deterministic tests and with bot-protection terms *(unverified: I did not read each vendor's terms)*. |
| **C. Signed-in tests are too shallow** | Sign-in works and the crawl reaches pages, but the tests only look at pages. They never create an order, change a setting or finish a flow, because forms are sent only on Test Copies. | Test Copy marking, data seeding and cleanup (3.10), more journeys planned per role, and role-aware checks. This is the same work as the Plan export and test data. | **Build now** for the first parts (journeys, namespaced data on Test Copies). Matches the "web depth" order. |

Playwright 1.61 added WebAuthn passkey support through a virtual authenticator ([release notes](https://playwright.dev/docs/release-notes)). That is a possible later route for passkey sign-in.

**Questions for early users** (ask for a real example of each, not an opinion):
1. Show me the last time you wanted to test a signed-in page. What did you try, and what happened? (separates A, B and C)
2. How do your users sign in: email and password only, or also Google, magic link, a code, or an authenticator app?
3. Does the QA Tool say "not reached" for your signed-in pages, or does it get in and miss things? Does the text on screen tell you which?
4. Is there a CAPTCHA, a Cloudflare challenge or a rate limit on your sign-in form? On staging as well as production?
5. Do you have a staging copy where you can add a test account, a test key or an off switch?
6. What would "deep enough" be? Name the three things a signed-in user does that you most fear breaking.
7. Do you have more than one role, and would you create a test account for each?
8. Would you accept a test account's email being a shared inbox the tool can read?

## 4. Trends and openings (2025-2026)

1. **Playwright is now the shared base.** It ships its own agents (v1.56), and agent-oriented features keep arriving: a CLI debugger for agents in 1.59 and HAR recording as a tracing API in 1.60 ([release notes](https://playwright.dev/docs/release-notes)). QA Wolf, Checkly, Autify Nexus and Currents all build on it. Output as Playwright code is no longer a bonus. It is what the market expects.
2. **Agent-first, bring-your-own-AI-tool is the new onboarding.** Playwright's agents need VS Code, Claude Code, Codex or OpenCode ([docs](https://playwright.dev/docs/test-agents)). QA Wolf asks users to connect their coding agent ([docs](https://docs.qawolf.com)). Opening: they expect a developer at a terminal. A browser-only tool with a plain verdict reaches founders who don't use one.
3. **AI testing now has a free entry level.** Momentic (2,000 credits a month), Functionize (800,000 credits a month) and Autify (2,000 one-time credits) all have free plans, and Checkly's Hobby plan is free ([Momentic](https://momentic.ai/pricing), [Functionize](https://www.functionize.com/pricing), [Autify](https://www.autify.com/pricing), [Checkly](https://www.checklyhq.com/pricing/)). Their free plans run out quickly under credit pricing, because each step costs credits. A free tier will have to be measured in check-ups and not in steps.
4. **Vendor risk is real.** Octomind shut down in 2026 after a user's tests lived in its format and on its servers. Testim and Reflect were absorbed by larger companies. A source-available tool with a Playwright export has a story none of them can tell.
5. **More code is being written by AI, and trust is low.** In the 2025 Stack Overflow survey, 84% of respondents use or plan to use AI tools, only 3.1% "highly trust" the output, and 72% say vibe coding is not part of their workflow ([survey](https://survey.stackoverflow.co/2025/ai)). The 2025 DORA report calls AI "an amplifier" of strengths and weaknesses ([report](https://dora.dev/research/2025/dora-report/)). Neither source says AI-built apps ship more bugs. Claims that most Lovable apps ship with Supabase row-level security off, or that thousands of Lovable projects were exposed for 48 days in April 2026, come from a secondary advisory site and one search summary *(unverified)* ([advisory](https://pranava0x0.github.io/vibe-coding-security/advisories/ongoing-vibe-platform-exposure.html)). The demand story is plausible but I have no primary source for it. Ask early users whether they build with Lovable, Bolt, Replit, v0 or Cursor.
6. **Pricing by credit rewards flat cost.** Momentic's per-step credits and QA Wolf's 15 cents per runner minute both grow with use ([Momentic](https://momentic.ai/pricing), [QA Wolf](https://www.qawolf.com/pricing)). A "check-ups per day" limit is easier for a small team to predict.

## 5. Fit with the limits

- **$0 hosting:**
  - The crawler, planner, export and flaky wiring need no extra servers. A check-up already runs on a free machine.
  - AI discovery and plain-language authoring would cost model calls. They stay behind the user's own key, after the first check-up, as decided.
  - Hosted-browser competitors charge by minute. We can't match that on free machines, so keep Plans small and caps visible.
- **Browser-only:** Playwright export is a file download. TOTP and test-key handling happen inside the check-up's browser session. Nothing is installed, unlike Playwright's agents, which need an editor and an AI tool.
- **Teams without QA staff:** the report should say "your sign-in is blocked by a CAPTCHA, so signed-in pages weren't checked" and not "storage state failed". Healing, flaky counts and analytics belong in developer detail.
- **Deterministic tests:** every AI step in this file (healing, authoring, explorer) ends in a saved Plan item a person approved. Stagehand and similar tools do not promise that.
- **Risks and conflicts:**
  - Test keys (Turnstile, reCAPTCHA) work only if the site's owner turns them on for the Test Copy. Turnstile test keys work on localhost and development domains, so they suit a Test Copy but not a live site ([docs](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)).
  - A TOTP secret is as sensitive as a password. It would have to live in the OS keychain next to the sign-in password, like the existing secret handling ([key-resolver.ts](../../../packages/core/src/ai/key-resolver.ts)).
  - Playwright says a storage-state file "may contain sensitive cookies and headers that could be used to impersonate you" ([auth docs](https://playwright.dev/docs/auth)). A hosted runner must not keep or export these, and an exported Plan must never include one.
  - A Plan export promises something users will hold us to. Generated code must run as is.

## 6. Open questions

1. Which of the three signed-in meanings (3.11) do the early users mean? Ask the eight questions. Don't build until two or more users give the same example.
2. Do users run staging copies, or only production? That decides how much of 3.10 and 3.11 B and C they can use.
3. Do early users already have Playwright or Cypress suites? That decides export format and whether import comes sooner.
4. Would a user rather get Playwright files, a GitHub pull request, or a CI snippet?
5. How many AI calls is the first free check-up worth? Plain-language authoring and an explorer would add to it.
6. Should a selector fix apply on approval to a saved Plan, or only to the exported code?
7. Do any users build with AI app builders (Lovable, Bolt, Replit, v0, Cursor)? If so, which kinds of failure did they hit?
8. Where do `RetryRunner`, `AccountPoolManager` and Entity Namespacing run today? The builder should confirm what 3.6 and 3.10 say I couldn't find.

## 7. Sources

- Repo code: [preflight.ts](../../../packages/core/src/preflight.ts), [deterministic-spider.ts](../../../packages/core/src/discovery/deterministic-spider.ts), [discovery-agent.ts](../../../packages/core/src/discovery/discovery-agent.ts), [repro-generator.ts](../../../packages/core/src/repro-generator.ts), [retry-runner.ts](../../../packages/core/src/retry-runner.ts), [account-pool.ts](../../../packages/core/src/account-pool.ts), [entity-namespacing.ts](../../../packages/core/src/entity-namespacing.ts), [credentials.ts](../../../packages/core/src/credentials.ts), [site-memory.ts](../../../packages/core/src/site-memory.ts), [site-history.ts](../../../packages/core/src/site-history.ts), [ai-planner.ts](../../../packages/core/src/plan/ai-planner.ts), [key-resolver.ts](../../../packages/core/src/ai/key-resolver.ts), `db.ts` / `ui.ts` (historical `packages/hub`, retired in ADR 0005/0008), [CONTEXT.md](../../../CONTEXT.md)
- Playwright: https://playwright.dev/docs/test-agents · https://playwright.dev/docs/release-notes · https://playwright.dev/docs/test-cli · https://playwright.dev/docs/test-retries · https://playwright.dev/docs/codegen · https://playwright.dev/docs/auth · https://playwright.dev/docs/trace-viewer-intro · https://playwright.dev/docs/test-annotations · https://github.com/microsoft/playwright-mcp
- Cypress: https://www.cypress.io/pricing · https://docs.cypress.io/api/commands/prompt
- AI testing platforms: https://momentic.ai/pricing · https://www.qawolf.com/pricing · https://docs.qawolf.com · https://www.mabl.com/pricing · https://www.mabl.com/blog · https://www.autify.com/pricing · https://www.functionize.com/pricing · https://smartbear.com/product/reflect/pricing/ · https://ghostinspector.com/pricing/ · https://www.meticulous.ai · https://testrigor.com/sign-up/ · https://www.rainforestqa.com/pricing · https://github.com/browserbase/stagehand · https://www.capterra.com/p/165430/Testim/
- Octomind: https://vostride.com/product-comparison/agent-qa-vs-octomind · https://octomind.dev/blog/a-letter-to-our-users-customers-and-readers/ (not reachable) · https://github.com/OctoMind-dev/cli · https://github.com/OctoMind-dev
- Monitoring and flaky tools: https://www.checklyhq.com/pricing/ · https://currents.dev/pricing · https://trunk.io/pricing · https://buildpulse.io/pricing
- Test inboxes: https://mailosaur.com/pricing · https://app.mailslurp.com/pricing/
- Sign-in blockers: https://developers.cloudflare.com/turnstile/troubleshooting/testing/ · https://developers.google.com/recaptcha/docs/faq · https://developers.cloudflare.com/waf/custom-rules/skip/ · https://www.checklyhq.com/docs/learn/playwright/bypass-totp/
- Trends: https://survey.stackoverflow.co/2025/ai · https://dora.dev/research/2025/dora-report/ · https://pranava0x0.github.io/vibe-coding-security/advisories/ongoing-vibe-platform-exposure.html (secondary, not opened)
