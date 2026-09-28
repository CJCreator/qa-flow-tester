# Implementation Plan: URL-first review

Companion to [GAP_REVIEW.md](./GAP_REVIEW.md), which holds the live review of today's tool and the 28 agreed
decisions (numbered in its appendix; "D7" below means decision 7). This plan turns those decisions into
tasks. It builds on the wizard (`packages/wizard`) and the runner (`packages/runner`). QA Flow Studio
(`packages/web`) is not changed.

## Status (as of 2026-09-28)

**Not started.** Phase 0 is a recommended addition from the gap review and **awaits your go-ahead**; it
changes D28, which put the new UI first. If you decline it, its tasks move into Phase 1, and Phase 1
cannot pass its exit check without them.

| Phase | What it delivers | Tasks | Estimate (one engineer) |
|---|---|---|---|
| 0. Trust fixes (recommended) | Plans grounded in the real page, deeper crawling, no leaked passwords | 11 | 2 weeks |
| 1. Plan review and new UI | One URL box, a plan you can read and change, map-based live view and report | 13 | 5–6 weeks |
| 2. New aspects | Speed, SEO, security, AI visual review, grades, recommendations, HTML report, history | 9 | 4–5 weeks |

## The experience this plan builds

1. The user enters a URL. If they own the site and it runs on a test host, they tick "I own this site or
   it's a test copy" (D1, D3).
2. The tool scans for 1–2 minutes, names the site type and picks the 3–5 journeys that matter (D4).
3. It pauses and shows the plan as a site map. The user can skip things, fix expectations, answer the AI's
   questions, add rules, or describe a missing test in a sentence (D19–D21, D24). "Skip review, just test
   it" goes straight through.
4. Testing runs while the map lights up page by page (D25).
5. The report opens with an A–F grade per aspect and ranked improvements, then the map coloured by result
   (D6–D8, D26). The user downloads one HTML file, and developers get `report.md` and `findings.json`
   (D9, D10).
6. The next run of the same site remembers every answer and shows what changed (D11, D22).

## Principles every task follows

- **Deterministic results.** The same site gives the same fixed-rule findings and the same grades on every
  run. AI output is always labelled as AI and never sets a grade (D7).
- **Nothing unconfirmed is reported as a failure.** An AI guess that nobody confirmed can only be "Could
  not verify", never Major or Blocker.
- **Safe by default.** Anything uncertain about a host is treated as a live site, so it stays read-only.
- **Plain language on top, detail underneath.** No selectors, patterns or library wording on the
  plain-language layer (D9).
- **Free AI only** (D12). Every AI feature handles "no key", "no free model today" and "limit reached".

---

## Phase 0: Trust fixes (recommended; awaiting go-ahead)

**Goal:** before a plan is shown to anyone, it must describe the real site. The gap review found that all
15 issues from AI-planned tests were false, the public-site crawl never left page 1, and a test password
was saved in a report.

**Exit check:** rerun the five review sites (Task 0.11). At least 70% of reported issues must be real, and
at least 3 of the 4 fixture defects planted before the review must be found.

### Task 0.1 — Record the real elements on every page
Fixes gaps T1 and M3.

