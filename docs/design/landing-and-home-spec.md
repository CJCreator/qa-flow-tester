# Landing page and home page: design spec and audit

Status: landing page built (2026-10-06). Decisions come from the 2026-10-06 grilling session. The look is the existing Blueprint direction ([packages/wizard/DESIGN.md](../../packages/wizard/DESIGN.md)); nothing in the design system changed.

## 1. Decisions this rests on

| Question      | Decision                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page split    | Landing is a separate public page at `/`. A "Run a free check-up" button leads to the app's address screen at `/check`. The home screen (the check-up form) stays where it was, now at `/check`. |
| One goal      | Run a free check-up, no sign-up.                                                                                                                                                                 |
| Look          | The Blueprint look: same tokens, Atkinson Hyperlegible Next, the stencil stamp as the hero image.                                                                                                |
| Headline      | "QA without a QA team."                                                                                                                                                                          |
| Trust         | A real sample report, a source-available badge, safety promises up front. No invented logos, quotes or counts.                                                                                   |
| Sample report | A real check-up of the demo site in `fixtures/test-app`, saved as a static page and labelled as an example.                                                                                      |
| Pricing       | "Free while we're in beta", no prices, paid plans "planned".                                                                                                                                     |
| Cold start    | The landing page wakes the free online copy on load (see 6.3).                                                                                                                                   |
| Data claim    | Written from the code: see 6.4.                                                                                                                                                                  |

## 2. Audience and message

Founders and developers with no QA person ([ADR 0010](../adr/0010-one-app-with-details-on-demand.md)). They compare us with their own Playwright scripts and with Lighthouse or the axe extension. The page answers three questions in order: _what is it_ (hero), _is it safe to point at my site_ (promise strip), _what will I get_ (verdict preview, sample report).

Writing rules are the app's ([DESIGN.md](../../packages/wizard/DESIGN.md#writing)): plain verbs, sentence case, "check-up" for a whole pass, no testing vocabulary. Nothing claims what is not true today (no "daily limit", no "your report is private").

## 3. Page map and wireframes

