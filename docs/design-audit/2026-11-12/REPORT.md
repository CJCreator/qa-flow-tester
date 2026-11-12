# Design audit, 2026-11-12

Branch `worktree-design-audit` (base `15f9fac`), 13 commits. Walked in the project's Playwright Chromium at **1440, 768
and 375** (the Chrome window would not resize; Chrome was used for a 1528px desktop spot check only). Final state:
63 captures (21 screens × 3 widths) with no horizontal scroll, no unlabeled field, no overflow, no text under 14px;
42 captures at 200% text with no horizontal scroll; unit tests 3,918 of 3,918; build clean; lint 0 errors.

Core paths walked: (1) landing → New check-up → scan → Plan Review → Testing → Report → Past check-ups, as a real
check-up of a five-page demo site; (2) Visual baselines, Compare sites, Search and AI visibility, Settings;
(3) Website Audits: list, start, progress, versions, results, review, export, share, helpers, Shortlist, Audit
settings, helper sign-in; (4) Page not found.

## 1. Taste baseline

1. **Who:** people who release a web app without a QA person: founders, product managers, marketers
   (`packages/wizard/DESIGN.md:3-6`, `packages/wizard/index.html:8-12`).
2. **For what:** paste an address, read and approve a Plan, get one plain-words verdict with the fixes in order
   (`README.md:59-66`, `CONTEXT.md:59-61, 107-109`).
3. **Character:** a tool that behaves like an inspection certificate: calm, official, trusted; one bold element and
   one primary action per screen (`DESIGN.md:17-26`).

At its best it reads like a document someone competent signed: the verdict is the only loud thing, every other screen
has one obvious next step, nothing explains the machinery, and the file you hand to someone else looks like the
product. The documented system is sound; the screens drifted from it in the places listed below, and the system was
silent on seven points (section 5).

## 2. Improvements made

Ranked by impact.

| #   | What changed                                                                                                                                                                                                            | Why (baseline)                                                                                              | Commit                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | Exported HTML report and the landing sample restyled from navy Blueprint to Certificate; no sideways scroll from 320px                                                                                                  | The only proof on the landing page, and the file people share, did not look like the product                | `4841daa` (L2)                  |
| 2   | Sticky top bar and approve bar made opaque                                                                                                                                                                              | Text scrolling underneath showed through and collided with the bar's own text on Plan Review and the Report | `4577e77`                       |
| 3   | Plan Review: totals on top, settings folded into one "Change what runs" row; phone approve bar is one short line                                                                                                        | Seven controls at equal weight sat between the title and the first plan item                                | `e862cbb` (L2)                  |
| 4   | Focused controls no longer land behind the approve bar                                                                                                                                                                  | 7 Tab stops at 1440 and 21 at 375 were hidden (WCAG 2.4.11)                                                 | `ee0fe0d`                       |
| 5   | Website Audit findings grouped: same finding once, with a count and one "Where it was found"                                                                                                                            | About 20 of 31 cards were the same finding; page 13,669px → 9,876px at 1440, 19,454px → 13,266px at 375     | `770ea9b` (L2)                  |
| 6   | 200% text: landing header, Settings, Plan Review, audit results and Audit settings no longer scroll sideways                                                                                                            | Correctness floor                                                                                           | `cac0ab9`, `3742898`, `8e477ce` |
| 7   | Site map: rows use the real card height and columns follow the map's width                                                                                                                                              | Cards touched, and the fourth page started out of view on Testing                                           | `4577e77`                       |
| 8   | Report grade cards one column on phones; an ungraded area shows an empty tile                                                                                                                                           | "Findable" and "Not checked" overlapped at 375                                                              | `4577e77`                       |
| 9   | Landing hero: the address field is full column width at the app's field size                                                                                                                                            | The field that should be the bold element was 240px beside a wider button                                   | `a97bd41`                       |
| 10  | Landing: header, main and footer are sibling landmarks                                                                                                                                                                  | "Skip to the content" skipped nothing                                                                       | `a97bd41`                       |
| 11  | Every `.field` at least 44px; Show, Print, drag handles, document Open links, "Where it was found" reach 44px                                                                                                           | Tap targets (DESIGN.md)                                                                                     | `4577e77`, `3742898`, `770ea9b` |
| 12  | Three-choice dialogs stack full width with one filled button, tabbed in reading order                                                                                                                                   | A filled red and a filled blue button competed in ragged rows                                               | `4577e77`, `e1f2136`            |
| 13  | Audit tab strip centres the current tab on phones and fades at the edge                                                                                                                                                 | Share and Helpers started off-screen                                                                        | `3742898`                       |
| 14  | Audit save bar shows only with unsaved changes                                                                                                                                                                          | "Every change is saved." sat beside two disabled buttons, covering 150px of a phone                         | `3742898`                       |
| 15  | One primary on empty Past check-ups; no filters on empty Visual baselines; no single-choice Intent switches                                                                                                             | One primary per screen; controls only when there is a choice                                                | `4577e77`                       |
| 16  | Copy: the scan screen names Check-ups (not "New check-up") for the dot; shorter Compare introduction; the access choice is no longer repeated as a badge and a hint; review sections named by position, not internal id | Plain words; nothing technical; no repetition                                                               | `4577e77`, `3742898`            |
| 17  | `.btn-danger-quiet` replaces six hand-written class strings; raw `z-50`, `z-[60]`, `text-6xl` removed; palette key reads Ctrl K off Apple keyboards; the in-progress dot no longer shifts the nav 16px                  | Token discipline, layout shift                                                                              | `4577e77`, `a97bd41`, `ee0fe0d` |
| 18  | Landing area links kept (a test requires them) and made 44px                                                                                                                                                            | `a97bd41` had removed them; restored                                                                        | `d42447d`                       |