The crawler already reads each element's text and test id, then keeps only a count
([deterministic-spider.ts:82](packages/core/src/discovery/deterministic-spider.ts#L82)). Keep the list.

- **Types:** add `elements: ElementInventoryItem[]` to `PageInventoryItem` in `packages/types`. Each item
  has role, accessible name, `data-testid`, a stable selector (test id, then id, then role + name), and
  whether it's visible and enabled.
- **Scope:** cover buttons, links, inputs, selects, textareas, `[role=button]`, `[role=tab]` and
  `summary`.
- **Field names:** use the label, then placeholder, then `id`, then `name`. Today it's `name` only, which
  produced "fields [, ]".

**Done when**
- The fixture's `/dashboard` inventory lists `trigger-error-btn`, `trigger-failed-api-btn` and
  `tiny-touch-btn` with their visible names.
- The fixture's invoice form fields are named "Customer" and "Amount".
- A unit test covers a field with a label only, one with a placeholder only, and one with nothing but
  `name`.

### Task 0.2 — Build the AI's plan from the real page, and check it
Fixes gap T1.

- **Prompt:** send the AI the element inventory from Task 0.1 for each page, not counts
  ([discovery-agent.ts](packages/core/src/discovery/discovery-agent.ts)).
- **Plan check (fixed rules):** a new `PlanValidator` in `packages/core/src/discovery/` checks every step
  against the inventory of the page it runs on.
  - An unknown selector gets one repair request to the AI, listing the page's real elements.
  - Still unknown: the step is dropped and the journey is marked "needs your help", which becomes a
    question in the plan review (Task 1.7).
- **Where it runs:** after discovery, and on every plan the user edits or adds.

**Done when**
- Given an AI response that invents `dashboard-element-1`, the validator rejects it and the repair
  request contains the real element names.
- No step aimed at an element that isn't in the inventory ever reaches the test runner (test with a mock
  AI provider).
- A rerun of the fixture reports no "Couldn't complete 'Interact with first dashboard element'".

### Task 0.3 — Label guesses, and never fail a site on one
Fixes gap T2.

- **Where each rule came from:** add `origin: 'observed' | 'ai-guess' | 'user'` to inferred rules,
  expected results and validation rules in `packages/types`.
  - `observed` = the tool saw it happen.
  - `user` = the user supplied or confirmed it.
  - `ai-guess` = everything else.
- **Boundary tests:** the validation expander
  ([validator-expander.ts](packages/core/src/validator-expander.ts)) creates boundary tests only from
  `observed` or `user` rules.
- **Unconfirmed wording:** an `ai-guess` expected message becomes a behaviour check ("an error message
  appears next to the field"). If nothing appears, the result is "Could not verify", not Major.
- **Skipped reviews:** they keep guesses as guesses (D19).

**Done when**
- A saucedemo rerun reports no "Expected text not found: 'Field is empty'". The empty-field checks pass,
  because an error does appear.
- The fixture's empty-amount check says "Could not verify: no error appeared after sending an empty
  amount. Confirm whether this should be required."
- Unit tests cover all three origins through the expander and the spec checker.

### Task 0.4 — Explore while signed in
Fixes gap T3.

Pre-flight already signs in each role and saves the session
([preflight.ts:86](packages/core/src/preflight.ts#L86)).

- Run pre-flight before discovery.
- Crawl once per role, using that role's saved session
  ([discovery-agent.ts:37](packages/core/src/discovery/discovery-agent.ts#L37)).
- Record which pages each role reached. The permission checks and "Go deeper" (Task 1.12) use this.
- Without logins, nothing changes. The login-gated pages found are listed as "not reached" (D2).

**Done when**
- On saucedemo with `standard_user`, discovery reaches the inventory, product, cart and checkout pages,
  and plans at least one journey beyond login.
- With no login, the same run lists the sign-in page and reports "pages behind sign-in were not reached".
- A test with two fixture roles records different page lists for each.

### Task 0.5 — Let the read-only crawl follow links
Fixes gap T4.

Extend `SafePublicCrawler` ([safe-crawler.ts](packages/core/src/competitive/safe-crawler.ts)):

- **Link following:** follow same-site links breadth-first, up to a page budget (default 25, D5), and run
  the checks on each page.
- **Keep what works:** in-page tab and menu exploration, robots.txt, form blocking, and blocking of
  POST, PUT, PATCH and DELETE requests.
- **Layout groups:** give each page a layout fingerprint (its outline of main page parts and headings,
  ignoring the text) so pages built from one template group together. Tasks 1.6 and 2.4 use this.
- **Rate limit:** at most one page load every 2 seconds on public sites. Raise the old 5-step ceiling to
  the page budget.

**Done when**
- books.toscrape.com reaches 25 pages, and the book pages fall into one or two layout groups.
- The request log still shows no POST, PUT, PATCH or DELETE on a form-heavy test page.
- A page that robots.txt blocks is skipped and listed as skipped.

### Task 0.6 — Keep passwords out of reports, and flag them on the site
Fixes gap T5.

- **Redaction:** one `redact()` step runs before anything is written: findings, `report.md`, repro
  scripts, step evidence and DOM snapshots.
  - It masks the credentials from this run.
  - It also masks URL parameters that look like secrets (`password`, `pass`, `pwd`, `token`, `secret`,
    `key`).
- **New security finding:** raise one when a form with a password field uses GET, or when a password
  appears in a page address. The finding is Major, with its own plain title.

**Done when**
- After a fixture run, searching every output file for `manager-password` finds nothing.
- The fixture run reports "The sign-in form sends passwords in the page address".
- A unit test covers the masking rules.

### Task 0.7 — One problem, one finding
Fixes gap M2.

- **Grouping:** group findings from the same step that point at the same resource URL (console error, 404
  and failed request) into one finding that lists all the signs.
- **Third-party failures:** the `thirdParty` flag already exists on `Finding`. Third-party failures are
  Minor unless the page visibly breaks.
- **Location:** `packages/checkers/src/bug-detection.ts`, plus a grouping step before the report is
  written.

**Done when**
- The W3C BAD demo's missing analytics file appears once, as Minor.
- books.toscrape.com's blocked jQuery appears once, with both signs listed.

### Task 0.8 — Check every page, at three widths
Fixes gap M1.

- **Page sweep:** after the journeys, visit every discovered page for each role. Run all checks and use
  each safe control (buttons that aren't sensitive actions, tabs, menus).
- **Widths:** default to 375, 768 and 1440 px instead of 1440 px only
  ([server.ts:532](packages/runner/src/server.ts#L532)).

**Done when**
- The fixture run finds the console error, the failing API call, the dead-end page and the 20 px tap
  target (at 375 px).
- Every finding records the width it was seen at.

### Task 0.9 — Fixed AI models, remembered by the runner
Fixes gaps M4 and M5.

- **Two models:** the runner picks and stores two free models, one for text and one for vision.
  - Text model: text-only output, JSON mode preferred.
  - Vision model: image input, text-only output.
  - Filter code: [openrouter.ts:99](packages/core/src/ai/openrouter.ts#L99).
  - Neither may be a model router.
  - Music, image and audio models are excluded.
- **Report:** names both models.
- **Wizard:** stops storing the model in the browser
  ([api.ts:152](packages/wizard/src/api.ts#L152)) and asks for a key only when the runner has none.

**Done when**
- A new browser goes straight past the key screen when the runner has a key.
- The free-model list contains no Lyria or other non-chat models.
- Running discovery twice on the fixture uses the same model both times.

### Task 0.10 — Small fixes from the review
- **Dead-end rule:** it no longer fires on a site's only screen or on pages with working in-page
  controls, such as TodoMVC ([ux-quality.ts:123](packages/checkers/src/ux-quality.ts#L123)).
- **A failed test always explains itself:** a test point marked Failed always has at least one finding
  saying why.
- **Relative evidence paths:** `report.md` and `findings.json` use paths relative to the report folder.
- **WCAG 2.2:** the accessibility check adds the `wcag22aa` rule set
  ([ux-quality.ts:28](packages/checkers/src/ux-quality.ts#L28)) (D6, D18).

**Done when:** each fix has a unit test, and TodoMVC reports no dead end.

### Task 0.11 — A benchmark that scores the tool itself
- **Richer fixture:** extend the fixture app (`fixtures/test-app`) with:
  - a real signed-in area
  - a form that shows a real error message
  - a slow page
  - a page missing its title and description
  - a response missing security headers
  - a GET sign-in form (already there)
- **Answer keys:** one file per benchmark site in `fixtures/benchmarks/`. The fixture's is exact; the
  public sites' are labelled by hand from their runs.
- **Scoring:** `pnpm benchmark` runs all five sites and prints three numbers per site: share of real
  findings, planted defects found, and pages reached.

**Done when:** `pnpm benchmark` runs end to end, and its numbers are the Phase 0 exit check.

---

## Phase 1: Plan review and new UI

**Goal:** a non-technical user enters a URL, understands what the tool plans to test, changes it, watches
it run and explores the result, all on one site map. This phase uses today's checks; Phase 2 adds the new
aspects.

**Exit check:** in an end-to-end test on the fixture, a user following the wizard reviews the plan, skips a
journey, answers a question, adds a test by sentence, watches the run, and finds each planted defect on
the report map. A re-run shows only what's new.

### Task 1.1 — Prototypes, then pick a direction
D27.

Build 2–3 clearly different visual directions for the four key screens (URL, plan map, live map, report)
as clickable prototypes, using real data from the benchmark runs. Use the `prototype` and
`frontend-design` skills. Each direction states its type, colour and layout choices, as
[DESIGN.md](packages/wizard/DESIGN.md) does today.

**Done when:** you have picked a direction (or a mix). The choice and the reasons are recorded in
`packages/wizard/DESIGN.md`, and Tasks 1.5–1.11 follow it.

### Task 1.2 — Runner: pause for review, then resume
D19.

- **States:** a run moves through `scanning` → `awaiting-review` → `testing` → `done`, or `failed` from
  any state.
- **Pause:** after discovery the runner stores the plan on disk in its data folder and waits. It does not
  go straight to testing ([server.ts:512-534](packages/runner/src/server.ts#L512-L534)).
- **New endpoints**, following the existing `/api/runner/*` style:
  - `GET /api/runner/plan` (the plan, or 404)
  - `PATCH /api/runner/plan` (apply the user's edits; each edit is re-checked by the plan check from
    Task 0.2)
  - `POST /api/runner/plan/approve` (start testing)
- **Skip review:** `POST /api/runner/run` accepts `skipReview: true`. Unanswered questions then get their
  safe answer: skip deletes, payments and emails; generic checks only for forms nobody described.
- **Events:** new events `PLAN_READY` and `TESTING_STARTED`.
- **Restarts:** a paused plan survives a runner restart and a closed browser, and stays until the next
  run starts.

**Done when**
- Runner tests cover pause, a reload during the pause, approve, and skip.
- The existing `/api/runner/run` callers (QA Flow Studio, the command line) still work unchanged, because
  they get `skipReview` by default.

### Task 1.3 — The plan in plain language
D20, D24.

- **Plan type:** add a `ReviewPlan` type to `packages/types`, derived from `DiscoveryDraft`, holding:
  - journeys, each with a name, why it was chosen, steps as sentences, and checks as sentences marked
    "seen on the site", "your rule" or "AI guess" (Task 0.3)
  - site-wide checks
  - the AI's questions
  - pages grouped by section and layout (Task 0.5), each with a thumbnail
- **Translation rules:** extend `src/lib/translate.ts` and `summary.ts` so every step, check and finding
  type has a plain sentence. This also covers gap M6: no raw patterns, no library wording, and security
  under its own heading.

**Done when**
- A unit test turns the fixture's plan into sentences, with no selectors, patterns or library titles in
  the output.
- The existing test that no jargon appears on screen covers the plan screen too.

### Task 1.4 — Name the site type and pick the journeys
D4.

- After the scan, the text model names the site type (shop, SaaS, content, booking, app, other) and picks
  3–5 journeys, each with a one-line reason.
- The picks come only from the scanned pages and elements, and each is checked by the plan check
  (Task 0.2).
- **Fallback when the AI fails or there's no key:** fixed rules (for example, a cart link means a shop),
  plus a generic "visit the main pages" journey.

**Done when**
- books.toscrape.com is named a shop and gets a browse → book journey.
- TodoMVC is named an app.
- Each journey has a reason.
- The no-key fallback still produces a plan.

### Task 1.5 — The URL-first front door
D1, D3, D12.

- **First screen:** one URL box, the owner checkbox, and "Skip review, just test it". The
  product/website choice is removed. The key screen moves to a settings link.
- **Test-host rule, enforced in the runner (not only the screen):** full interaction needs the owner
  checkbox and a test host. Test hosts are:
  - `localhost`, `127.0.0.1`, `::1` and `host.docker.internal`
  - private IP ranges
  - Microsoft dev tunnel addresses (`*.devtunnels.ms`)
  - hosts the user marked as staging, saved per site
  - Anything else is live and stays read-only (gap M7).

**Done when**
- The wizard's end-to-end test starts a run from one screen.
- A runner test refuses full interaction for a public host even when the owner box is ticked, and allows
  it for `localhost:3050`.

### Task 1.6 — The site map component
D24–D26.

- **One map, three modes:** plan, live and report.
- **Layout:**
  - Journey pages are screenshot thumbnails joined by coloured paths, one colour per journey.
  - Other pages collapse into groups by section, such as "Blog · 12 pages".
  - Clicking any box opens a side panel.
- **Keyboard and screen-reader access:** the same content is available as a structured list with the same
  actions. This is an accessibility tool, so its own main screen must pass WCAG 2.2 AA.
- **Library:** chosen in the prototype (Task 1.1). Candidates are an SVG layout of our own, or a graph
  library such as React Flow.

**Done when**
- The fixture and books.toscrape.com maps render readably at 1440 px and 375 px.
- An axe scan of the plan screen finds no violations.
- Every map action is reachable by keyboard.

### Task 1.7 — Plan review panel
D20, D23.

For each page or journey, the side panel lets the user:

- skip a journey or check
- fix an expected result
- answer the AI's questions, with the safe option shown as the default
- add a business rule in plain words (turned into a `user` rule, then checked)

Tests that need a form sent on a live site stay in the plan, labelled "Needs a test copy" (D23).
"Looks good, start testing" calls approve (Task 1.2).

**Done when**
- The end-to-end test does each of the four edits on the fixture and sees them take effect in the results.
- A "needs a test copy" test shows as not run, with that reason, on a public site.

### Task 1.8 — Add a test by describing it
D21.

- **New endpoint:** `POST /api/runner/plan/interpret` takes a sentence and the page it's about.
- **Translation:** the text model turns the sentence into steps and an expected result, using that page's
  real elements. The plan check (Task 0.2) validates it.
- **Confirmation:** the wizard shows the interpretation back in plain words. It is added only after the
  user confirms, and it becomes a `user`-origin test.
- **Can't translate:** the reply says what's unclear and asks the user to rephrase. Nothing is added.

**Done when**
- "Save an invoice with an empty amount — it should show an error" on the fixture becomes a runnable test
  after confirmation.
- A sentence about a button that doesn't exist gets a plain "I couldn't find…" reply.

### Task 1.9 — Remember each site
D22.

- **Storage:** per site (keyed by host), the runner stores journeys kept or skipped, answers, rules,
  added tests and staging marks, in its data volume.
- **Next run:** the saved choices are applied, and only new or changed journeys, pages and questions are
  flagged ("New since last time").

**Done when:** a second fixture run asks no question answered in the first, and a page added to the
fixture between runs is flagged as new.

### Task 1.10 — Live map
D25.

- The map lights up as pages are visited, and the current page pulses.
- A panel shows the latest screenshot and the action just taken. `STEP_COMPLETED` already carries
  `screenshotUrl`.
- Issues pin to the page where they were found.
- The old bare progress bar goes.
- Reconnecting and catch-up checks keep working as today.

**Done when:** the end-to-end test sees at least one screenshot and one pinned issue appear during a
fixture run, and reconnecting after a dropped stream shows the current state.

### Task 1.11 — Report screen on the map
D9, D26.

- **Top:** until Phase 2 adds grades, the ready / not-ready verdict. Then the map coloured by result:
  green passed, amber minor issues, red serious.
- **Side panel for a page or step:** every check that ran, with passed ones collapsed.
- **Developer layer:** a "Details for developers" layer has reproduction steps, selectors and links to
  evidence.

**Done when:** every finding in the fixture report can be reached from the map, and each page's panel
lists the checks that passed.

### Task 1.12 — "Go deeper"
D2.

The report has a "Go deeper" panel where the user adds logins or product notes and starts a deeper
re-run. The re-run reuses the site's saved choices (Task 1.9) and signed-in exploration (Task 0.4).

**Done when:** on saucedemo, adding `standard_user` in "Go deeper" leads to a re-run whose plan includes
cart and checkout journeys.

### Task 1.13 — End-to-end test for the whole flow
Extend `packages/wizard/tests/wizard-e2e.test.ts` to cover the Phase 1 exit check against the real runner
and the fixture. Only OpenRouter is faked, as today.

**Done when:** the test passes twice in a row, and the full test suite stays green.

---

## Phase 2: New aspects

**Goal:** the report covers all six aspects with A–F grades and ranked improvements, downloads as one HTML
file, and shows what changed since the last run.

**Exit check:** all five benchmark sites get a grade for each aspect, the findings behind every grade are
listed, and the HTML report opens offline.

### Task 2.1 — Speed and mobile check
D6.

- **New checker:** add `performance` to `packages/checkers`. Per page and width, it measures:
  - Largest Contentful Paint and Cumulative Layout Shift, through the browser's `PerformanceObserver`
  - Interaction to Next Paint on the interactions the tool performs
  - total page weight and the slowest requests
- **Thresholds:** web.dev's "good" and "poor" limits (LCP 2.5 s / 4 s, CLS 0.1 / 0.25, INP 200 ms /
  500 ms).
- **Honest labelling:** the report says these are measured in a test browser, not by real visitors.
- **Mobile layout:** content overflowing the screen and overlapping elements, at each width.

**Done when:** the fixture's slow page is flagged, the fixture's fast pages are not, and results match
across two runs within a stated tolerance.

### Task 2.2 — SEO and link health check
D6.

Checks page title, meta description, one H1 and heading order, canonical link, social preview tags, page
language, robots.txt and sitemap, and broken links (same-site links checked at a limited rate).

**Done when:** the fixture page with no title and description is flagged, and books.toscrape.com's link
check completes within its page budget without flooding the site.

### Task 2.3 — Security basics check (passive only)
D6.

Checks:

- HTTPS and redirect to HTTPS
- the HSTS, Content-Security-Policy, X-Content-Type-Options, frame-ancestors (or X-Frame-Options) and
  Referrer-Policy headers
- insecure content on secure pages
- cookie flags (Secure, HttpOnly, SameSite)
- error pages that expose stack traces
- the password-in-address check from Task 0.6

No attacks and no probing: it only reads what the normal visit returned.

**Done when:** the fixture's missing headers are flagged, and books.toscrape.com's insecure jQuery appears
here as a security finding, not as "an error behind the scenes".

### Task 2.4 — AI visual and copy review
D6, D13–D15.

- **Calls:** one call per layout group (Task 0.5) to the fixed free vision model (Task 0.9), with the
  375, 768 and 1440 px screenshots of one example page in the same call. That's about 10–20 calls per run.
- **Answer shape:** structured JSON. For each issue: where, what, why it matters, and a suggested
  improvement. Each is labelled as AI.
- **Budget:** the runner counts calls. When the free limit or model is unavailable, it stops cleanly and
  the report says "Reviewed 8 of 14 screens — free AI limit reached".
- **Finish later:** `POST /api/runner/ai/finish` reviews the remaining screens from stored screenshots,
  without crawling again.
- **No key:** the section shows as "skipped" (D12).

**Done when**
- A mock-provider test covers full, partial and skipped runs.
- "Finish AI review" completes a partial run.
- One real run with a free vision model is checked by hand and its result recorded here.

### Task 2.5 — A–F grades
D7.

- **Aspects:** Works, Accessible, Fast and mobile, Findable, Secure, Looks and reads well.
- **Scoring rules:** each grade comes from fixed rules on its findings, weighted by severity and by how
  many pages are affected. The rules are written as a table in this plan before coding, and pinned by
  unit tests.
- **AI findings never change a grade.** The "Looks and reads well" grade is an open question (below).

**Done when:** the same findings always give the same grades, and each grade lists the findings that set
it.

### Task 2.6 — Ranked improvement recommendations
D8.

- **Grouping:** from all findings plus the AI review, build a list split into quick wins and bigger
  changes.
- **Ranking (fixed rules):** severity × pages affected × effort class.
- **Wording:** the text model writes each item and links it to its screenshot and evidence. Everything is
  labelled AI-written.
- **Reuse:** `UXRecommendation` from the competitive comparison
  ([ux-gap-synthesizer.ts](packages/core/src/competitive/ux-gap-synthesizer.ts)).
- **No key:** a template recommendation per finding type is used.

**Done when:** every recommendation links to at least one finding or screenshot, and the ranking is the
same across two runs.

### Task 2.7 — Single-file HTML report
D9, D10.

- **What it is:** one self-contained HTML file with the grades, recommendations, map snapshot and all
  findings. Details are collapsible. Screenshots are embedded as compressed images.
- **Size limit:** stated in the file and enforced. Beyond it, screenshots are downscaled.
- **Developer files:** `report.md` and `findings.json` stay, with relative paths (Task 0.10).
- **Download:** the wizard's download offers the HTML file first.

**Done when:** the HTML file opens with no network connection, shows every screenshot, and passes an axe
scan.

### Task 2.8 — History and changes since last run
D11.

- **Storage:** per site, the runner keeps each run's grades and finding fingerprints in its data volume.
  It reuses `computeStructuralFingerprint` from [fingerprint.ts](packages/types/src/fingerprint.ts), as the
  hub does.
- **Report:** shows the grade change per aspect, and what's new, fixed and still open since the last run.

**Done when:** two fixture runs with one defect fixed in between show it as fixed, with the grade going up.

### Task 2.9 — Update the product spec
D18.

In `Pre-Release Readiness Checker — Product Spec.md`:

- WCAG 2.1 AA becomes 2.2 AA.
- Resolve the contradiction between "AI is required" and "AI mode is optional" as optional.
- Add the URL-first flow as the main entry point.

**Done when:** the spec matches this plan and GAP_REVIEW.md, with no contradictions.

---

## Timeline

| Phase | Duration (one engineer) | Depends on |
|---|---|---|
| 0. Trust fixes | 2 weeks | Your go-ahead |
| 1. Plan review and new UI | 5–6 weeks | Phase 0 exit check; Task 1.1 before Tasks 1.5–1.11 |
| 2. New aspects | 4–5 weeks | Tasks 0.5 and 0.9 for Task 2.4; Phase 1's report screen for Tasks 2.5–2.7 |

Tasks 2.1–2.3 (the fixed-rule checks) don't depend on the new UI. They can run in parallel with Phase 1 if
a second person is available.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Free vision models are scarce or change without notice | The AI visual review can't run | The partial and skipped states are built in (Task 2.4); fixed models are re-checked at the start of each run; the report always names the model used |
| The map is crowded on large sites | Users can't read the plan | Journeys in focus, other pages grouped by section and layout (D24); a list view as the alternative |
| The plan pause is lost if the runner restarts | The user loses their review | The plan is stored on disk (Task 1.2) |
| The test-host rule misjudges a host | Forms sent on a live site | Anything unknown is treated as live; the rule is enforced in the runner, not only the screen |
| Speed numbers vary between machines | Grades change from run to run | A stated tolerance; slow or poor thresholds only; the label "measured in a test browser" |
| Public benchmark sites change | Benchmark numbers drift | The fixture's answer key is exact; public-site keys are re-labelled when a site changes |
| The HTML report grows large | Hard to share | A size limit with screenshot downscaling (Task 2.7) |

## Open questions

1. **Phase 0 go-ahead.** Recommended: yes. It changes D28's order.
2. **The "Looks and reads well" grade.** Every finding in this aspect comes from AI, and D7 says AI never
   sets a grade. Recommended: show AI notes and recommendations for this aspect, with no letter grade,
   labelled "AI review, not graded". Alternative: grade it with the same fixed rules, applied to AI
   findings.
3. **How long a paused plan waits.** Recommended: until the next run starts, with no timeout.
4. **Map library.** Decided in the prototypes (Task 1.1).
