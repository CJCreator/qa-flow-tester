# Wizard design rationale

The Wizard is the app, for everyone ([ADR 0010](../../docs/adr/0010-one-app-with-details-on-demand.md)). It's written
for people who don't test software for a living: product managers, founders, marketers. Engineers get their detail
in the same app, under each finding, in a collapsed "Details for developers". QA Flow Studio (`packages/web`), the
separate dashboard for engineers, is being retired
([E2E_PLATFORM_IMPLEMENTATION_PLAN.md](../../docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md)).

On screen the product is called **Release check-up**, and one pass over a site is a **check-up** (see
[CONTEXT.md](../../CONTEXT.md)).

## Direction: Certificate

Chosen 2026-11-05 from three prototypes: Certificate, Signal and Instrument. The prototypes are at
https://claude.ai/artifact/AiNZp46bsp6w46dAhmD3ak. Certificate replaces Blueprint (Direction B, 2026-09-28). The
audit behind the change is in the redesign PR.

**Aesthetic:** an inspection certificate. Quiet paper, green-grey ink, cobalt for actions. It should feel calm,
official and easy to trust.

**One bold element per screen:**

- the verdict tag on the report;
- the site map while testing;
- the address field on New check-up.

Everything else stays quiet. Each screen has exactly one primary action.

**Why Certificate:**

- **Light by default.** Reports print well and stay readable on a phone outdoors.
- **One type family for two scripts.** Anek Latin and Anek Tamil come from the same foundry. English and Tamil
  Website Audits therefore match in weight and width.
- **A memorable verdict that doesn't shout.** The verdict is a perforated tag set in condensed Anek, the only
  loud thing on the report.

**What stays the same:**

- The pass, warn and fail meanings.
- Writing rules: plain verbs, no jargon.
- The site map as a drawing.

**What went:**

- Atkinson Hyperlegible Next.
- The Big Shoulders stencil.
- Monospace all-caps telemetry labels.
- Registration ticks.
- Grid backgrounds outside the map.

Direction names are for this document only and never appear on screen.

## Concept: a check-up

A check-up is a real sequence, so it's shown as one.

- **The top bar** is on every screen. It holds the two areas, Check-ups and Website Audits, plus Settings.
  - Each area has its own row of places under the top bar.
    - Check-ups: New check-up, Past check-ups, Visual baselines, Compare sites.
    - Website Audits: Audits, Shortlist, Audit settings.
  - On phones, Menu lists the same places, grouped by area.
  - The shared online copy has no Website Audits.
- **The step bar** replaces the area row during a check-up and on its report. Its steps are Address, Plan,
  Testing and Report.
  - Finished steps are links, the current step is marked, and later steps are greyed out.
  - On phones it reads "Step 2 of 4: Plan".
  - It only shows where you are. Stopping and deleting are always separate buttons that ask first.
- **Every screen has its own address,** so Back, Forward, refresh and bookmarks work. The app never sends you to
  the marketing page by accident: the logo is the app's home.
- **The report reads in this order:**
  1. the verdict tag and a one-line plain headline;
  2. the grade for each area;
  3. "Fix these first";
  4. the actions (the primary is "New check-up of this site");
  5. the problems, grouped;
  6. what was tested.
- **No overall grade.** The verdict is the answer, and the area grades sit under it.

## Colour

The Certificate palette is defined in [tailwind.config.js](tailwind.config.js) as `palette` (light) and
`darkPalette`, with the same token names.

| Token                     | Light                 | Dark                  | Use                                                    |
| ------------------------- | --------------------- | --------------------- | ------------------------------------------------------ |
| paper                     | `#F4F6F4`             | `#0E1311`             | Page background                                        |
| canvas                    | `#ECEFEC`             | `#0A0E0C`             | The map's drawing board, sunk areas, the step bar      |
| surface                   | `#FFFFFF`             | `#161D1A`             | Cards and fields                                       |
| panel                     | `#EEF1EE`             | `#121815`             | Side panels                                            |
| raised                    | `#FFFFFF`             | `#1C2420`             | Menus, dialogs, sticky bars (with a shadow)            |
| ink / ink-soft            | `#121A17` / `#4C5853` | `#E8EEEA` / `#A8B4AE` | Text / secondary text                                  |
| rule                      | `#D8DDDA`             | `#26302C`             | Decorative dividers only, never the only cue           |
| edge                      | `#7A8580`             | `#6F7C76`             | Control borders, at least 3:1 (WCAG 1.4.11)            |
| stamp                     | `#1D3FD0`             | `#8FA6FF`             | Accent: actions, links, focus ring, progress           |
| on-stamp                  | `#FFFFFF`             | `#0A1233`             | Text on the accent and on danger buttons               |
| pass / warn / fail        | `#0B7547` / `#8A5000` / `#B42318` | `#5CD39B` / `#F0B85A` / `#FF9D93` | Verdict and status, on their `*-tint` |
| j1–j5                     | violet, teal, green, pink, orange |                         | One colour per journey on the map                      |