Desktop at 1280 px. Every section sits in `max-w-6xl`, 16 px gutter on phones (24 px from 640 px up).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [✓] Release check-up        How it works  Sample report  Pricing [Run a free check-up] │  A. Sticky header, 1 row
├──────────────────────────────────────────────────────────────────────────┤
│ release check-up · free during the beta         ┌───────────────────────┐ │
│                                                 │ pg-01 · /invoices/new │ │
│ QA without a                                    │ ╔═NOT READY YET═╗     │ │  B. Hero (bg canvas)
│ QA team.                  <- h1, 68 px          │ ▌Must fix  ...        │ │     left: message + CTA
│                                                 │ ▌Should fix ...       │ │     right: verdict preview
│ Paste your site's address. Release check-up     │ ▌Should fix ...       │ │
│ scans it, tests it in a real browser, and tells └───────────────────────┘ │
│ you in plain words whether it's ready.            An illustration.        │
│ [ Run a free check-up ]  See a sample report                              │
│ No sign-up. On a live site it only looks...                               │
│ ⟳ Getting the free online copy ready...   <- wake note (status)           │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌ Looks, never touches ┐ ┌ You approve every test ┐ ┌ Test copies only … ┐ │  C. Safety promises (3 cards)
├──────────────────────────────────────────────────────────────────────────┤
│ Four steps from address to verdict                                       │
│ ┌01 Paste┐ ┌02 Review┐ ┌03 Watch┐ ┌04 Read the verdict┐                    │  D. How it works (#how)
├──────────────────────────────────────────────────────────────────────────┤
│ What it looks at                         (bg panel)                      │
│ ▌It works  ▌Everyone can use it  ▌It's fast enough  (2 rows of 3)        │  E. Six areas
├──────────────────────────────────────────────────────────────────────────┤
│ See a real report before you run anything    [ Open the sample report ]  │  F. Proof
├──────────────────────────────────────────────────────────────────────────┤
│ Free while we're in beta                  (bg panel, #pricing)           │  G. Pricing (text only)
├──────────────────────────────────────────────────────────────────────────┤
│ Questions people ask first   ▸ 7 native <details>                        │  H. FAQ
├──────────────────────────────────────────────────────────────────────────┤
│ Find out if you're ready to ship         [ Run a free check-up ]         │  I. Closing CTA (bg canvas)
├──────────────────────────────────────────────────────────────────────────┤
│ [✓] Release check-up   Source-available…    Source on GitHub             │  J. Footer
└──────────────────────────────────────────────────────────────────────────┘
```

Phone (390 px): one column. The header keeps the brand and a short button ("Run a check-up"); its text links are hidden. The verdict preview drops under the hero copy. Sections stack in the same order.

Annotations:

- **A.** Three links and one button. The button is the only filled element in the header, so the eye finds it. It repeats in B and I: three placements, one destination. The header button's text is shorter on phones so the bar stays on one row.
- **B.** The headline is the one thing at display size; the stamp is the one bold graphic. The stamp lands once on load and stops under reduced motion (existing `.stamp` rule). The preview is captioned "An illustration" so it can't be mistaken for a real result.
- **C.** Sits straight under the hero because "will it change my site?" is the objection that stops a founder pasting a live address.
- **F.** The only proof element that isn't a claim. It links to a real report on a demo site.
- **G.** No numbers. It states what is true: free, shared, one at a time, public sites only, sleeps when idle.

## 4. Home page (`/check`)

The check-up form is unchanged apart from three things: it moved to `/check`, the long "how it works" and FAQ strip was removed (it lives on the landing page), and the tab title is now "New check-up · Release check-up". The top bar's "New check-up" and the logo lead here. The landing page has its own header and no app navigation.

A first-time visitor no longer has to connect an AI key before scanning (audit P0-1, fixed): with no key, fixed rules write the plan, and the key is offered as an optional upgrade above the form.

## 5. Design system as used

Tokens come from [tailwind.config.js](../../packages/wizard/tailwind.config.js); the contrast test covers every pairing used here.

| Role                  | Token                                                | Used for                                             |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Page                  | `paper` `#111827`                                    | body background, sections A, C, D, F, H              |
| Hero and closing band | `canvas` `#0D1322`                                   | B, I                                                 |
| Alternate band        | `panel` `#1A2438`                                    | E, G                                                 |
| Cards                 | `surface` `#1E2A3B` + `rule` border                  | C, D, verdict preview, FAQ                           |
| Text                  | `ink` `#E8EDF5`, `ink-soft` `#A7B3C7`                | primary, secondary                                   |
| Accent                | `stamp` `#6C9BF2`                                    | primary button, step numbers, area rules, focus ring |
| Verdict               | `fail` `#FA9191`, `warn` `#FBC54A`, `pass` `#4ADE9A` | stamp and finding borders, "✓" in the wake note      |

Type (all Atkinson Hyperlegible Next, stamp in Big Shoulders Stencil Display):

| Use         | Size                                              | Weight               |
| ----------- | ------------------------------------------------- | -------------------- |
| h1          | `clamp(2.5rem, 1.6rem + 4vw, 4.25rem)`, line 1.05 | 700                  |
| h2          | 30 px, 36 px from 640 px                          | 700                  |
| Hero lead   | 20 px                                             | 400, `ink-soft`      |
| Body        | 18 px (base)                                      | 400                  |
| Small       | 14 px                                             | 400                  |
| Mono labels | system mono 12–14 px                              | 700 for step numbers |
| Stamp       | 30 px, 36 px from 640 px, uppercase               | stencil              |

Spacing: sections are 56 px top and bottom (80 px from 640 px). Cards use 16 px × 20 px padding and a 16 px gap. Radii are `card` 8 px and `panel` 12 px.

## 6. Components

| Component                     | File                                                                             | Notes                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LandingScreen`               | [screens/LandingScreen.tsx](../../packages/wizard/src/screens/LandingScreen.tsx) | The whole page. Sections are plain markup; there is no shared "section" component beyond `SectionTitle`.                                                     |
| `StartButton`                 | same                                                                             | A plain `<a>` to `startAddress()`: `/check` here, or the online copy's `/check` from a static host. A page load, so the app's code is only fetched on click. |
| `WakeNote`                    | same                                                                             | `role="status"`; text for `waking`, `ready`, `failed`; renders nothing when there is nothing to wake.                                                        |
| `VerdictPreview`              | same                                                                             | `<figure>` with a caption; the stamp uses the app's `.stamp` class.                                                                                          |
| `LandingRoot`                 | [LandingRoot.tsx](../../packages/wizard/src/LandingRoot.tsx)                     | Skip link, `<main id="main">` and the page, without the app.                                                                                                 |
| `useWakeOnline`               | [hooks/useWakeOnline.ts](../../packages/wizard/src/hooks/useWakeOnline.ts)       | One no-cors `GET /healthz` on load; states `none`, `waking`, `ready`, `failed`; 90 s timeout by default, `VITE_WAKE_LIMIT_SECONDS` (5 to 600).               |
| `ThemeToggle`                 | same                                                                             | "Light theme" button (`aria-pressed`) in the header; token swap only, landing page only; saved in `localStorage` (`qa-theme`). Logic in `lib/theme.ts`.      |
| `onboarding` helpers          | [lib/onboarding.ts](../../packages/wizard/src/lib/onboarding.ts)                 | `hasNonDefaultOptions` (opens "More options"), `hasFinishedCheckup` (shows the top-bar shortcuts).                                                           |
| `startAddress`, `wakeAddress` | [lib/online.ts](../../packages/wizard/src/lib/online.ts)                         | Pure; tested in `tests/online.test.ts`.                                                                                                                      |
| FAQ and steps                 | [lib/faq.ts](../../packages/wizard/src/lib/faq.ts)                               | The text the page shows. Mirrored in the `FAQPage` and `HowTo` data in `index.html`: keep the two in step.                                                   |

Interaction states: buttons use the app's `.btn-primary` / `.btn-quiet` / `.btn-link` (hover, `focus-visible` ring, 48 px min height; the header button 44 px). FAQ items are native `<details>`, so they work without scripts and by keyboard.

## 7. Behaviour

### 7.1 Routes

`/` is the landing page and is public (indexed, in the sitemap). `/check` and every other screen are private (`noindex`). `/sample-report.html` is public. The runner's static server marks pages `noindex` except `/`, `/index.html` and `/sample-report.html`.

### 7.2 Where the button leads

Served by the app itself (Render, local): `/check`. Served from Vercel with `VITE_ONLINE_APP_URL` set: that origin's `/check`.

### 7.3 Cold start

The free Render copy sleeps after 15 minutes and takes about a minute to wake. From Vercel the landing page calls its `/healthz` the moment it opens and shows "Getting the free online copy ready", then a tick. If the call fails or takes over 90 seconds (the default; `VITE_WAKE_LIMIT_SECONDS` changes it), it says the copy is slow to wake. Served by the app itself there is nothing to wake and nothing is shown.

### 7.4 What the page says about data

From [beta.ts](../../packages/runner/src/beta.ts), [server.ts](../../packages/runner/src/server.ts) and [render.yaml](../../render.yaml): on the online copy, AI keys and sign-ins are held in memory for a session of up to 24 hours and never written to disk; only public sites can be checked; one check-up runs at a time for everyone; and each visitor sees only their own check-ups.

How that last part works (`betaScope` in the runner): the runner holds one run at a time, so "the current run" belongs to whoever started it. For everyone else it doesn't exist. Their status reads idle (plus `busy` while someone else's run is going), and the plan, plan edits, progress stream, report, report downloads, evidence files, past check-ups, waiting plans and remembered sites are all scoped to the visitor's session. A plan left waiting by one visitor is kept aside for them when another starts. Visual baselines are closed. Covered by `tests/beta-privacy.test.ts`.

Known limits: the server and its disk are still shared, so don't check anything that must not sit on shared hardware. Marking a problem "intended" is remembered per site for the whole copy. Two visitors with a waiting plan for the same site share one parking slot. Check-ups from before a restart are hidden from everyone. Per-visitor folders are never cleaned up.

## 8. Accessibility

Checked by reading the markup, by the existing contrast test and by an axe test in Chromium (`tests/landing-audit-browser.test.ts`: no serious or critical issue, dark, light and 375 px); no assistive-technology pass has been done.

- One `h1`; each section is a `<section aria-labelledby>` with an `h2`; the promise strip has a screen-reader-only heading.
- Skip link to `#main`, first in the tab order.
- Every text pairing is in `tests/contrast.test.ts` (WCAG 2.1 AA). The stamp text (`fail` on `canvas`) is large text.
- Targets are at least 44 px high. Focus ring is the app's 3 px `stamp` outline.
- `prefers-reduced-motion` stops the stamp and the spinner (existing rules).
- The wake note is a live region and is not the only cue: the button works regardless.
- Page scales to 200% zoom: nothing is fixed width, and the e2e test checks for sideways scroll at 375 px.

## 9. Performance

Measured on a production build (gzip): landing JS 47.6 kB (entry) + 7.7 kB (page) ≈ **55 kB**, down from the single 137 kB bundle the app used to ship to every visitor; the app's 83 kB is fetched only on click. CSS 8.1 kB. Fonts: Atkinson (latin 34 kB) and the stencil face (latin 15 kB) as WOFF2 from the same origin. No images, no third-party requests, no layout shift from late content (the wake note sits below the CTA). Not yet measured: Lighthouse scores and real-device LCP.

## 10. SEO and sharing

Title, description, canonical, JSON-LD (`Organization`, `WebSite`, `SoftwareApplication`, `HowTo`, `FAQPage`), `robots.txt`, `sitemap.xml` and `llms.txt` were updated to the new message and the true data claims. See P1-2 for the share image.

## 11. Implementation handoff

There is no Figma file (decided). The handoff is the code and this document.

| Change          | Files                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| New routes      | `src/lib/router.ts` (`landing` at `/`, `new` at `/check`), `tests/router.test.ts`                                                                |
| Landing         | `src/screens/LandingScreen.tsx`, `src/LandingRoot.tsx`, `src/main.tsx` (splits the bundle)                                                       |
| Wake and links  | `src/lib/online.ts`, `src/hooks/useWakeOnline.ts`, `tests/online.test.ts`                                                                        |
| App wiring      | `src/App.tsx` (no top bar or runner polling on the landing page), `src/hooks/useRunnerConnection.ts` (`enabled`)                                 |
| Copy            | `src/lib/faq.ts` (was `components/HomeInfo.tsx`), `index.html`, `public/llms.txt`, `public/sitemap.xml`, `public/robots.txt`, `src/lib/title.ts` |
| Public paths    | `packages/runner/src/ui-static.ts`                                                                                                               |
| Sample report   | `packages/wizard/public/sample-report.html`                                                                                                      |
| End-to-end test | `tests/wizard-e2e.test.ts` (opens on the landing page, follows the button to `/check`)                                                           |

## 12. Audit: must-fix list

Rated against the decisions above. P0 blocks the goal (a visitor completing a free check-up) or makes a false claim. P1 should ship with the page. P2 is polish.

### P0

1. ~~**A first-time visitor can't scan without an AI key.**~~ Fixed 2026-10-06. `canStart` in [NewCheckupScreen.tsx](../../packages/wizard/src/screens/NewCheckupScreen.tsx) no longer needs a saved key; without one the request sends `useAI: false`, so no AI is used and fixed rules write the plan (`tests/start-run.test.ts`), and the key panel reads "Connect the AI for a smarter plan", marked optional. The end-to-end test now expects the Scan button enabled before a key is saved. Checked by hand against a keyless runner (beta mode, so no saved key): a scan of example.com reached the plan. A correction to the first audit: the runner does _not_ accept `planWithoutAI` without a key, which is why the request uses `useAI: false` instead.
2. ~~**The source-available badge has no licence behind it.**~~ Fixed 2026-10-06. [LICENSE](../../LICENSE) is the Functional Source License 1.1 with an MIT future license (FSL-1.1-MIT), copyright 2026 CJCreator, copied from the official template at fsl.software. The README had wrongly said MIT; it now describes FSL-1.1-MIT, `package.json` points to the file, and the landing footer links to it.
3. ~~**Privacy claims were wrong, and the address screen didn't warn.**~~ Fixed 2026-10-06. The FAQ, `llms.txt` and JSON-LD now tell the truth. The runner's status says `beta: true` on the shared copy, and the check-up screen shows a "This is a shared copy" notice. Later the same day the copy was changed so each visitor sees only their own check-ups (section 7.4), and the notice says so. Covered by a runner test (`beta.test.ts`) and by the end-to-end test, which checks the notice is absent on a normal copy.
4. ~~**Sleeping server with no feedback.**~~ Fixed as far as our code can reach, 2026-10-06. The connection screen (what the Vercel site shows on `/check`) now wakes the online copy as it opens and shows the same "getting the online copy ready" note beside the "Open the online app" button. Not fixable here: someone who opens the Render address directly sees Render's own waiting page before any of our code loads. Only an always-on server removes that, which the $0 budget rules out for now.

### P1

1. **No measurement.** Nothing records visits or button clicks, so the conversion goal can't be judged. Needs a cookie-free, free counter (your decision).
2. **The share image is an SVG** (`public/og-image.svg`). LinkedIn, X and Slack don't show SVG previews. Fix: a 1200 × 630 PNG.
3. ~~**The sample report is only as fresh as its run.** It must be regenerated when the report's format changes.~~ Done 2026-10-07: `tests/sample-report-format.test.ts` fails when the sample's structure differs from what the generator writes.
4. ~~**Home form is long above the fold for a first scan.** The address box is first, but "Explore up to N pages", sign-ins and the optional specs sit right under it. Collapse them behind one "More options" for first-time visitors.~~ Done 2026-10-07: one "More options" (opens by itself when something in it is set).
5. ~~**The command palette and the keyboard-shortcuts button** in the app's top bar are developer features on the screen a founder lands on. Hide them until a first check-up is done.~~ Done 2026-10-07 (keys still work).

### P2

1. ~~The wake request uses a fixed 90 s limit; make it follow Render's documented wake time if that changes.~~ Done 2026-10-07: `VITE_WAKE_LIMIT_SECONDS`.
2. ~~The area list ("It works", "Everyone can use it"…) could link to the matching report section of the sample.~~ Done 2026-10-07: each links to the sample report (per-section anchors need ids in the report).
3. ~~Add a dark/light toggle on the landing page like the report has.~~ Done 2026-10-07.
4. An assistive-technology pass (NVDA or VoiceOver) and a Lighthouse run on the deployed page.