## 3. L2 evidence

All in `docs/design-audit/2026-11-12/`, full-page, at 1440, 768 and 375.

| Commit                   | Before                                     | After                                     | Revert               |
| ------------------------ | ------------------------------------------ | ----------------------------------------- | -------------------- |
| `e862cbb` Plan Review    | `plan-review-before-{1440,768,375}.jpg`    | `plan-review-after-{1440,768,375}.jpg`    | `git revert e862cbb` |
| `4841daa` HTML report    | `html-report-before-{1440,768,375}.jpg`    | `html-report-after-{1440,768,375}.jpg`    | `git revert 4841daa` |
| `770ea9b` Audit findings | `audit-findings-before-{1440,768,375}.jpg` | `audit-findings-after-{1440,768,375}.jpg` | `git revert 770ea9b` |

## 4. L3 proposals (not implemented)

1. **One left edge.** Narrow screens (New check-up, Website Audits list and start, Settings) centre a 44rem column,
   so the title sits about 270px right of the navigation's first item at 1440, and the title jumps sideways between
   sibling tabs. Proposal: keep the three reading widths but start every column at the workspace gutter.
   Tradeoff: single-question screens lose their centred, form-like calm. Impact: high on perceived polish; it changes
   the layout rule in DESIGN.md, so it is yours to decide.
2. **Plan Review as a document with a rail.** Still 7,782px at 1440 and 10,672px at 375 for a five-page site.
   Proposal: sections closed by default except "Needs your answer", with "Find in the plan" in a sticky side rail
   from 1024px. Tradeoff: one more click to read a section; "the complete Plan" is less visibly complete.
   Impact: high for first-time readers.
3. **Website Audit results and review as separate pages.** Results is 9,876px and the review form 21,122px.
   Proposal: one page per results section (the left list becomes real navigation) and one finding per step in review.
   Tradeoff: navigation model change; printing a whole audit needs its own path. Impact: high in that area.
4. **Sample report regenerated from the new generator, and the export's wording brought to the writing rules.**
   The sample's body keeps some old inline colours; headings such as "Changes Since Last Run" are Title Case and
   finding titles are raw checker text ("WCAG 1.4.3 … (color-contrast)"). Tradeoff: needs a demo site with known
   findings (the repo has no fixture sites). Impact: medium.
5. **Helpers tab hidden while helper sign-in is switched off.** Needs the status where the tabs render (a new
   call or a shared store). Tradeoff: a feature becomes invisible until configured. Impact: low to medium.

## 5. Doc revisions (`packages/wizard/DESIGN.md`, commit `0bdf855`)

| Change                                                                 | Triggering screen                             |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| Sticky bars are opaque                                                 | Plan Review and Report at 1440 and 375        |
| 44px in both directions; `min-w-[44px]` for short labels               | Plan Review "Show", Report "Print"            |
| `.btn-danger-quiet`; one filled button per dialog; three choices stack | Testing, "Stop testing?" dialog               |
| The empty state holds the one primary; no single-choice filters        | Past check-ups, Visual baselines, Plan Review |
| Layer tokens only                                                      | Landing header, LandingRoot skip link         |
| Bottom bar keeps focus clear; one short line on phones                 | Plan Review at 375                            |
| Site map lays out from real card size, two to four columns             | Testing at 1440                               |
| Landing hero focal field; landmarks                                    | Landing at 1440 and 375                       |
| New section "The report as a file"                                     | Landing sample report at 375                  |

