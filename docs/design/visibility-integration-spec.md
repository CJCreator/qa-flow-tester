# Search and AI visibility in the review flow: integration plan, audit and wireframes

Status: proposed. Decisions come from the grilling session of 2026-10-06 (section 1). Companion visual page: published as a private artifact (see the handoff note in the pull request).

The product audits other sites for SEO, AEO, GEO and (new) Marketing basics, but the review flow hides it: one checkbox on New check-up, nothing in Plan review, nothing in the live feed, and four small percentages inside the "Findable" card. This spec makes it a visible, fixable part of every check-up without adding a step.

Plain words in the UI, jargon only in hints: **Search** (SEO), **AI answers** (AEO), **AI search** (GEO), **Marketing** (MKT). Claim wording follows [ADR 0018](../adr/0018-claim-wording.md).

## 1. Decisions

| #   | Decision    | Choice                                                                                                                                                                 |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scope       | The review flow. The public landing page stays governed by [SEO_AEO_GEO_STRATEGY.md](../SEO_AEO_GEO_STRATEGY.md) and is only audited here (section 2).                 |
| 2   | Report      | A dedicated **Visibility** view with four tabs. The Findable card links to it.                                                                                         |
| 3   | Setup       | Existing checkbox stays the master switch; a collapsed "Choose which" row holds four toggles, remembered per site.                                                     |
| 4   | Plan review | A new "Search and AI visibility" section in the existing plan-item style, each item switchable.                                                                        |
| 5   | Fixes       | AI-written when an AI key is set; deterministic templates filled from scan facts otherwise.                                                                            |
| 6   | AI gate     | Facts-only prompt, deterministic validation, our own checkers and a grammar/flow review re-run on the draft; any failure shows the template fix with a note.           |
| 7   | Deliverable | This Markdown spec plus a visual HTML page.                                                                                                                            |
| 8   | Ownership   | Fixes for every site, owned or not. Consequence: AI requests may be spent on sites the person can't change; the cost estimate on New check-up must include them (4.2). |

## 2. Audit of the current design

