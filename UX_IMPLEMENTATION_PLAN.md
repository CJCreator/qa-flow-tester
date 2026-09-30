# Implementation Plan: One app and a smoother flow

Agreed in a grilling session on 2026-09-30. It turns a review of the app's screens and flow into three
phases of work:

1. **Dead ends and misleading screens.** Nobody gets stuck, loses what they typed, or is told something
   untrue.
2. **Navigation and history.** Every screen has an address, a top bar leads to past check-ups and
   settings, and every report is kept.
3. **One app.** QA Flow Studio's useful parts move into the Wizard as details for developers, and Studio
   is retired.

The decision to have one app is recorded in [ADR 0010](docs/adr/0010-one-app-with-details-on-demand.md),
which partly supersedes [ADR 0008](docs/adr/0008-single-local-server.md). The terms used here (Check-up,
Test Copy, Plan, Plan Item, Plan Review, Navigation Check) are defined in [CONTEXT.md](CONTEXT.md). The
look and the writing rules are in [DESIGN.md](packages/wizard/DESIGN.md).

## Status (as of 2026-09-30)

| Phase | What it delivers | Status |
|---|---|---|
| 1. Dead ends and misleading screens | Stopping keeps the plan, failures show, the AI key comes first, the live screen and the verdict tell the truth, plain words | Built. Task 1.12 skipped (see Deviations) |
| 2. Navigation and history | An address for every screen, the top bar, the Resume card, Past check-ups, Test again, site data out of git | Built. `sites/` is staged for removal from git, not yet committed |
| 3. One app | Details for developers, filters, the Team Hub link, Studio retired, every screen works on a phone | Built. The Docker image wasn't rebuilt |

Everything was built in one pass, uncommitted, on 2026-09-30. See "Deviations found while building" at the end for where it
differs from the tasks below, and the test run for what's covered.

Build order is 1, then 2, then 3. Phase 2's addresses are what Phase 3's report pages and redirects hang
off.

## Why

This is what the app did on 2026-09-30, found by reading the code. The Playwright connector was down, so
nothing was clicked through. The tasks below refer to these numbers.

**Where people get stuck or lose work**