## 6. Correctness table

| Page                       | Viewport               | Issue                                                                                      | Severity | Status       |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ | -------- | ------------ |
| Plan Review, Report        | all                    | Translucent sticky bars: text shows through and collides                                   | high     | fixed        |
| Plan Review                | 1440, 375              | Focused control hidden behind the approve bar                                              | high     | fixed        |
| Report                     | 375                    | "Findable" overlaps "Not checked" in grade cards                                           | high     | fixed        |
| Landing sample report      | 375                    | Verdict covers the site address; page 406px wide                                           | high     | fixed        |
| Landing                    | 1440, 375 at 200% text | Header forces sideways scroll                                                              | high     | fixed        |
| Plan Review, audit results | 375 at 200% text       | Sideways scroll (521px, 703px)                                                             | high     | fixed        |
| Settings, Audit settings   | 375 at 200% text       | Sideways scroll (435px, 384px)                                                             | medium   | fixed        |
| Audit pages                | 375                    | Current tab (Share, Helpers) off-screen, no cue                                            | high     | fixed        |
| Testing                    | 1440                   | Map cards touch; fourth page out of view                                                   | medium   | fixed        |
| Landing                    | all                    | Header and footer inside `main`; skip link skips nothing                                   | medium   | fixed        |
| Plan Review                | all                    | Drag handles 32px, Show 36px, fields and select 37 to 40px                                 | medium   | fixed        |
| Landing                    | all                    | Six 28px-tall links                                                                        | medium   | fixed        |
| Report                     | all                    | Print 37px wide                                                                            | low      | fixed        |
| Audit results              | all                    | "Where it was found" 22px tall; Open links 34px wide                                       | medium   | fixed        |
| Stop dialog                | all                    | Tab order bottom to top after stacking (introduced, then fixed)                            | medium   | fixed        |
| Top bar                    | 1440                   | In-progress dot shifts "Website Audits" 16px                                               | low      | fixed        |
| Testing                    | 1440                   | Header 32px left of the top bar's edge                                                     | low      | fixed        |
| Audit start                | 1440                   | Address error stays after a valid address                                                  | medium   | fixed        |
| Audit settings, review     | 375                    | Save bar always shown with disabled buttons                                                | medium   | fixed        |
| Landing pricing table      | 1440                   | Row headings draw a darker, offset rule                                                    | low      | fixed        |
| Top bar                    | desktop                | ⌘K shown on Windows                                                                        | low      | fixed        |
| Dialogs (stop, delete)     | 1440, 375              | Focus moves in, stays in, Esc returns focus                                                | n/a      | pass         |
| All screens                | all                    | Visible focus on every Tab stop checked (6 screens at 1440, 3 at 375)                      | n/a      | pass         |
| Audit review               | 1440                   | 21,122px form; fields 523px wide in a 1088px column; textarea clips                        | medium   | open (L3 #3) |
| Audit helpers              | all                    | Tab for a switched-off feature                                                             | medium   | open (L3 #5) |
| Audit results              | all                    | Finding titles are raw checker text                                                        | medium   | open (L3 #4) |
| Check-ups area row         | 375                    | Scrolls sideways with "Visual baselines" cut and no cue                                    | low      | open         |
| Report                     | 375 at 200% text       | Host breaks mid-word ("localhos / t:3060")                                                 | low      | open         |
| Audit export               | all                    | PDF and Word radio labels 36 to 45px wide                                                  | low      | open         |
| Landing                    | dark theme             | Light sample report inside a dark page                                                     | low      | open         |
| Exported report            | all                    | Title Case headings                                                                        | low      | open (L3 #4) |
| Settings                   | all                    | Small grey option captions: contrast not measured                                          | low      | unverified   |
| New check-up               | Chrome 1528            | Chrome stopped answering screenshots after typing an address; not reproduced in Playwright | low      | unverified   |
| All                        | all                    | Layout shift not measured with a metric; judged by eye                                     | low      | unverified   |

## 7. Assumptions and open questions

- **Not reached, so unverified:** the shared (beta) copy's notices, sign-in and consent flows, AI key flows (no key
  was used; plans were written by fixed rules), lost-connection screen, Visual baselines and Compare with data, the
  Plan's Site map tab, Shortlist with entries, share previews and Shared Links, signed-in helper view.
- **200% zoom** was emulated by doubling the root font size (text zoom), not browser page zoom.
- **Contrast** rests on the project's `contrast.test.ts` (passing) and a dark-theme pass by eye; no new colours were
  added.
- **Hero small print:** I kept "The address you type is sent with the page you go to…". It explains the system, but
  it reads as a deliberate privacy disclosure. Trim it?
- **Evidence weight:** `docs/design-audit/2026-11-12/` is about 11 MB of JPEGs. Keep it in the repo, or remove it
  before merging (`git rm -r docs/design-audit`)?
- **Tests changed:** `packages/core/tests/html-report.test.ts` (pinned the old navy), and three wizard tests that
  pinned replaced markup (clean-state save bar, section labels, empty Shortlist line).
- **Pre-existing, left alone:** `packages/wizard/src/lib/context.ts` fails `prettier --check`; lint reports 117
  warnings and 0 errors repo-wide.
- **Local data created** in the worktree's own store: two check-ups and two Website Audits of the demo site.
- No instructions aimed at an AI were found in any page, file or tool output.

## 8. Round 2: decisions taken and what was built

Decisions (2026-11-12): move the hero's address line into the FAQ; shrink the screenshots; build four of the
proposals; open a draft pull request. Sections 4, 6 and 7 above describe the state before this round.

| What changed                                                                                                                                                              | Level | Commit    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- |
| One left edge: every page column starts at the workspace gutter (proposal 1)                                                                                              | L2    | `4ab4e1f` |
| Plan Review sections start closed, except "Needs your answer" and "Not found in app" (proposal 2, without the rail): 7,782px → 2,486px at 1440, 10,672px → 3,311px at 375 | L2    | `f855e65` |
| Exported report headings in sentence case (proposal 4, wording only)                                                                                                      | L1    | `e1f7256` |
| Hero address line moved into the FAQ answer and its structured data                                                                                                       | L1    | `b018eb6` |
| Audit review fields full width, long-text boxes grow with their text, hierarchy actions aligned (proposal 3, fields only): 21,122px → 19,400px at 1440                    | L1    | `79fadbb` |
| Helpers tab left out once helper sign-in is known to be off (proposal 5)                                                                                                  | L1    | `79fadbb` |
| Area rows fade and centre the current link on phones; report host wraps between words; export labels 44px wide                                                            | L1    | `79fadbb` |
| Evidence re-saved at half size: about 11 MB → 3 MB                                                                                                                        | n/a   | `0170fda` |

L2 evidence for this round, in this folder:

| Commit                         | Before                                                                                    | After                                           | Revert               |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------- |
| `4ab4e1f` One left edge        | `left-edge-before-new-checkup-{1440,768}.jpg`, `left-edge-before-website-audits-1440.jpg` | `left-edge-after-…` (same names)                | `git revert 4ab4e1f` |
| `f855e65` Plan sections closed | `plan-review-after-{1440,768,375}.jpg`                                                    | `plan-sections-closed-after-{1440,768,375}.jpg` | `git revert f855e65` |

Correctness rows from section 6 that this round closes: Check-ups area row cue (fixed), Report host breaking
mid-word (fixed), Audit export label width (fixed), Exported report Title Case headings (fixed), Audit helpers tab
(fixed, with the limit below), Audit review field width and clipped text (fixed; the page is still 19,400px).

Still open after this round:

- **Not built:** the Plan Review side rail; Website Audit results and review as separate pages; regenerating the
  sample report (its body keeps some old inline colours) and plain-words finding titles.
- **Helpers tab:** it disappears only after the Helpers screen has been opened once in the page session, because
  that is when the app learns sign-in is off. A reload shows it again until then.
- **Landing in the dark theme:** the sample report stays light inside a dark page.
- **Unverified:** Settings caption contrast; the Chrome freeze after typing an address; layout shift by metric; the
  screens listed in section 7 that need a key, a sign-in or the shared copy.
- **History size:** the first round's full-size screenshots remain in this branch's history; a squash merge drops
  them.

Verification on the final state: 63 captures (21 screens at 1440, 768 and 375) with no horizontal scroll, unlabeled
field, overflow or text under 14px; 42 captures at 200% text with no sideways scroll; keyboard jump, direct item
link and "Open every section" checked on the closed plan.
Unit tests 3,925 of 3,925; full build clean; lint 0 errors (117 warnings repo-wide, not compared against the base).