| Surface                                                                                                | Today                                                                                                              | Gap                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New check-up ([NewCheckupScreen.tsx:347](../../packages/wizard/src/screens/NewCheckupScreen.tsx#L347)) | One checkbox: "Check how search engines and AI assistants see it". Default on for live sites, off for a test copy. | Doesn't say what is checked, or that AI answers, AI search and marketing exist. No per-lens choice.                                                                  |
| Plan review ([PlanDocument.tsx](../../packages/wizard/src/components/plan/PlanDocument.tsx))           | Pages, navigation checks, journeys, questions, sign-ins.                                                           | Nothing about search. Site files (robots.txt, sitemap.xml, llms.txt) are read but never listed, so people can't see or switch them off.                              |
| Live progress ([TestingScreen.tsx](../../packages/wizard/src/screens/TestingScreen.tsx))               | Steps and a feed.                                                                                                  | Search findings are repeated per screen size (see [PRODUCT_REVIEW.md](../../PRODUCT_REVIEW.md) L2) and aren't grouped as one phase.                                  |
| Report ([ReportScreen.tsx](../../packages/wizard/src/screens/ReportScreen.tsx))                        | "How each area did": Findable card with Search / AI answers / AI search percentages; problems in buckets.          | Percentages have no drill-down, no "what's present", no fix snippets. Search findings are mixed into must-fix buckets and out-rank real defects (PRODUCT_REVIEW L1). |
| Settings → Sites                                                                                       | Per-site "check how search engines see it": As usual / Yes / No.                                                   | Single value; must become four.                                                                                                                                      |
| Public home page                                                                                       | Fully covered by the strategy doc (JSON-LD graph, FAQ, llms.txt, robots, sitemap, noindex on private screens).     | None. Audit only: keep FAQ text and JSON-LD in sync ([faq.ts](../../packages/wizard/src/lib/faq.ts)).                                                                |
| Design system ([tailwind.config.js](../../packages/wizard/tailwind.config.js))                         | Blueprint palette, `rounded-card`/`panel`, levels 1-4 shadows, `btn-primary`, `btn-link`, `field`.                 | No component for a score-with-parts, a tab set, a code-snippet block or a "present / missing" checklist. Section 6 adds them from existing tokens.                   |

## 3. Integration points per optimization type

| Type                     | What it is for the reader                                 | Checked today                                                                                              | Where it surfaces (new)                                                                      | Fix the tool offers                                                                 |
| ------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Search** (SEO)         | Being found and listed by search engines                  | Title, description, H1, canonical, noindex, viewport, favicon, alt text, broken links, robots.txt, sitemap | Setup toggle; plan items "Home and key pages", "robots.txt", "sitemap.xml"; Visibility tab 1 | Meta tags, canonical, robots rules, sitemap entries (HTML/text snippets)            |
| **AI answers** (AEO)     | Being picked as the answer by assistants and answer boxes | JSON-LD, question headings, FAQ/HowTo markup, breadcrumbs                                                  | Plan item "Pages that answer questions"; tab 2                                               | JSON-LD (FAQPage, HowTo, BreadcrumbList, Organization) built only from visible text |
| **AI search** (GEO)      | Being read and quoted by AI search tools                  | `<main>`/`<article>`, text density, author and date, external citations, llms.txt, AI-crawler rules        | Plan items "llms.txt", "AI crawler access"; tab 3                                            | `llms.txt` draft, robots.txt AI-crawler block, content-structure suggestions        |
| **Marketing** (MKT, new) | Turning visits into customers                             | Twitter card, share image, call to action, contact route, privacy/terms, analytics, social links           | Setup toggle; tab 4                                                                          | Meta tags, link placement notes                                                     |

Navigation and flow impact: none of these add a step. Setup keeps one screen; Plan review gains one section; the report gains one route.

## 4. Updated wireframes and implementation notes

Notation: `[ ]` toggle, `( )` button, `▸` collapsed, `⚠` needs attention. Colours are existing tokens only.

### 4.1 New check-up (sign-ins and the visibility option)

```
┌─ New check-up ───────────────────────────────────────────────┐
│ Site address  [ https://example.com                    ]     │
│ Pages         [ 20 ] pages                                   │
│ ▸ Test the pages behind a sign-in                            │
│                                                              │
│ [x] Check how people and AI find the site            (A)     │
│     Search · AI answers · AI search · Marketing              │
│     ▸ Choose which                                    (B)    │
│        [x] Search        titles, descriptions, links         │
│        [x] AI answers    FAQ and how-to markup               │
│        [x] AI search     llms.txt, AI crawlers, citable facts│
│        [x] Marketing     share previews, next step, contact  │
│                                                              │
│ ▸ Add specs, design notes or journeys (optional)             │
│ About 40 AI requests (+8 for fixes)                   (C)    │
│ ( Start check-up )                                           │
└──────────────────────────────────────────────────────────────┘
```

- (A) Keep the checkbox at [NewCheckupScreen.tsx:347](../../packages/wizard/src/screens/NewCheckupScreen.tsx#L347); change its label, add a one-line summary of the four lenses.
- (B) Native `<details>` (no JS, keyboard-accessible, as the FAQ). Four checkboxes with `aria-describedby` hints. When the master checkbox is off the group is `disabled` and collapsed.
- (C) The AI estimate (`handleAiEstimate`) adds "for fixes" requests: about one per page with findings, capped by the AI budget ([ai-budget.ts](../../packages/core/src/plan/ai-budget.ts)). Decision 8 makes this apply to non-owned sites too.
- Data: replace `searchChecks?: boolean` with `visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean }` in `CheckupForm`, `TriggerRunBody`, `SiteMemory` and `RememberedSite`. Read old `searchChecks` as all four on/off (migration in `loadSiteMemory`). Defaults stay: on for live sites, off for a test copy.
- Runner: `SeoContext.searchChecks` becomes the four flags; `SeoChecker` skips AEO, GEO and Marketing individually. Search findings stay site-wide-once ([seo.ts](../../packages/checkers/src/seo.ts) `siteWide`).

### 4.2 Plan review: new section

```
┌─ Search and AI visibility ───────────────────────────────────┐
│ What will be looked at. Switch off anything you don't need.  │
│                                                              │
│ Site files                                                   │
│  [x] robots.txt      who may read the site                   │
│  [x] sitemap.xml     the list of pages for search engines    │
│  [x] llms.txt        a summary written for AI tools          │
│  [x] AI crawler rules  GPTBot, ClaudeBot, PerplexityBot…     │
│                                                              │
│ Pages                                       Search AI ans AI s Mkt │
│  [x] /            Home                       ●      ●     ●    ●   │
│  [x] /pricing     Pricing                    ●      ○     ●    ○   │
│  [x] /blog/post-1 Article                    ●      ●     ●    ○   │
│  ● checked  ○ not relevant to this kind of page                    │
└──────────────────────────────────────────────────────────────┘
```

- New `VisibilityPlan` block in `ReviewPlan` (types package): `{ siteFiles: Array<{ id: 'robots'|'sitemap'|'llms'|'crawlers'; enabled: boolean }>; pages: Array<{ path: string; kind: 'home'|'article'|'faq'|'product'|'other'; lenses: Array<'search'|'answers'|'aiSearch'|'marketing'>; enabled: boolean }> }`.
- Built in `plan/ai-planner.ts` / `site-type.ts` from the scan: kind comes from existing site-type detection; a lens is "not relevant" for kinds it doesn't apply to (marketing basics are home-only; AEO on FAQ-like and article pages).
- Component: `plan/VisibilitySection.tsx` using the same row, checkbox and "only what needs me" filter as other plan sections; honours `PLAN_ITEMS` toggling and keyboard shortcuts already planned.
- ADR 0009 ("AI plans every plan item") holds: the AI may re-order or re-describe items, never add pages the scan didn't find.

### 4.3 Live progress

```
Checking the site…
 ✓ Found 20 pages
 ✓ Tested the journeys
 ● Checking search and AI visibility   robots.txt ✓  sitemap ✓  llms.txt ✗   9 / 20 pages
 ○ Writing the report
```

- One phase "Checking search and AI visibility" with a count, not a per-finding feed. Findings from this phase are deduped across screen sizes before they reach the feed (fixes the repeated-finding issue, PRODUCT_REVIEW L2).
- `TestingScreen` reads a new `visibility` progress object on the run stream: `{ files: Record<id,'ok'|'missing'|'pending'>; pagesDone: number; pagesTotal: number }`.
- Announce phase changes via the existing `aria-live="polite"` region.

### 4.4 Report: Findable card and Visibility view

Findable card (changes to `AspectGrades` in [ReportScreen.tsx](../../packages/wizard/src/screens/ReportScreen.tsx)):

```
┌─ Findable ───────────────────────── B ┐
│ 6 problems                            │
│ Search 92%  AI answers 70%            │
│ AI search 85%  Marketing 60%          │
│ ( See search and AI visibility → )    │
└───────────────────────────────────────┘
```

Already shipped in this branch: the Marketing sub-score (`subBreakdown.marketing`, `categoryTag: 'MKT'`). To add: the link, and the `sm:grid-cols-4` grid, now two columns on phones.

Visibility view, route `/reports/:runId/visibility` (add to [router.ts](../../packages/wizard/src/lib/router.ts) `Route`, breadcrumb "Report › Search and AI visibility"):

```
┌─ Search and AI visibility · example.com ─────────────────────┐
│ [ Search 92% ] [ AI answers 70% ] [ AI search 85% ] [ Marketing 60% ]   ← tablist
│──────────────────────────────────────────────────────────────│
│ AI answers                                                   │
│ How assistants and answer boxes pick answers from the site.  │
│                                                              │
│ Present                                                      │
│  ✓ Organization markup           ✓ Breadcrumbs               │
│ Missing                                                      │
│  ⚠ FAQ markup on /pricing                    Should fix      │
│     Visible questions found: 5. No FAQPage markup.           │
│     ( Show fix )                                       (D)   │
│  ⚠ HowTo markup on /guide                   Suggestion       │
│ Not relevant: product pages (no questions found)             │
│──────────────────────────────────────────────────────────────│
│ Fix · FAQ markup on /pricing                                 │
│  Source: written by AI, checked ✓  | template (no AI key)    │
│  ┌ JSON-LD ────────────────────────────── (Copy) ┐           │
│  │ { "@context": "https://schema.org", …         │           │
│  └───────────────────────────────────────────────┘           │
│  Checks: parses ✓  matches page text ✓  grammar ✓  reads well ✓│
│  ▸ What this changes for visitors: nothing visible           │
└──────────────────────────────────────────────────────────────┘
```

- Tabs: WAI-ARIA tabs pattern (arrow keys, `aria-selected`); selected tab in the URL hash (`#answers`) so the view is linkable. On phones the tablist scrolls horizontally and shows the score on the selected tab only.
- Each tab = `Present` (✓ list), `Missing` (findings grouped by problem key, using `groupProblems`), `Not relevant`. Severity labels reuse the report's wording ("Must fix / Should fix / Suggestion").
- Findings from the four lenses are excluded from the main "What to improve first" ranking unless Major or worse (fixes PRODUCT_REVIEW L1). They remain counted in the Findable score.
- (D) "Show fix" opens an inline panel under the finding (not a modal): focus moves to the panel heading; `Esc` returns focus to the button.
- Snippet block: monospace, `bg-canvas`, `border-edge`, copy button with `aria-live` "Copied". Never auto-applied: the tool doesn't edit the person's site.

### 4.5 Settings → Sites

```
example.com        Yours
Check how people and AI find it:  [ As usual ▾ ]
  ▸ Choose which   [x] Search [x] AI answers [x] AI search [ ] Marketing
Signs in as member (qa@…)   Test it   Forget      (shipped)
Add a sign-in                                       (shipped)
```

`updateSite(host, { visibility })` replaces `searchChecks`. Server `handleSites` keeps accepting `searchChecks` for older clients and maps it to all four.

## 5. Fix generation (decisions 5, 6 and 8)

```
scan facts ──► template fix (always built; deterministic)
     │
     └─ AI key set? ──► AI draft (facts only) ──► gate ──► pass: show AI fix
                                                   └─ fail: show template fix + note
```

1. **Facts input.** Only what the scan read: page title, meta description, visible headings and answers, organization name and logo URL, existing JSON-LD, URLs. The prompt forbids adding any other fact; output is JSON-LD or text only.
2. **Deterministic validation.** JSON-LD parses; `@type` is allowed for the lens; every string value in `name`, `text`, `description` appears in the visible page text (normalised); lengths within limits (title ≤ 60, description ≤ 160); no invented URLs.
3. **Our checkers.** Run the relevant checker on a copy of the page with the snippet applied (`AeoChecker`, `GeoChecker`, `SeoChecker`); the fix must remove its finding and add none.
4. **Language review.** One AI pass for grammar, flow and tone against a short rubric, plus a check that wording follows ADR 0018 (no unproven claims such as "guaranteed ranking").
5. **Fallback.** Any failure shows the template fix with the note "The AI's version didn't pass the checks, so this is the standard version." Reasons are kept in Developer details.
6. **Cost.** One request for the draft plus one for review per fix-bearing finding group (not per page), inside the budget estimate in 4.1(C). With no key, no AI is used and the badge reads "Standard fix".
7. **Placement.** `packages/core/src/fixes/` (`templates.ts`, `ai-fix.ts`, `validate.ts`), route `POST /api/runner/reports/:id/fix` with `{ problemKey }`, cached on the report so reopening is free.

## 6. Design-system additions (existing tokens only)

| Component            | Built from                                                          | Notes                                                                                                     |
| -------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ScoreTabs`          | `rounded-control`, `border-edge`, `stamp` underline, `gradeClasses` | Four tabs with grade; tablist semantics; 44 px targets.                                                   |
| `PresentMissingList` | `pass` ✓ / `warn` ⚠ with text labels                                | Never colour alone (contrast tested in [contrast.test.ts](../../packages/wizard/tests/contrast.test.ts)). |
| `SnippetBlock`       | `bg-canvas`, `font-mono`, `btn-link`                                | Horizontal scroll, never wraps JSON; copy button.                                                         |
| `CheckBadges`        | `rounded border` pills as the "Added" badge                         | "parses ✓ matches page ✓ grammar ✓".                                                                      |
| `LensToggleGroup`    | native `<details>` + checkboxes                                     | Shared by New check-up and Settings.                                                                      |

## 7. Accessibility and performance

- All new controls keyboard-operable, visible focus ring (`stamp`), targets ≥ 44 px; tabs follow the WAI-ARIA tabs pattern.
- Status (present, missing, passed) is always icon + text.
- Light and dark palettes both used; check new pairings in `contrast.test.ts`.
- Visibility view is lazy-loaded (`React.lazy`) so the report stays light; snippets are plain text, no syntax-highlighter dependency.

## 8. Rollout (each slice shippable)

1. **Done in this branch:** Marketing checker, four-part Findable breakdown, sign-in manager in Settings.
2. Four-lens model: types, `SiteMemory` migration, setup and Settings toggles, checker gating.
3. Visibility view with Present / Missing / Not relevant (no fixes yet) and the Findable card link; re-rank so lens findings don't out-rank defects.
4. Plan review section and live-progress phase.
5. Template fixes, then the AI gate, then the cost estimate update.

## 9. Open points and risks

- **Scoring weight:** Marketing sits inside Findable; promoting it to its own aspect would change every existing grade. Kept inside for now.
- **Non-owned sites (decision 8):** the person may spend AI requests drafting fixes they can't apply. Mitigated by the estimate line in 4.1(C); revisit if people complain.
- **Test baseline:** eight runner and core tests fail on this branch; whether they also fail on `main` is being checked and must be settled before slice 2 merges.
- **Template staleness:** `HOME_FAQ`/JSON-LD sync rule in the strategy doc applies to generated FAQ markup too: it is built from visible text only.
