# Wizard design rationale

The Wizard is the app, for everyone ([ADR 0010](../../docs/adr/0010-one-app-with-details-on-demand.md)). It's
written for people who don't test software for a living: product managers, founders, marketers. Engineers
get their detail in the same app, under each finding, in a collapsed "Details for developers". QA Flow
Studio (`packages/web`), the separate dashboard for engineers, is being retired
([UX_IMPLEMENTATION_PLAN.md](../../UX_IMPLEMENTATION_PLAN.md)).

On screen the product is called **Release check-up**, and one pass over a site is a **check-up** (see
[CONTEXT.md](../../CONTEXT.md)).

## Phase 1 direction: Blueprint (Direction B)

Chosen 2026-09-28 from three interactive prototypes (since removed; see git history before the cleanup commit).

**Aesthetic:** Industrial / Utilitarian, dark. Deep navy canvas with white page cards — the map
looks like a technical drawing of the site's structure. Journey paths are coloured lines (violet,
blue, green) like an architect's mark-up. Monospaced reference labels (pg-01, pg-02…) keep the
reading systematic. Findings appear as red/amber left-border annotations on the cards.

**Why it was chosen over A (Cartographer) and C (Signal Board):**
- Direction A (light, paper-and-ink, same palette as the current wizard) was calm but felt like
  an extension of the setup form rather than a new kind of screen.
- Direction C (coloured status tiles, light background) was status-forward but the saturated tiles
  competed too hard for attention before any testing had run.
- Direction B reads as "tool" not "form". The dark canvas makes the map the clear hero, path lines
  are easy to follow at a glance, and the annotation style matches how findings are already
  described in plain language.

**What stays the same:** Atkinson Hyperlegible Next for body text. The same pass/warn/fail colour
meanings. The stamp animation on the report. Writing rules (plain verbs, no jargon).

2026-10-06: after the landing and UX grilling, motion and the stencil font are no longer limited to the
stamp; the landing page follows the system colour scheme; the landing hero and a planned top bar are
described. See Type, Motion, Theming, Landing hero and The top bar.

The direction names are for this document only. None of them ("Direction B", "Blueprint",
"Architectural") appear on screen.

## Concept: a check-up

A check-up is a real sequence, so it's shown as one:

- **The top bar** is on every screen. It holds the places you can go: New check-up, Past check-ups and
  Settings, plus Team Hub when a Report Hub is connected.
  - **Planned, not built yet:** three main links (New check-up, Past check-ups, Settings) and a "More" menu
    holding Baselines and Compare sites. The keyboard hints (Cmd+K and ?) are hidden on touch devices.
- **The step bar** sits under the top bar during a check-up and on its report: Address · Plan · Testing ·
  Report.
  - Finished steps are links, the current step is highlighted, and later steps are greyed out.
  - On phones it reads "Step 2 of 4: Plan".
  - It only shows where you are. Stopping and deleting are always separate buttons, and they ask first.
- **Every screen has its own address,** so Back, Forward, refresh and bookmarks work.
- **The report's one bold element** is an inspector's rubber stamp: *Ready to release* or *Not ready yet*.
  It is the verdict. The A–F grades per aspect sit under it; there is no overall grade to contradict it.

This replaces the check-up slip: a list of steps down the left that filled in with each answer. That suited
the old five-question wizard, not the one-box, URL-first flow.

## Colour

The dark Blueprint palette, defined in [tailwind.config.js](tailwind.config.js):

| Token | Hex | Use |
|---|---|---|
| paper | `#111827` | Page background |
| canvas | `#0D1322` | The map's drawing board |
| surface | `#1E2A3B` | Cards and fields |
| panel | `#1A2438` | Sidebars and side panels |
| ink | `#E8EDF5` | Text |
| ink-soft | `#A7B3C7` | Secondary text |
| rule | `#2A3A52` | Decorative dividers only, never the only cue |
| edge | `#74859F` | Control borders, ≥ 3:1 against paper, panel and surface (WCAG 1.4.11) |
| stamp | `#6C9BF2` | Accent: actions, focus ring, progress |
| pass / fail / warn | `#4ADE9A` / `#FA9191` / `#FBC54A` | Verdict and status, on their tints `#12302A` / `#3A1C20` / `#3A2F14` |
| j1–j5 | `#B69CFB` `#6FB0FA` `#4ADE9A` `#F59AC6` `#FBA35C` | One colour per journey on the map |

Every text pairing is checked by `tests/contrast.test.ts`, which fails the build if a palette change
drops below WCAG 2.1 AA.

Colour rules:
- Grades, statuses and verdicts use these tokens only, never Tailwind's built-in colours, so the contrast
  test covers them.
- App working screens declare `color-scheme: dark`, so the browser's own checkboxes, number fields and
  selects match the board. The landing page and the report follow the rules under Theming.

## Type

- **Atkinson Hyperlegible Next** for everything. It was designed by the Braille Institute for
  readers with low vision, which fits a tool that audits accessibility and an audience that reads
  every word. Base size is 18px; questions are set large (up to 44px) because each screen asks
  exactly one.
- **Big Shoulders Stencil Display** started on the stamp. Stencil lettering is what inspection stamps and
  crates use. It is no longer confined to the stamp: use it where it earns its place. Keep it rare, or it
  stops being special.

## Motion

Motion is allowed everywhere. Each use is judged case by case: it should help someone see what changed or
what is happening, not just decorate. Today that includes the stamp landing on the report, the progress
bar, and the pulse on the page being tested.

One rule is fixed: everything stops under `prefers-reduced-motion`, with no exceptions.

## Theming

- **Landing page:** follows the system colour scheme (`prefers-color-scheme`). Dark is the default look.
  There is no toggle.
- **App working screens:** stay dark.
- **The report:** stays light-capable, so it can be read and printed on paper.

## Landing hero

- The address form sits beside the real sample report. It is a plain GET to `/check?url=`, which prefills
  the New check-up screen.
- The real sample report is the only proof on the page.
- Marketing wording follows [ADR 0018](../../docs/adr/0018-claim-wording.md).

## Writing

Plain verbs, sentence case, and no testing vocabulary: "Clicking “Save invoice”…", not selectors
or event names. Errors say what happened and what to do next. The event-to-sentence rules live in
`src/lib/translate.ts`; finding titles are rewritten in `src/lib/summary.ts`.

- **One name:** Release check-up.
- **"Check" is reserved.** A whole pass is a check-up. "Check" means a Navigation Check or one of the
  graded checks.
- **Nothing technical on the plain-language layer:** no prototype labels, error codes, selectors, checker
  ids, event names or command lines. They go under "Details for developers". A test reads every screen for
  them ([UX_IMPLEMENTATION_PLAN.md](../../UX_IMPLEMENTATION_PLAN.md), Wording).
- **One word per thing:** the settings are "Settings" everywhere.