- **F1.** Stopping a test run returns to the plan, but the runner has already deleted it
  ([server.ts:936-940](packages/runner/src/server.ts#L936-L940)), so "Approve" fails every time. The only
  way out is a new scan, which spends AI requests again.
- **F2.** A run that fails during testing is never shown. The live screen ignores `feed.failure` and keeps
  pulsing "LIVE" ([LiveMapScreen.tsx](packages/wizard/src/screens/LiveMapScreen.tsx)).
- **F3.** Without an AI key, "Scan Site & Build Plan" jumps to key setup, and the pasted specs, design
  notes, flows and page limit are lost ([App.tsx:247-251](packages/wizard/src/App.tsx#L247-L251)). The
  escape link there says "Keep my current key" when there is none, and loops back
  ([KeySetupScreen.tsx:120-124](packages/wizard/src/screens/KeySetupScreen.tsx#L120-L124)).
- **F4.** "Check another site" drops the report from the screen, and the runner keeps only the latest
  report, in memory ([server.ts:339](packages/runner/src/server.ts#L339)). There is no list of past
  check-ups.

**Navigation**

- **F5.** The current step lives in React state ([App.tsx:39](packages/wizard/src/App.tsx#L39)). Browser
  Back leaves the app, refresh guesses from the runner's phase, and nothing can be bookmarked.
- **F6.** "Back" often throws work away ([App.tsx:384-455](packages/wizard/src/App.tsx#L384-L455),
  [ScanningScreen.tsx:210-227](packages/wizard/src/screens/ScanningScreen.tsx#L210-L227)):
  - Step "1" in the top bar aborts a scan without asking.
  - The scan screen's "← Back to URL & Specs" also aborts; it duplicates the Stop button next to it.
  - "Back to the address" on the plan abandons the plan and its edits without a word.
  - The step bar is hidden below 768 px.
- **F7.** "Engineer view" jumps to Studio: another look, other words, other state.

**Screens that tell people the wrong thing**

- **F8.** The live screen's progress is made up
  ([LiveMapScreen.tsx:42-54](packages/wizard/src/screens/LiveMapScreen.tsx#L42-L54),
  [165-186](packages/wizard/src/screens/LiveMapScreen.tsx#L165-L186)):
  - The page shown as "checking" is whichever page was clicked, by default the first.
  - "Audits Running" is hard-coded and always lists 375, 768 and 1440 px.
  - The real "test 37 of 412" is already in `feed.progress` but never shown.
  - The events carry the page under test, a screenshot per step and each new finding's page
    ([orchestrator.ts:55-85](packages/core/src/orchestrator.ts#L55-L85)), and the screen ignores them.
- **F9.** The report contradicts itself:
  - One Major finding gives a red panel with a big "A · 98/100" beside a green "NOT READY YET" badge
    ([ReportMapScreen.tsx:50-53](packages/wizard/src/screens/ReportMapScreen.tsx#L50-L53)).
  - Every aspect starts at A 100, so an aspect that never ran scores A and lifts the average
    ([scoring.ts:48-55](packages/core/src/scoring.ts#L48-L55)).
  - On the map, clean pages look the same as untested ones.
- **F10.** The address box shows a fixed "https://", but a bare address is sent as `http://`
  ([UrlFirstScreen.tsx:42-49](packages/wizard/src/screens/UrlFirstScreen.tsx#L42-L49)).
- **F11.** Studio opens on three invented runs (one pre-selected), a fake product list and a hard-coded
  "Hub API Online" badge ([web/src/App.tsx:112-247](packages/web/src/App.tsx#L112-L247)).
- **F12.** Studio's "Run Suite on URL" has different rules from the Wizard:
  - It skips the Plan Review and defaults to a one-test check of `http://localhost:3000`.
  - It deletes any plan waiting for review ([server.ts:890](packages/runner/src/server.ts#L890)).
  - It scores with its own formula: 100 minus 20 per failed test.

**Words and looks**

- **F13.** The header reads "Direction B — Blueprint · Dark · Architectural"
  ([App.tsx:376-380](packages/wizard/src/App.tsx#L376-L380)), and the product goes by four names.
- **F14.** Jargon reaches the plain-language screens:
  - "GRID_LOCK:TRUE · PHASE:DISCOVERY", "LIVE EXECUTION INSPECTOR".
  - `[ERR_…]` codes under "Target Connection Failed", even for an empty box.
  - The report shows checker ids, CSS selectors and a `qa-test verify` command, and doesn't use the
    `plainTitle()` rewrites in [summary.ts](packages/wizard/src/lib/summary.ts).
  - Settings has two names, and an error points to an "AI key button at the top" that doesn't exist
    ([translate.ts:105-110](packages/wizard/src/lib/translate.ts#L105-L110)).
- **F15.** The theme is inconsistent:
  - The palette is dark but the page declares `color-scheme: light`
    ([index.css:7](packages/wizard/src/index.css#L7)), so native checkboxes, number fields and selects
    render light on dark.
  - DESIGN.md documents the old light palette.
  - The report hard-codes Tailwind colours instead of palette tokens.

**Phones and accessibility**

- **F16.** The live screen's side panel is a fixed 320 px, leaving the map about 55 px on a phone
  ([LiveMapScreen.tsx:149](packages/wizard/src/screens/LiveMapScreen.tsx#L149)). The phone test covers only
  the address and plan screens.
- **F17.** Report findings are clickable `<div>`s that keyboards can't reach
  ([ReportMapScreen.tsx:379-387](packages/wizard/src/screens/ReportMapScreen.tsx#L379-L387)), and several
  animations ignore reduced motion.

**Found while checking**

- **F18.** On a public address, the plan says "Mark it as a test copy if it is one"
  ([server.ts:237](packages/runner/src/server.ts#L237)), but no screen can. The runner accepts
  `stagingHost`; the Wizard never sends it. So a staging copy on a public domain can never be fully tested.
- **F19.** Site data is committed to git:
  - Site memory and history live in `sites/` under the working folder, which git doesn't ignore. 18 files
    are committed, including three real sites.
  - The history writer also ignores the runner's data folder
    ([orchestrator.ts:820](packages/core/src/orchestrator.ts#L820)), so in Docker it isn't on the volume.
- **F20.** Every run writes its report to the same folder (`.qa-runner-report`, 164 MB today), overwriting
  the last.
- **F21.** "Go deeper" doesn't reset the screen ([App.tsx:304-321](packages/wizard/src/App.tsx#L304-L321)):
  - The new scan's progress events are filtered out as another run's.
  - The step bar still opens the previous report.
  - The specs and page limit from the first run are dropped.

Also: six screens are unused (`TargetTypeScreen`, `UrlStep`, `RolesStep`, `MaterialsStep`,
`ProgressScreen`, `ReportScreen`), and so is the check-up slip (`Shell`, `Ledger`) that DESIGN.md called
the core concept. And "check" meant both a whole run and one Plan Item.

## Decisions

Decided with the user:

1. **One app.** The Wizard is the only front door, for everyone. Details for developers sit under each
   finding. `/studio` redirects, and `packages/web` is deleted once its useful parts have moved (ADR 0010).
2. **Moving around.**
   - A top bar on every screen: New check-up · Past check-ups · Settings, plus Team Hub when a Hub is
     connected.
   - Every screen has an address:
     - `/`: new check-up
     - `/check/scan`, `/check/plan`, `/check/testing`: the check-up in progress. The runner runs one at a
       time.
     - `/reports`: past check-ups
     - `/reports/<runId>`: one report, at an address that never changes
     - `/settings`: the AI key
   - Back, Forward, refresh and bookmarks work.
   - The step bar only shows where you are. Finished steps are links, the current step is highlighted,
     and later steps are greyed out.
   - Opening the app during a check-up shows a Resume card on `/` instead of jumping. `/` also lists
     recent check-ups.
3. **Past check-ups.**
   - Each run's report and evidence get their own folder.
   - The last 10 per site are kept, and older ones are deleted automatically. The grade history is kept
     for good.
   - Any check-up can be deleted by hand.
   - Site data moves to a folder git ignores. The committed files leave git but stay on disk.
4. **Stop and Back.** Nothing stops or deletes without asking, and the question says what will be lost.
   - Stopping a scan returns to `/` with everything still filled in.
   - Stopping testing keeps the approved plan and returns to it.
   - Leaving the Plan Review keeps the plan waiting.
   - Starting another check-up while a plan waits asks first.
5. **AI key.** With no working key, the key field comes first on the new check-up screen, and the address
   box follows on the same screen. Nothing typed is lost. The key lives at `/settings`, and "Keep my
   current key" shows only when there is one.
6. **Full testing or look-only.**
   - The owner box starts unticked for a site not checked before.
   - Once the address is checked, the screen says which kind of check-up it gets.
   - A live-looking address offers "This is a test copy".
   - Both choices are remembered per site.
7. **Test again.** Each report has a "Test again" button that scans again and reuses the approved plan. If
   nothing changed, testing starts without a review. If pages or links changed, it pauses and shows only
   what's new. Nothing runs that hasn't been approved.
8. **Live screen.**
   - The map stays, driven by the real events: the page under test, "Test 37 of 412 · about 6 minutes
     left", the latest screenshot, and problems pinned to their page.
   - Failures say what happened and what to do next.
   - The hard-coded panel goes.
9. **Verdict.**
   - The stamp is the one verdict, with its reason. The six aspect grades sit under it.
   - The overall letter and /100 score leave the screens.
   - An aspect that didn't run shows "Not checked" and doesn't count.
   - Findings are grouped Must fix before release, Should fix, Suggestions, with plain titles.
   - Every tested page on the map is coloured.
10. **Details for developers.**
    - Under each finding, collapsed: the screenshot, steps to reproduce, page and element, console errors,
      Copy bug report, Copy Playwright test, and the `qa-test verify` command.
    - Long lists get filters and search.
    - Accepting findings across runs stays in the Hub's own dashboard.
11. **Name and words.**
    - One name on screen: **Release check-up**.
    - A whole pass is a Check-up, so "check" keeps its CONTEXT.md meaning.
    - No prototype labels, codes or selectors on the plain-language layer, and settings has one name.
12. **Looks.**
    - Keep the dark Blueprint direction.
    - Fix `color-scheme`, move the report's colours to the palette, and bring DESIGN.md up to date.
    - Delete the unused screens and the check-up slip.
13. **Phones.** Every screen works at 375 px. The live screen drops the map on phones, and maps open in list
    view. The phone test covers every screen.
14. **Delivery.** First this plan, ADR 0010, and updates to DESIGN.md and CONTEXT.md. No code changes until
    the go-ahead.

## Defaults chosen while writing this plan

These weren't discussed. Change any of them before the phase that uses them starts.

- **Router:** a small history-based router of our own in `packages/wizard/src/lib/router.ts`, not a
  library. It does route matching, `navigate`, a `Link`, and Back and Forward through `popstate`.
  - The route table is fixed and short, like the static serving in ADR 0008.
  - The runner already answers every non-API address with the Wizard's page
    ([ui-static.ts:81-132](packages/runner/src/ui-static.ts#L81-L132)), so the server's routing doesn't
    change.
- **Address defaults:** a bare address on this computer or a private network (`localhost`, `127.x`,
  `10.x`, `192.168.x`, `*.local`) gets `http://`. Anything else gets `https://`.
- **Replacing a waiting plan:** `POST /api/runner/run` answers 409 `ERR_PLAN_WAITING` while a plan waits
  for review, unless the body has `replacePlan: true`. The Wizard asks first, then sends it. Until Studio
  goes, this also stops Studio's run button from deleting a waiting plan.
- **Studio stop-gap in Phase 1:** Studio's invented runs, fake product list and "Online" badge are deleted
  now, rather than living on until Phase 3.
- **Data folder:** the runner's data folder defaults to `.qa-data/` in the working folder (git-ignored),
  instead of the working folder itself. Docker already sets `RUNNER_DATA_DIR=/data` and is unaffected.
- **Per-run folders:** `<outputDir>/runs/<runId>/`. Saved sign-in sessions stay in `<outputDir>/auth/`,
  never under a run, and are still never served.
- **Overall grade:** `grades.overallGrade` and `overallScore` stay in `findings.json` and the history
  files, so nothing that reads them breaks. Only the screens, `report.html` and `report.md` stop showing
  them.
- **Team Hub:** the runner passes `/hub` on to the Hub, the way it does `/api/v1/*`. The Hub's dashboard
  calls `/api/v1/…` on its own address, so its triage buttons work through the same forwarding.
- **Filters:** shown when a report has more than 10 findings.

## Wording

Every visible string follows the writing rules in DESIGN.md. The most visible changes:

| Where | Today | New |
|---|---|---|
| Top bar | "Direction B — Blueprint", "Dark · Architectural" | "Release check-up" |
| Top bar | "Engineer view", "⚙ AI Settings" | New check-up · Past check-ups · Settings |
| Step bar | "1 · Enter URL & Docs", "2 · Review & Approve Plan", "3 · Live testing", "4 · Report" | Address · Plan · Testing · Report |
| Address screen | "QA Tool · Site check", "+DOC", "DOCS ATTACHED", "📋 1. Specs & PRD", "🎨 2. Design System", "🔀 3. Flow Scenarios" | "Specs", "Design notes", "Journeys to test", "Added" |
| Address screen | "Scan Site & Build Plan →", "🔒 Mandatory gate: Plan must be reviewed and approved before testing" | "Scan the site", "Nothing is tested until you approve the plan." |
| Address errors | "Target Connection Failed", "[ERR_TARGET_UNREACHABLE]", "Recommended Action:" | What happened, then what to do. No codes. |
| Scan screen | "+ X:001 · Y:001 · SCAN_LAYER", "GRID_LOCK:TRUE · PHASE:DISCOVERY", "Stage 1 · Architectural Discovery & Plan Construction", "Mapping Site Architecture", "Discovery Engine Active" | "Scanning shop.example.com" and the numbers |
| Scan screen | "Stop Scan & Return to Setup", "← Back to URL & Specs" | One button: "Stop scanning" |
| Live screen | "LIVE", "LIVE EXECUTION INSPECTOR", "Latest Action", "Audits Running", "Completed Milestones", "Stop Run" | "Testing shop.example.com", "Now testing", "Latest screen", "Found so far", "Stop testing" |
| Report | "Readiness Grade", "/100 Score", "Readiness by Aspect (A–F Grades)", "Prioritized Improvement Recommendations", "Site Architecture & Results Map", "Audit Findings" | The stamp and its reason, "How each area did", "What to improve first", "Map of results", "Problems found" |
| Report | "Download Offline HTML Report", "Download MD & JSON", "Verify with CLI" | "Download the report", with the rest under Details for developers |
| Report | "+ Go deeper (add login credentials)" | "Go deeper: test the signed-in pages" |
| Errors | "Add it again with the “AI key” button at the top" | "…in Settings" |

A banned-words test replaces `LEAKED_INTERNALS` in
[wizard-e2e.test.ts:58](packages/wizard/tests/wizard-e2e.test.ts#L58). It reads the visible text of every
screen, outside Details for developers, and fails on:
- event names, `ERR_`, `undefined` and `[object`
- CSS selectors and checker ids (`bug-detection`, `ux-quality`, …)
- the prototype labels: "Direction B", "Blueprint", "Architectural", "GRID_LOCK", "SCAN_LAYER",
  "EXECUTION INSPECTOR"

## Phase 1: Dead ends and misleading screens

**Goal:** nobody gets stuck, loses what they typed, or is told something untrue. Mostly changes to today's
screens, plus a few runner changes.

### Task 1.1 — Stopping keeps the plan
F1, F6; decision 4.

- **Runner:** `POST /api/runner/abort` during `testing` keeps the approved plan and goes back to
  `awaiting-review`, and `RUN_ABORTED` carries `planKept: true`. During `scanning` there's no plan yet, so
  it goes to `idle` as today ([server.ts:922-951](packages/runner/src/server.ts#L922-L951)).
- **Runner:** `POST /api/runner/run` answers 409 `ERR_PLAN_WAITING` while a plan waits for review, unless
  the body has `replacePlan: true` (see Defaults).
- **Wizard:** every stop asks first and says what's lost:
  - "Stop scanning? The pages found so far are thrown away. AI requests already used stay used."
  - "Stop testing? Results so far are thrown away. Your plan is kept, so you can change it and approve it
    again."

  After a stop during testing, the plan is fetched again and shown.
- **Wizard:** the scan screen has one "Stop scanning" button. Until Phase 2 replaces the step bar, its
  steps never stop anything: during a scan or testing, the steps before the current one are disabled.
- **Wizard:** starting a check-up while a plan waits asks first: "Start a new check-up? The plan for
  shop.example.com that's waiting for your review will be thrown away."

**Done when**
- A runner test stops testing and approves the same plan again.
- A runner test gets 409 when starting over a waiting plan, and succeeds with `replacePlan`.
- The e2e test stops during testing, sees the plan, approves it and gets a report.

### Task 1.2 — Failures are shown
F2.

- The live screen shows `feed.failure` in plain words, with what to do next: "Back to the plan" when the
  plan was kept, otherwise "Start a new check-up".
- The scan screen already shows its failures. Both screens use the same component.

**Done when:** in the e2e test, a run that fails during testing (the fixture app stopped mid-run) shows
the message and a way out.

### Task 1.3 — The AI key comes first, and nothing typed is lost
F3; decision 5.

- The address screen's state (the address, the owner choice, specs, design notes, journeys and the page
  limit) moves up into `App`, so changing screens never loses it.
- With no working key (`GET /api/ai/openrouter/key`), the key field is the first thing on the address
  screen, and the address box follows it. The key is checked as it's typed, as the key screen does today.
  "Scan the site" is enabled once both the key and the address are ready.
- The key screen shows "Keep my current key" only when a key exists.
- `plainFailure` points to Settings, not "the AI key button at the top"
  ([translate.ts:105-110](packages/wizard/src/lib/translate.ts#L105-L110)).

**Done when:** the e2e first-run test pastes specs, adds a key on the same screen, scans, and finds the
specs in the plan's "Specs and design notes".

### Task 1.4 — Full testing or look-only, said up front
F18; decision 6.

- **Runner:** `POST /api/runner/preflight` also returns:
  - `testCopy`: the `isTestHost` rule, including hosts marked as a Test Copy
  - what was remembered for the site: `owner` and `markedTestCopy`
- **Runner:** site memory saves the owner choice. The run's `stagingHost` is already saved
  ([server.ts:989-992](packages/runner/src/server.ts#L989-L992)).
- **Wizard:** the address is checked as it's typed, after a pause, like the key. A line under it then
  says what the check-up will do:
  - "Test copy: forms can be filled in and sent"
  - "Live site: only looked at, nothing is sent or changed"
- **Wizard:** the owner box starts unticked for a site not checked before, and as remembered otherwise.
  On a live-looking address, "This is a test copy" sends `stagingHost`.
- **Runner:** the plan's read-only reason ([server.ts:235-239](packages/runner/src/server.ts#L235-L239))
  names the control that now exists.

**Done when**
- A runner test covers `testCopy` for `localhost`, for a public host, and for a public host marked as a
  Test Copy.
- The e2e test sees the owner box unticked on a new site, ticks it, and sees it ticked on the next
  check-up of that site.

### Task 1.5 — The address box shows what's used
F10.

- No fixed "https://" prefix. A bare address gets a scheme as in Defaults.
- Once checked, the address actually used shows under the box.

**Done when:** a unit test covers `localhost:3050`, `192.168.1.5`, `shop.example.com`, and an address typed
with its scheme.

### Task 1.6 — Live progress from the real events
F8; decision 8.

- A live-state reducer in `src/lib/translate.ts` reads the events that are ignored today:
  - `TEST_POINT_STARTED`: `startPage`, `breakpoint`, `role`, `index`, `total`
  - `STEP_COMPLETED`: `screenshotUrl`, `urlPath`
  - `FINDINGS_UPDATED`: `latest`
- The map highlights the page under test and colours visited pages by what was found there.
- A progress bar shows "Test 37 of 412 · about 6 minutes left". The time is estimated from how long each
  test has taken so far.
- The side panel shows the latest screenshot, the current step in plain words, and "Found so far".
- Clicking a page shows what's been found there. It no longer marks the page as being checked.
- The hard-coded "Audits Running" list goes.

**Done when**
- Reducer unit tests cover each event.
- The e2e test sees "Test 1 of N", at least one screenshot, and a problem pinned to a fixture page with a
  planted defect.

### Task 1.7 — One verdict
F9; decision 9.

- **Core:** the report records which checkers ran. Scoring marks an aspect `checked: false` when none of
  its checkers ran, and leaves it out of `overallScore` ([scoring.ts](packages/core/src/scoring.ts)).
- **Wizard:**
  - The stamp ("Ready to release" or "Not ready yet") is the headline, with its reason, such as "2
    problems must be fixed first". It lands with the stamp animation DESIGN.md describes.
  - The six aspect grades sit under it, and an aspect that wasn't checked says "Not checked".
  - The overall letter and /100 score leave the screen.
- **Wizard:** findings are grouped Must fix before release (Blocker, Major), then Should fix (Minor), then
  Suggestions. Within each group they're grouped by problem, with the pages each is on, and use
  `plainTitle()`.
- **Wizard:** the report map colours every tested page: green for no problems, amber for minor ones, red
  for serious ones.
- **Core:** `report.html` and `report.md` lead with the same stamp and drop the overall grade
  ([html-report.ts:37-39](packages/core/src/html-report.ts#L37-L39)).

**Done when**
- A scoring test gives "Not checked" for an aspect whose checkers didn't run.
- A report with one Major finding shows "Not ready yet" and no overall grade, both on screen and in
  `report.html`.

### Task 1.8 — Plain words
F13, F14; decision 11.

- Apply the Wording table. The product is "Release check-up" everywhere a person reads it, including the
  connection screen and any runner message shown in the page.
- Checker ids, selectors, error codes and the `qa-test verify` command move under a collapsed "Details for
  developers" on each finding. Task 3.1 fills it out.
- The banned-words test (see Wording) covers every screen the e2e test visits.

**Done when:** the banned-words test passes on every screen.

### Task 1.9 — Keyboard and motion
F17.

- Each finding is a button with `aria-expanded` that opens its detail.
- Every `animate-*` class gets `motion-reduce:animate-none`. With reduced motion on, nothing moves,
  including the stamp ([index.css:81-91](packages/wizard/src/index.css#L81-L91)).

**Done when:** the e2e test opens a finding with the keyboard alone, and an axe scan of the report finds
no violations.

### Task 1.10 — Looks
F15; decision 12.

- Declare `color-scheme: dark` in [index.css](packages/wizard/src/index.css).
- Move the report's hard-coded Tailwind colours (`emerald-*`, `sky-*`, `amber-*`, `orange-*`, `red-*`)
  to palette tokens, which [contrast.test.ts](packages/wizard/tests/contrast.test.ts) then checks.
- Delete `TargetTypeScreen`, `UrlStep`, `RolesStep`, `MaterialsStep`, `ProgressScreen`, `ReportScreen`,
  `Shell` and `Ledger`. Keep `Question`, `Lead`, `ErrorMessage`, `Spinner` and `FocusHeading`.

**Done when:** no unused screens are left, and the contrast test covers the grade colours.

### Task 1.11 — "Go deeper" starts cleanly
F21.

- "Go deeper" goes through the same start as a new check-up: it gets a new run id, and the plan, report,
  feed and scan progress are cleared.
- It carries over the first run's specs, design notes and page limit (`ReviewPlan.productContext` and
  `designNotes`).

**Done when:** the e2e test goes deeper on the fixture and sees the new scan's progress.

### Task 1.12 — Studio stop-gap
F11.

- Delete `MOCK_RUNS`, the fake product list and the hard-coded "Online" badge. Studio shows real runs only,
  or "No check-ups yet".

**Done when:** Studio on a fresh runner shows no runs.

## Phase 2: Navigation and history

**Goal:** every screen has an address, people can get back to anything they've done, and every report is
kept.

### Task 2.1 — An address for every screen
F5; decision 2.

- The router (see Defaults) serves the seven addresses in decision 2, and `App` renders by address.
- On `/check/*` addresses, the runner's phase wins. If the check-up has moved on (the plan is ready,
  testing started, or the report is done), the page replaces the address with the right one. On any other
  address, the phase never moves the person.
- Unknown addresses show "Page not found" with the top bar.

**Done when:** the e2e test uses Back, Forward and refresh on every screen and lands where it was.

### Task 2.2 — Top bar and step bar
F6, F7; decision 2.

- The top bar: "Release check-up", New check-up, Past check-ups, Settings, and Team Hub when a Hub is
  connected (Task 3.3).
- Under it, on `/check/*` and on a report, the step bar: Address · Plan · Testing · Report.
  - Finished steps are links, the current step is highlighted, and later steps are greyed out.
  - On phones it reads "Step 2 of 4: Plan".
- Nothing in either bar stops or deletes anything.

**Done when:** the e2e test checks every step bar link, and that none of them stops a check-up.

### Task 2.3 — Resume card and recent check-ups
Decision 2.

- `/` shows a Resume card when the runner has a check-up in progress, such as "Your check-up of
  shop.example.com is waiting for your review → Open the plan".
- The last five check-ups are listed under the address box.

**Done when:** the e2e test leaves a plan waiting, opens `/`, and resumes from the card.

### Task 2.4 — Every report kept
F4, F20; decision 3.

- **Runner:** each run writes to `<outputDir>/runs/<runId>/`: `report.json`, `report.html`, `report.md`,
  `findings.json`, `evidence/` and the product context file. The orchestrator takes the run's evidence
  address (`/api/runs/<runId>/evidence/`) for `screenshotUrl`.
- **Runner:** new endpoints:
  - `GET /api/runs`: newest first, with the site, date, stamp and counts
  - `GET /api/runs/<runId>`
  - `GET /api/runs/<runId>/download/<file>`
  - `GET /api/runs/<runId>/evidence/*`
  - `DELETE /api/runs/<runId>`

  `GET /api/report` stays as the latest report, for the command line.
- **Runner:** on start, the latest report is read from disk, so a restart keeps it.
- **Runner:** after each run, only the newest 10 runs per site are kept. The grade history
  (`<host>.history.json`) keeps every run.

**Done when:** runner tests cover the endpoints, reading the latest report after a restart, and deleting
the 11th-newest run of a site.

### Task 2.5 — Past check-ups
Decision 3.

- `/reports` lists check-ups by site, newest first. Each shows the date, the stamp and the problem counts,
  with Open, Test again and Delete. Delete asks first.
- `/reports/<runId>` shows that report, with its own downloads.

**Done when:** the e2e test opens an older report from `/reports`, reloads its address, and deletes it.

### Task 2.6 — Test again
Decision 7.

- **Runner:** `POST /api/runner/run` takes `testAgain: true`.
  - The site is scanned again and compared with the approved plan, as today
    ([site-memory.ts:117](packages/core/src/site-memory.ts#L117)).
  - If the comparison finds nothing new (no new pages, links, journeys or questions), testing starts at
    once with the remembered answers.
  - Otherwise it pauses for review, with only the new items flagged, as today.
- **Wizard:** "Test again" appears on each report and in Past check-ups. The report of a check-up that
  skipped the review says so: "Tested with the plan you approved on 30 September."
- The "Mandatory gate" wording goes. The address screen says "Nothing is tested until you approve the
  plan."

**Done when:** runner tests cover both outcomes on the fixture. Unchanged starts testing, and an added
page pauses with only that page flagged.

### Task 2.7 — Site data out of git
F19; decision 3.

- The runner's data folder defaults to `.qa-data/` (see Defaults). On start, an existing `sites/` folder in
  the working folder moves there once: copied first, then deleted.
- `SiteHistoryManager` takes the data folder from the orchestrator's options instead of always using
  `<working folder>/sites` ([orchestrator.ts:820](packages/core/src/orchestrator.ts#L820)). The runner
  passes its own, and the command line defaults to `.qa-data/`. Docker then keeps the history on its
  volume.
- `.qa-data/` is added to `.gitignore`, and `git rm -r --cached sites/` takes the committed files out of
  git.

**Done when:** a runner test starts with a `sites/` folder and finds it moved, and `git ls-files sites` is
empty.

### Task 2.8 — Settings
Decision 5.

- `/settings` shows whether the key works, the model in use and the free requests left today, with
  "Replace the key".

**Done when:** the e2e test replaces the key from `/settings`.

## Phase 3: One app

**Goal:** engineers find everything they used Studio for under each finding, Studio is retired, and every
screen works on a phone.

### Task 3.1 — Details for developers
Decision 10.

- Under each finding, collapsed by default:
  - the screenshot, from the run's evidence
  - steps to reproduce
  - the page and element (selector)
  - console errors
  - the `qa-test verify <id>` command
- "Copy bug report" copies Markdown with the steps, expected and actual results and console errors, as
  Studio's does ([EvidenceInspector.tsx:64-90](packages/web/src/components/EvidenceInspector.tsx#L64-L90)).
- "Copy Playwright test" copies the repro script the core already writes for a finding (`reproScriptPath`,
  [orchestrator.ts:647](packages/core/src/orchestrator.ts#L647)). When there isn't one, it copies a test
  built from the steps.
- Studio's placeholder text is not carried over: the fixed "Playwright.assertValidState" error and the
  "CDP trace" caption.

**Done when:** the e2e test opens Details for developers on a fixture finding, sees its screenshot load,
and copies both texts.

### Task 3.2 — Filters and search
Decision 10.

- Reports with more than 10 findings get filters (how serious, page, aspect) and a search box.
- Clicking a page on the map filters the list to that page.

**Done when:** the e2e test filters the fixture report by page and by aspect.

### Task 3.3 — Team Hub link
Decision 10.

- **Runner:** `/hub` is passed on to the Hub the way `/api/v1/*` is
  ([server.ts:378-382](packages/runner/src/server.ts#L378-L382)). `GET /api/runner/status` says whether a
  Hub is connected.
- **Wizard:** the top bar shows "Team Hub" only when a Hub is connected. Accepting findings stays in the
  Hub's own dashboard.

**Done when**
- A runner test forwards `/hub` to a fake Hub, and answers 503 without one.
- The e2e test sees no Team Hub link when there's no Hub.

### Task 3.4 — Retire Studio
F7, F11, F12; decision 1.

- `/studio` and everything under it answer 308 → `/reports`.
- Delete Studio and everything that builds or mentions it:
  - `packages/web` and the `dev:web` script
  - Studio in `defaultUiApps` ([ui-static.ts:41-47](packages/runner/src/ui-static.ts#L41-L47))
  - Studio's build and package copy in [packages/runner/Dockerfile](packages/runner/Dockerfile)
  - the Studio line in [cli.ts](packages/runner/src/cli.ts)
- Update the README, the docker-compose comment, [single-server.test.ts](packages/runner/tests/single-server.test.ts),
  [smoke.mjs](scripts/smoke.mjs) and the wizard e2e test.

**Done when:** the build, the Docker image and all tests pass without `packages/web`, and `/studio/`
redirects.

### Task 3.5 — Phones
F16; decision 13.

- Below 768 px, the live screen shows the progress, the page under test, the latest screenshot and "Found
  so far", without the map or the side panel.
- Maps open in their list view below 768 px. [SiteMap.tsx](packages/wizard/src/components/SiteMap.tsx)
  already has one.
- The phone test in [wizard-e2e.test.ts:320-331](packages/wizard/tests/wizard-e2e.test.ts#L320-L331) visits
  every screen at 375 px. It checks for no sideways scrolling and that each screen's main button is
  visible.

**Done when:** that test passes on every screen.

### Task 3.6 — Docs

- Update the README's Wizard walkthrough, running options, diagram and troubleshooting, leaving out Studio.
- DESIGN.md, CONTEXT.md and the ADR 0008 note were updated with this plan. Check that they still match what
  was built.

## Done means

- **Phase 1**
  - A person with no key can paste specs, add the key and scan on one screen without losing anything.
  - Stopping testing leads back to a plan that can be approved again.
  - A failed run says why.
  - The live screen shows the real test count, page and screenshot.
  - The report shows one verdict, and "Not checked" where nothing ran.
  - The banned-words test passes on every screen, and all tests pass.
- **Phase 2**
  - Every screen has an address that survives Back, Forward and refresh.
  - An old report opens from Past check-ups and from its bookmarked address.
  - Test again skips the review only when nothing changed.
  - `git ls-files sites` is empty, and all tests pass.
- **Phase 3**
  - Everything an engineer used in Studio is under Details for developers.
  - `/studio` redirects, and `packages/web` is gone.
  - Every screen passes the phone test, all tests pass, and the Docker image builds.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Kept reports fill the disk; one site's output is 164 MB today | A full disk stops runs | Ten per site, older ones deleted after each run; delete by hand in Past check-ups |
| Test again skips the review after a change it didn't detect | Something runs that wasn't reviewed | Any new page, link, journey or question pauses it, and the report says which approved plan it used |
| The address and the runner's phase disagree | People land on the wrong screen | On `/check/*` the phase wins and the address is replaced; elsewhere the phase never moves anyone |
| Retiring Studio loses something an engineer relied on | A missing tool | Task 3.4 comes after Tasks 3.1–3.3, whose e2e checks cover each moved piece |
| Moving `sites/` loses site memory | Answers and approved plans are forgotten | The move copies before deleting, runs once, and is covered by a test |

## Deviations found while building

Found while building all three phases on 2026-09-30. The tasks above are left as planned; this is what was built instead,
and why.

- **Stopping really stops.** Before, "Stop" only told the screen: the crawler, the AI planner and the test run carried on
  in the background, still spending AI requests and writing files. A stop now reaches all of them: the orchestrator
  checks before each test point and step, the discovery agent between stages (and always closes its browser), the
  crawler between pages, and the paced AI client between requests (`packages/core/src/abort.ts`). The runner also
  counts runs (`runGeneration`), so the events and results of a stopped run are dropped instead of overwriting the next.
- **A failed test run keeps the plan too.** Task 1.1 kept the plan when testing is stopped. A run that fails part-way (the
  site went down) now also keeps it: the runner goes back to `awaiting-review`, and `RUN_FAILED` carries
  `planKept: true` (code `ERR_TEST_EXECUTION_FAILED`). The Wizard shows the failure as a banner over the plan, which can
  be approved again once the site works. The testing screen shows failures without a kept plan, with "Start a new
  check-up".
- **Evidence addresses.** Task 2.4 planned `GET /api/runs/<runId>/evidence/*`. Files inside a run are served at
  `/api/evidence/runs/<runId>/<path>` instead, with paths relative to the run's folder, through the evidence route that
  already existed and already refuses saved sign-in sessions at any depth. Reports are kept and served with those
  relative paths (`withPortablePaths`), so no full path of the computer reaches the page.
- **The event stream catches up.** A page that opens or reconnects mid-run gets the run's events so far, replayed after
  `connected` and marked `replayed: true`. That's what lets refresh, Back and Forward land on a live screen that shows
  the real progress, and keeps a "testing stopped" banner over the plan across a reload. The events are cleared when a
  run starts and when a plan is approved, so a page only catches up on the current scan or the current testing.
- **`seenBefore` needs pages.** Site memory now also holds the owner choice and when the plan was approved, so a site can
  have memory before it was ever scanned. `applySiteMemory` counts a site as seen before only when its memory has
  pages, so a first scan isn't told "nothing new".
- **More than `sites/` moved.** Task 2.7 moved `sites/`. The saved key file, the chosen AI models and a plan waiting for
  review (`.qa-keys.json`, `.qa-ai-models.json`, `.qa-plan.json`) also sat in the working folder, so they move into
  `.qa-data/` the same way: copied first, then removed, once.
- **Task 1.12 skipped.** Studio's stop-gap (deleting its invented runs) wasn't built, because Task 3.4 deletes Studio in
  the same change.
- **The key saves itself on the new check-up screen.** Task 1.3 asked for "Scan the site" to be enabled once the key and
  the address are ready. On that screen the key field saves the key as soon as it's checked (no separate button), so
  "ready" is simply "a key is saved and the address is set". Settings keeps an explicit "Save the key" with "Keep my
  current key" beside it when one exists.
- **Scanning is part of the Plan step.** The step bar has four steps (Address · Plan · Testing · Report). The scan screen
  shows Plan as the current step, since the scan is what writes the plan.
- **Go deeper and Test again carry the specs from the run's folder.** When the new check-up form holds another site, the
  specs a check-up was planned with are read back from its `product-context.md`, so they're never dropped.
- **Wizard imports from `@qa/types` sources.** `@qa/types`' index pulls in `node:crypto`, so the Wizard imports its
  browser-safe parts from their source files (`@qa/types/src/verdict.js`, `site-map.js`), and Vitest resolves those the
  same way Vite does.
