# Product review: Release check-up (QA Tool)

Sep 30, 2026 · A fresh end-to-end review covering user flow, logic flow, AI token use, UI/UX and the flows between
screens. It is based on live check-ups and on reading the code. Each item is marked **Issue** (broken, wrong or
untrustworthy) or **Enhancement** (would make the product better). Each also has a severity (Blocker / Major / Minor), an
effort estimate (S / M / L), the evidence and a suggested fix.

## How this was reviewed

- **Live check-ups** ran through the runner API and the built wizard at `localhost:3301`:
  - **Fixture app** (`localhost:3050`, a test copy with 4 planted defects): full check-up covering scan, plan,
    approval, 60 tests and the report (about 3 min of testing).
  - **books.toscrape.com** (live site, so only looked at, with the page limit set to 60): scan and plan only. Testing
    was stopped because the plan held 603 tests.
- **AI token use** was measured with temporary logging on every AI request (removed afterwards). The raw log is
  `.review-shots/ai-calls.jsonl`.
- **Screenshots** of every wizard screen at 1440 px and 375 px are in `.review-shots/` (not committed). The script
  also measured horizontal overflow, text under 12 px and tap targets under 24 px.
- **Limits of this review:**
  - The saved OpenRouter key had **3 of 50** free requests left today, and none of them produced a usable answer
    (see T1). So the quality of AI-written plans couldn't be judged; every plan reviewed was made by fixed rules.
  - Sign-in flows (saucedemo) weren't run live. They were reviewed from the code.
  - The CLI, dashboard and Report Hub were not exercised.
- **Files that changed during the review:** App.tsx, TestingScreen, SiteMap, ReportScreen, server.ts,
  orchestrator.ts and browser.ts were edited by someone else while the review ran. I read those diffs; they don't
  change any finding below. The one new concern they raise is listed as L7.

## What works well

- **Fixed rules alone found all 4 planted defects** in the fixture: the console error, the HTTP 500, the dead-end page
  and the 20 × 20 px tap target. They also found a real extra problem: the sign-in form sends passwords in the page
  address.
- **The flow's safety model is clear.** Nothing runs before approval, the live site is only looked at, stopping always
  asks first, and a plan survives a failed or stopped run.
- **The wording is calm and plain almost everywhere.** Focus rings, skip link, reduced-motion handling and
  status/alert roles are all in place. No screen overflowed sideways at 375 px, except the one noted in U9.
- **The planner's prompts are small.** Page-planning prompts were 583–872 tokens. The token problem is on the output
  side (T1, T3).

---

## Fix first (top 10)