Every pairing the classes use is checked by `tests/contrast.test.ts` for both palettes. The build fails if a
change drops below WCAG 2.2 AA.

**Rules:**

- Statuses, grades and verdicts use these tokens only, never Tailwind's built-in colours. A test enforces this
  (`style-tokens.test.ts`).
- Never put white text on the accent. Use `text-on-stamp`.
- Cards are flat, with a hairline. A shadow is only for things that float: menus, dialogs and sticky bars.

## Type

**Anek Latin and Anek Tamil** (`@fontsource-variable/anek-latin` and `anek-tamil`) are used for everything.

- **Headings and the verdict** use the same family condensed: `font-stamp` sets `font-stretch: 75%`.
- **Addresses, paths and code** use a system monospace (`font-mono`). It is used for nothing else, and never for
  labels.
- **Scale:** 14 / 15 / 17 (body) / 19 / 22 / 26 / 32 / 40 / 52 px. `text-question` is for one-question screens,
  and `text-verdict` is the verdict tag.
- **14 px (`text-xs`) is the smallest size** for anything people need to read.
- **Sentence case everywhere.** No all-caps labels.
- **Tamil:** `:lang(ta)` gets a line-height of 1.8. Text taken from a page gets `lang` through `textLangAttrs`.

## Layout, shape and depth

- **Widths:** `max-w-prose` (38rem) for reading, `max-w-form` (44rem) for forms, and `max-w-workspace` (72rem)
  for the plan, the report and the map.
- **Radii:** `rounded-control` 6px, `rounded-card` 10px, `rounded-panel` 14px, `rounded-pill`.
- **Shadows:** `shadow-level-1` to `shadow-level-4` are CSS variables. They are deeper in the dark, where they are
  the only lift.
- **Layers:** `z-sticky` 20, `z-header` 40, `z-menu` 50, `z-dialog` 60, `z-toast` 70.
- **Buttons:**
  - `.btn-primary`, `.btn-quiet` and `.btn-danger` are all 48px high.
  - `.btn-sm` is 44px. Every tap target is at least 44px.
  - `.btn-link` is an inline action.
  - There is one primary per screen.
- **Shared classes:**
  - `.badge` and its tones (`-stamp`, `-pass`, `-warn`, `-fail`).
  - `.disclosure` (a `<details>`).
  - `.segmented` for two or three choices.
  - `.table-plain`.
  - `.field`.

## Motion

Motion helps someone see what changed. Each use is judged on that.

- **Durations:** `duration-fast` 120ms (hover, press), `duration-base` 200ms (opening and closing),
  `duration-slow` 320ms (screens and dialogs).
- **Easings:** `ease-standard`, `ease-enter`, `ease-exit`.
- **Where it is used:**
  - The verdict lands once.
  - `.screen-in` fades a screen in.
  - Progress bars move.
  - The page being tested pulses on the map.
- **One fixed rule:** everything stops under `prefers-reduced-motion`, with no exceptions. Scripted scrolling
  uses `scrollBehavior()` from `lib/format.ts`.

## Theming

- **Light is the default** on every page.
- **Dark** follows the device (`prefers-color-scheme`), unless the person chose light.
- **A saved choice** (`qa-theme` = `light` or `dark`, see `src/lib/theme.ts`) wins over the device. It is applied
  before the first paint.
- **Print** is always light.

## Landing hero

- The address form sits beside the real sample report. It is a plain GET to `/check?url=`, which prefills the New
  check-up screen.
- The real sample report is the only proof on the page.
- Marketing wording follows [ADR 0018](../../docs/adr/0018-claim-wording.md).

## Writing

Plain verbs, sentence case, and no testing vocabulary: "Clicking “Save invoice”…", not selectors or event names.
Errors say what happened and what to do next. The event-to-sentence rules live in `src/lib/translate.ts`; finding
titles are rewritten in `src/lib/summary.ts`.

- **One name:** Release check-up.
- **"Check" is reserved.** A whole pass is a check-up. "Check" means a Navigation Check or one of the graded
  checks.
- **Nothing technical on the plain-language layer:** no prototype labels, error codes, selectors, checker ids,
  event names or command lines. They go under "Details for developers". A test reads every screen for them
  ([E2E_PLATFORM_IMPLEMENTATION_PLAN.md](../../docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md), Wording).
- **One word per thing:** the settings are "Settings" everywhere.
- **A button names what happens, and the result uses the same words.** "Download the report" leads to "Report
  downloaded".