| #   | Item                                                                                                                           | Type        | Severity | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------- | ------ |
| 1   | [T1](#t1) The chosen free model spends its whole output allowance on hidden reasoning, so every plan falls back to fixed rules | Issue       | Blocker  | S      |
| 2   | [F1](#f1) A sign-in can only be added after a whole check-up, through "Go deeper"                                              | Issue       | Major    | M      |
| 3   | [L1](#l1) "What to improve first" ranks SEO nits above an HTTP 500 Blocker                                                     | Issue       | Major    | S      |
| 4   | [U1](#u1) The plan asks the same form question once per page (112 times on a 60-page shop)                                     | Issue       | Major    | S      |
| 5   | [L2](#l2) Site-wide SEO checks swamp the report (56 of 79 findings on a localhost app)                                         | Issue       | Major    | M      |
| 6   | [F2](#f2) A finding can't be marked "intended" or "not a problem" from the UI                                                  | Enhancement | Major    | M      |
| 7   | [T2](#t2) Nothing records AI token use, and the AI notes blame the wrong cause                                                 | Issue       | Major    | S      |
| 8   | [U8](#u8) The report's counts contradict each other ("18 must be fixed" above a list of 8)                                     | Issue       | Major    | S      |
| 9   | [P1](#p1) The plan response is 1.8 MB for 60 pages and is fetched again after every change                                     | Issue       | Major    | S      |
| 10  | [T4](#t4) The "finish the AI review" endpoint uses a paid default model and skips the budget                                   | Issue       | Major    | S      |

---

## 1. Token usage efficiency

### <a id="t1"></a>T1. The chosen free model spends every output token on hidden reasoning (Issue · Blocker · S)

- **Evidence (fixture run):** all 3 requests went to `dots-studio/dots-3-note-preview:free`. Each one returned
  `completion_tokens: 4096` and about 4,280 `reasoning_tokens`, with `finish_reason: "length"` and **0 characters of
  answer**. The repair request resent the same prompt under the same 4,096-token limit and failed the same way. In
  total, about 14,500 tokens were spent and none of them produced plan output.
- **Why it happens:**
  - The model is picked by JSON support, then "reasoning not mandatory", then context length
    ([openrouter.ts:143-146](packages/core/src/ai/openrouter.ts#L143-L146)). A model can reason even when reasoning
    isn't mandatory.
  - `max_tokens` stays at the default of 4096 ([openai.ts](packages/core/src/ai/providers/openai.ts)).
  - `finish_reason` is never read, so a cut-off answer is treated as bad JSON and "repaired" with the same limit
    ([ai-planner.ts:433-471](packages/core/src/plan/ai-planner.ts#L433-L471)).
- **Fix:**
  - Send `reasoning: { exclude: true }` or `effort: "low"` where OpenRouter supports it, and raise `max_tokens` for
    planning.
  - When `finish_reason === "length"` and the answer is empty, skip the repair: switch model or split the batch.
  - Rank models by how well they have actually done: keep a success rate per model in the data dir and demote a model
    after a truncated answer.
  - Let people choose the model in Settings (see U12).

### <a id="t2"></a>T2. Token use is never recorded, and failures are blamed on the wrong cause (Issue · Major · S)

- **Evidence:**
  - `AIProvider.generateText` returns only a string ([ai-provider.ts](packages/core/src/ai/ai-provider.ts)), so usage
    is thrown away.
  - The plan's notes said "The AI Request Budget ran out" and "The AI couldn't plan 3 items". The real cause was
    truncation. Someone who waits until tomorrow and re-plans will hit the same wall.
  - The three counts in the notes disagree with each other: "19 items" in the summary, "8" + "3" in the notes, and
    `overBudget: 10` in the budget.
- **Fix:**
  - Return `{ text, usage, finishReason, model }` from providers.
  - Add the tokens used for each stage (planning, repair, journeys, visual review, interpret) to the plan and the
    report's developer details.
  - Name the real cause in the plan's notes ("The AI model stopped before answering: try another model in Settings").
  - Compute every count from one place.

### <a id="t3"></a>T3. Output tokens go to text that fixed rules can write (Enhancement · Major · M)

- **Evidence:**
  - The pages prompt asks the AI to write a name and an expectation for **every** link on every page: up to 40 per
    page, 3 pages per request ([ai-planner.ts:318](packages/core/src/plan/ai-planner.ts#L318)).
  - Any link left out triggers a full repair that resends the whole conversation
    ([ai-planner.ts:526-527](packages/core/src/plan/ai-planner.ts#L526-L527)).
  - `defaultNavigationName` already writes perfectly good names such as "“Pricing” opens /pricing".
- **Fix:**
  - Stop asking for link names. Ask only for tests, plus an expectation for links where the destination's title isn't
    already known.
  - Treat missing link entries as "use the default name", not as a reason to repair.
  - Result: the output needed per request should drop severalfold and far fewer repairs should be triggered.

### <a id="t4"></a>T4. "Finish the AI review" uses a paid default model and skips the budget (Issue · Major · S)

- **Evidence:**
  - `handleAiFinish` calls `createAIProvider('openrouter', key)` with no model and no `PacedAI`
    ([server.ts:991](packages/runner/src/server.ts#L991)).
  - The provider's fallback model on OpenRouter is `anthropic/claude-sonnet-5`, which is paid
    ([openai.ts](packages/core/src/ai/providers/openai.ts)).
  - Nothing in the wizard calls `/api/runner/ai/finish` today ([api.ts:383](packages/wizard/src/api.ts#L383)), so this
    is a dead feature with a cost trap waiting in it.
- **Fix:** pass the stored vision model, wrap the call in `PacedAI` with the remaining budget, and either add a button
  for it on the report or remove the endpoint.

### T5. Repeated and padded prompt content (Enhancement · Minor · S)

- **Evidence:**
  - The full product context is repeated in every page batch and in the journeys prompt
    ([ai-planner.ts:299-308](packages/core/src/plan/ai-planner.ts#L299-L308)).
  - The journeys prompt pretty-prints its JSON with `null, 2` and lists every form on every page, including a shared
    search form repeated once per page ([journeys.ts:65-90](packages/core/src/plan/journeys.ts#L65-L90)).
  - It still asks for `siteType`, which `site-type.ts` already works out without the AI.
- **Fix:**
  - Send compact JSON.
  - Merge forms that are identical across pages.
  - Cap long product context, or send only the parts relevant to the batch.
  - Drop `siteType` from the prompt.

### T6. The budget is shown too late and doesn't count repairs (Issue · Major · S)

- **Evidence:**
  - The scan started with 3 requests left and about 5 needed. Nothing warned before the start; the shortfall first
    appeared on the scanning screen once planning had already begun.
  - "About 5" doesn't include repairs (up to 2× per batch) or the visual review, which can use up to 20 more.
  - The default page limit is 200 while the daily allowance is 50 requests.
- **Fix:**
  - Show the estimate on the new check-up screen, before "Scan the site": "This needs about N AI requests, you have M
    left today."
  - Offer "Plan with fixed rules now and re-plan with the AI later" as an explicit choice.
  - Include the repair and visual-review headroom in the estimate.

---

## 2. User flow

### <a id="f1"></a>F1. A sign-in can only be added after a whole check-up (Issue · Major · M)

- **Evidence:**
  - The new check-up form has no sign-in fields
    ([NewCheckupScreen.tsx](packages/wizard/src/screens/NewCheckupScreen.tsx)).
  - The plan says "Pages behind the sign-in were not reached (/account). Add a sign-in to test them.", but the Plan
    Review has no way to add one, even though `approvePlan` accepts `roles`
    ([api.ts:303](packages/wizard/src/api.ts#L303)).
  - The only route is the report's "Go deeper", which starts a second full scan and plan (spending AI budget twice)
    and supports exactly one role, hard-coded as `member` ([App.tsx:417](packages/wizard/src/App.tsx#L417)).
- **Fix:**
  - Add an optional "Test signed-in pages" section to the new check-up form, with one or more roles.
  - Put an "Add a sign-in" action on the plan's note, which crawls just the signed-in pages and adds them to the
    plan.
  - Keep "Go deeper" as a shortcut.

### <a id="f2"></a>F2. There's no way to mark a finding "intended" or "not a problem" (Enhancement · Major · M)

- **Evidence:** the report logic already hides findings with `triageStatus` set to Intended or False Positive
  ([summary.ts:174](packages/wizard/src/lib/summary.ts#L174)), but nothing in the wizard can set that status.
  Suppressions exist in core ([suppressions.ts](packages/core/src/suppressions.ts)).
- **Fix:** add a "Not a problem / Intended" action on each problem, with an optional reason. Remember it per site so
  the next check-up doesn't raise it again, and show the hidden count with an "undo" link.

### F3. Stopping throws work away (Issue · Minor · M)

- **Evidence:**
  - Stop scanning: "The pages found so far are thrown away."
  - Stop testing: "Results so far are thrown away." ([App.tsx:424-472](packages/wizard/src/App.tsx#L424-L472))
- **Fix:**
  - Stopping a scan should plan what was found.
  - Stopping testing should offer "Make a report from what's done", marked as a partial check-up.

### F4. Only one check-up at a time, across the whole tool (Enhancement · Minor · L)

- **Evidence:** starting a second site throws away the plan waiting for review (`ERR_PLAN_WAITING`,
  [App.tsx:318-328](packages/wizard/src/App.tsx#L318-L328)).
- **Fix:** allow at least one waiting plan per site, so reviewing site B doesn't discard the plan for site A.

### F5. Two checkboxes decide one thing (Enhancement · Minor · S)

- **Evidence:** forms are only sent when "I own this site" and "This is a test copy" are both ticked. On a live
  address, ticking "I own this site" on its own changes nothing, yet it looks like a permission.
- **Fix:** ask one question with three answers: "Only look at it", "It's a test copy I'm allowed to test fully", or
  "It's my live site (only look at it)".

---

## 3. Logic flow and correctness

### <a id="l1"></a>L1. "What to improve first" ranks SEO nits above a Blocker (Issue · Major · S)

- **Evidence (fixture):**
  - All 5 recommendations are SEO items: viewport, meta description, canonical, favicon and h1.
  - The Blocker (HTTP 500), the console error and the password-in-address finding don't appear there.
  - The "Must fix" list directly below puts the 500 first.
- **Fix:**
  - Rank by severity first, then by how many pages are affected, then by effort.
  - Always put Blockers first.
  - Cap each aspect at 2 of the top 5.

### <a id="l2"></a>L2. SEO, AEO and GEO checks swamp internal apps and test copies (Issue · Major · M)

- **Evidence:**
  - 56 of 79 findings on a localhost SaaS app were in Findable.
  - "Missing favicon" and "missing Organization schema" are raised once per page for what is a single site-wide fact.
  - Page-level SEO findings were also emitted at every screen size in the live feed.
- **Fix:**
  - Report site-wide facts (favicon, robots, schema) once per site.
  - Run page-head checks at one screen size only.
  - Make Findable opt-in, or down-weight it, on localhost, test copies and signed-in pages. Ask "Is this a public
    site?" once.

### L3. Paths are sometimes stored as full URLs, so one page counts as two (Issue · Minor · S)

- **Evidence:** the findings include `/dashboard` and `http://localhost:3050/dashboard` as separate `urlPath`s. As a
  result, the HTTP 500 and the console error each show as "2 pages".
- **Fix:** normalise `where.urlPath` in one place (the evidence writer or the orchestrator), and add a test for it.

### L4. The same problem is reported by two checkers (Issue · Minor · S)

- **Evidence:** "The page is missing a title" (axe accessibility) and "The page is missing a title tag for search
  engines" (SEO) are separate Must-fix entries for `/about`.
- **Fix:** give each such issue one cross-checker key (for example `doc-title`) so that grouping merges them, and list
  both aspects on the merged entry.

### L5. Grades don't match where the problems live (Issue · Minor · S)

- **Evidence:**
  - "Fast and mobile: A, 0 problems" sat next to a Major "missing mobile viewport tag" (filed under Findable) and 16
    tap-target findings (filed under Accessible).
  - "Looks and reads well: Not checked", even though the plan listed it as a graded check. It needs the AI visual
    review, and the budget was spent.
- **Fix:**
  - File viewport and tap-target findings under Fast and mobile.
  - In the plan, say up front when a graded area can't run: "Looks and reads well needs AI requests; none are left
    today."

### L6. The AI's guesses are labelled "until you confirm it", but there's no way to confirm them (Issue · Minor · S)

- **Evidence:** [PlanDocument.tsx:54](packages/wizard/src/components/plan/PlanDocument.tsx#L54) shows the label, and
  no control anywhere sets the expectation's `origin` to `user`.
- **Fix:** add a "Confirm" button, plus inline editing of the expected wording, next to each guess.

### L7. The new `select` fallback silently picks another option (Issue · Minor · S) · _code in progress_

- **Evidence:** the uncommitted change to [browser.ts](packages/core/src/browser.ts) falls back to any option that
  partly matches, and then to `options[1]`. The step still passes, even though a different value was chosen.
- **Fix:** record which option was actually chosen in the step result, and mark the test "Could not verify" when it
  wasn't the planned value.

---

## 4. UI/UX

### Plan Review

#### <a id="u1"></a>U1. The same question once per page (Issue · Major · S)

- **Evidence:** books.toscrape.com produced **112 identical questions**, "What should happen after someone fills in the
  form on <page> and sends it?". Every page has the same search form, the questions also cover pages covered by
  samples, and on a live site no form is ever sent.
- **Fix:**
  - Key questions by the form's layout fingerprint, not by page.
  - Ask nothing about forms on a live (look-only) site.
  - Ask only for pages that are actually tested.

#### U2. The plan is a single very long page (Issue · Major · M)

- **Evidence:** 5,472 px tall for the 8-page fixture, and **24,897 px** for 60 pages (3,151 DOM nodes). There's no
  search, no filter and no bulk switch ("skip every link on this page", "skip this layout group").
- **Fix:**
  - Put an overview first: counts per section, each expandable.
  - Add a filter box and "only show items that need me" (questions, guesses, fixed-rule items).
  - Add bulk toggles on group and page headers.
  - Collapse sections by default above about 20 items.

#### U3. Text and controls are much smaller than the rest of the app (Issue · Major · S)

- **Evidence:**
  - The app's base text is 18 px ("this audience reads"), but the plan uses 10 px uppercase mono badges, 11 px mono
    "Re-plan with the AI" links and 12 px text for steps and expectations.
  - The measurement found **459 text elements under 12 px** on the books plan, 41 on the fixture plan and 40 on the
    report.
  - Tap targets are small: item checkboxes are 16 × 16 px, the contents links are 16 px tall and question answers are
    about 24 px tall. That's below the 44 px the rest of the app keeps to, and below WCAG 2.5.8 (24 px) for the
    checkboxes.
- **Fix:**
  - Set a floor of 14 px for secondary text.
  - Make badges 12 px, not all caps.
  - Give every control on the plan a hit area of at least 24 px, and 44 px where it's the main action in its row.

#### U4. The sticky approval bar repeats the summary and takes over phone screens (Issue · Minor · S)

- **Evidence:** at 375 px the sticky bar covers about 22% of the screen and repeats "What approving runs", which is
  shown just above it ([plan-books-phone.png](.review-shots/plan-books-phone.png)).
- **Fix:** on phones, show a single line ("603 tests · Approve") that expands into the summary.

#### U5. Unclear wording and choices in the plan (Enhancement · Minor · S)

- Journeys are labelled "as anonymous" while the rest of the plan says "visitor".
- A question's answer can't be cleared once picked.
- "Re-plan everything with the AI" doesn't ask first and doesn't say how many requests it will use, even though it can
  discard edits.
- The tabs have `role="tab"` but no `tabpanel` or arrow-key support.
- The specs panel keeps its first text after a re-plan.

### Scanning and testing

#### U6. No sign of life during long AI requests (Issue · Minor · S)

- **Evidence:** planning showed "(0 of 5)" for about 90 seconds while two requests ran, and "Layouts 0" is shown for a
  site with no layout groups. The screen gives no hint that the AI is working, or that it failed and is repairing.
- **Fix:**
  - Stream "Asking the AI about /, /login… (try 2)".
  - Show the elapsed time for the current request.
  - Hide the "Layouts" counter when it's 0.

#### U7. The testing feed repeats itself and the map empties after a reload (Issue · Minor · S)

- **Evidence:**
  - The live feed showed each SEO problem three times, once per screen size, and six anonymous "A button is too small"
    lines.
  - After reloading mid-run, the map shows "1 page · 0 journeys", because the plan is only fetched while it's waiting
    for review ([App.tsx:164-175](packages/wizard/src/App.tsx#L164-L175)).
  - The page grows to about 2,000 px because the feed isn't scroll-contained.
- **Fix:**
  - Group the feed by problem, with a count and the sizes it was seen at.
  - Name the element ("“Home” link is too small").
  - Fetch the approved plan during testing.
  - Give the side panel its own scroll area.

### Report

#### <a id="u8"></a>U8. Counts that contradict each other (Issue · Major · S)

- **Evidence:** the header says "18 problems must be fixed first" and "79 problems found", while the list below shows
  **8** Must-fix entries and 15 entries in total (findings versus grouped problems). The "2 pages" on single-page
  problems comes from L3.
- **Fix:** count grouped problems everywhere a person reads a number ("8 must fix · 15 problems in all"), and keep
  the raw finding counts in the developer details.

#### U9. The order of sections and the map (Enhancement · Minor · M)

- The map takes 30 rem before the problem list. Its cards were cut off and its links ran off-canvas on the 8-page
  fixture ([report-desk.png](.review-shots/report-desk.png)).
- "Since the last check-up" comes after the recommendations.
- **Suggested order:** verdict → Must fix → Since last time → improvements → areas → map, collapsed or as a list by
  default.
- `[SEO]`/`[AEO]` tags show with literal brackets, and AEO/GEO mean nothing to most readers. Use "Search",
  "AI answers" and "AI search" instead, with a tooltip.
- Improvements hide their summary and fix whenever the text "looks technical"
  ([ReportScreen.tsx:335-336](packages/wizard/src/screens/ReportScreen.tsx#L335-L336)), which can leave only a
  title. Show a plain-language fallback instead of nothing.

#### U10. Problems don't say why they matter or how to fix them, unless you open developer details (Enhancement · Minor · M)

- **Evidence:** an expanded problem shows "Found on:" and then the developer details. Fixes only appear for the top 5
  recommendations.
- **Fix:** give every problem group one plain "Why it matters" line and one "How to fix" line, above the developer
  details.

### New check-up and Settings

#### U11. The page-limit field snaps back while you type (Issue · Minor · S)

- **Evidence:** `Number('') || DEFAULT_MAX_PAGES` means clearing the field to type a new number puts 200 straight back
  ([NewCheckupScreen.tsx:257](packages/wizard/src/screens/NewCheckupScreen.tsx#L257)).
- **Fix:** keep the raw text while typing and clamp it on blur or submit.

#### U12. Settings only holds the AI key (Enhancement · Major · M)

- **Evidence:**
  - There's no way to choose or change the model, even when the automatic pick fails (T1).
  - Only OpenRouter is offered: the wizard hard-codes `aiProvider: 'openrouter'`
    ([api.ts:193](packages/wizard/src/api.ts#L193)), although core supports Anthropic, OpenAI and Gemini (ADR 0002).
  - There are no default screen sizes, no saved sign-ins per site and no "public site?" default.
  - The page shows a spinner for up to 8 s while it asks OpenRouter for the usage count.
- **Fix:**
  - Add a model picker with a "Test this model" button.
  - Add a provider choice for people with a paid key.
  - Add per-site defaults.
  - Load the key status first and the usage count afterwards.

#### U13. Dark theme only (Enhancement · Minor · M) · _taste_

- `color-scheme: dark` is fixed, and there's no light theme or print style, even though reports are downloaded and
  shared.
- A light, printable theme for the report (and the downloaded HTML) is enough. The working screens can stay dark.

---

## 5. Overall flows and performance

### <a id="p1"></a>P1. The plan response is 1.8 MB and is fetched again after every change (Issue · Major · S)

- **Evidence:**
  - `GET /api/runner/plan` for 60 pages returned **1,789,214 bytes**. Of that, 81% is `pages[]`, which carries each
    page's full raw `elements` inventory (about 22 KB) and `links` (about 14 KB) that the screen never shows.
  - Every switch flipped (`patchPlan`) and every `PLAN_UPDATED` event fetches the whole plan again
    ([PlanReviewScreen.tsx:92-96](packages/wizard/src/screens/PlanReviewScreen.tsx#L92-L96),
    [App.tsx:215-220](packages/wizard/src/App.tsx#L215-L220)).
- **Fix:**
  - Leave the raw inventory out of the plan response (keep it on the server).
  - Have PATCH return only the items that changed.
  - Send only the map's edges to the map.

### P2. The test count grows fast (Enhancement · Minor · M)

- **Evidence:** 9 visited pages became 603 tests, with 190 link checks at 3 sizes.
- **Fix:**
  - Run shared-menu and footer link checks at one size, plus the menu-button path.
  - Show "about N minutes" next to the approval button.
  - Offer a "quick check" preset (desktop only, samples only).

---

## 6. Secondary surfaces

Not exercised in this review. The one runner endpoint issue found is T4. The CLI, dashboard and Report Hub should get
their own pass.

---

## Suggested order of work

1. **Make the AI answer at all:** T1, T2, T6 (then re-run this review with a working model to judge plan quality).
2. **Make the report believable:** L1, L2, L3, L4, U8, L5.
3. **Remove friction in the flow:** F1, U1, U2, U3, P1.
4. **Build trust over time:** F2, L6, U10, F3.
5. **Polish:** the remaining Minor items and enhancements.

---

## Resolution (Oct 1, 2026)

Every item above was addressed in the code.

**Live check (Oct 1, fixture app, OpenRouter free tier, `dots-3-note-preview:free`):**

- The AI planned every page in 4 requests, with none cut off and no fixed-rule items. The tests were sensible: empty-field validation on the forms, and pressing the dashboard's planted defect buttons.
- The journeys were the weak spot. One scan was cut off after the model spent 6,188 of its 8,192 tokens thinking. In another the model answered nothing and the fallback model's shared pool was busy. That led to two more fixes: a retry that asks for 3 shorter journeys, and moving straight to the next model when a pool is busy. On the third scan the AI planned 5 journeys and the whole plan used 5 requests.
- Testing found every planted defect, and "What to improve first" led with the HTTP 500 Blocker.
- The after-run visual review needed two fixes before it read any screenshots: it was reading them from the wrong folder, and it used the saved key instead of the run's key. It then looked at all 8 screens using 8 requests, and its notes were accurate.
- The AI review can now lower "Looks and reads well" only to a C, and asks for at most 3 issues per screen. With 30 opinions and no limit, it had failed the area. The decisions behind T1–T3 are recorded in [ADR 0011](docs/adr/0011-ai-asked-only-what-facts-cannot-say.md).

| Item | What changed                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | Planning asks for low, hidden reasoning and 8,192 answer tokens. A cut-off answer isn't repaired. A model that answers nothing is swapped for the next one mid-scan. Models are ranked with non-reasoning ones first, and one that keeps failing is moved last (a record is kept in the data folder). |
| T2   | Providers return tokens, finish reason and model. Tokens per stage are shown in the plan and the report's developer details. Each fixed-rule item records why it was planned by fixed rules, and the notes and summary count those items.                                                             |
| T3   | Link checks are named from the link text and destination. The AI is asked only about links to pages it didn't see, and a missing entry no longer triggers a repair.                                                                                                                                   |
| T4   | The visual review now runs after each check-up with the vision model, within the budget. "Finish the AI review" is a button on the report and is paced by the budget too.                                                                                                                             |
| T5   | Compact JSON, one entry for a form repeated across pages, product notes capped per request, and no `siteType` in the prompt.                                                                                                                                                                          |
| T6   | The new check-up screen shows the estimate (repairs and visual review included) against the requests left today. It also offers "Plan with fixed rules now, re-plan with the AI later".                                                                                                               |
| F1   | Sign-ins can be added on the new check-up form, one or more roles, and remembered per site in the keychain. The plan also has "Add a sign-in", which crawls just the signed-in pages.                                                                                                                 |
| F2   | Each problem has "Not a problem" and "It's intended" with an optional reason. The choice is remembered per site, and hidden problems are counted with an Undo.                                                                                                                                        |
| F3   | Stopping a scan offers "Stop and plan what's found". Stopping testing offers "Make a report from what's done", marked as partial.                                                                                                                                                                     |
| F4   | Starting a check-up of another site keeps the waiting plan aside; the new check-up screen lists it with "Open this plan".                                                                                                                                                                             |
| F5   | One question with two answers (test copies) or three (live-looking sites).                                                                                                                                                                                                                            |
| L1   | Ranked by severity, then pages, then effort. A Blocker always leads, and each area gets at most two of the top five.                                                                                                                                                                                  |
| L2   | Site-wide facts are reported once, and search checks run at one screen size. Search checks are off by default for test copies, with a remembered per-site choice. Broken links count under Works.                                                                                                     |
| L3   | Finding paths are normalised in one place in the orchestrator.                                                                                                                                                                                                                                        |
| L4   | Problems are grouped by their plain meaning across checkers, so a missing title is one problem.                                                                                                                                                                                                       |
| L5   | Viewport and tap-target findings count toward Fast and mobile. The plan says up front when "Looks and reads well" or "Findable" won't be graded.                                                                                                                                                      |
| L6   | Each AI guess has "Confirm" and "Change the wording"; the result is saved as the person's own.                                                                                                                                                                                                        |
| L7   | When another option than the planned one is picked, the test says so and is marked "Could not verify".                                                                                                                                                                                                |
| U1   | One question per form layout, only for tested pages, and none on a live site.                                                                                                                                                                                                                         |
| U2   | Overview cards, a find box, "Only what needs me", bulk switches on groups and pages, and long sections collapsed.                                                                                                                                                                                     |
| U3   | Plan text is at least 14 px, with 12 px badges. Checkboxes have 24 px hit areas and main controls 44 px. The map's 10 px labels are now 12 px.                                                                                                                                                        |
| U4   | On phones the approval bar is one line that opens into the summary.                                                                                                                                                                                                                                   |
| U5   | "anonymous" is shown as visitor, answers can be cleared, and "Re-plan everything" asks first with a request count. The tabs have a tabpanel and arrow keys, and the specs box follows a re-plan.                                                                                                      |
| U6   | The scan says which request is in flight, which try it is and how long it's taken. Layouts: 0 is hidden.                                                                                                                                                                                              |
| U7   | The feed is grouped by problem, with counts and sizes, and names small tap targets. The plan is fetched during testing, and the side panel scrolls on its own.                                                                                                                                        |
| U8   | The verdict counts grouped problems everywhere ("8 must fix · 15 problems in all"). Raw findings are in the developer details.                                                                                                                                                                        |
| U9   | New order: verdict, problems, since last time, improvements, areas, then the map, folded on bigger sites. The tags now read Search, AI answers and AI search, with tooltips. Plain fallbacks replace technical text.                                                                                  |
| U10  | Every problem has "Why it matters" and "How to fix" above the developer details.                                                                                                                                                                                                                      |
| U11  | The page limit keeps what's typed and is checked when leaving the box.                                                                                                                                                                                                                                |
| U12  | Settings covers the service, the model (with "Test this model"), default screen sizes and sites. The key status loads first and the usage after.                                                                                                                                                      |
| U13  | A light, printable view of the report, and print styles for the downloaded HTML.                                                                                                                                                                                                                      |
| P1   | The plan response leaves out each page's raw controls, and small changes return only what changed.                                                                                                                                                                                                    |
| P2   | Link checks run at one size, plus menu-button sizes. The approval bar shows "about N min", and a "quick check" preset is available.                                                                                                                                                                   |
