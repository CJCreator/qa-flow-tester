# Frontend enhancement plan: Website Audit in the UI, plus check-up gaps

Written 2026-11-04 from a review of `main` at `e4e9ea8`. Planning only: no code changed.

## Why the new features don't show

The last session built the Website Audit ([ADR 0033](../adr/0033-website-audit-entry-point.md) to [0037](../adr/0037-route-access-levels.md)). The backend, the 12 audit routes and about 30 screens under `packages/wizard/src/screens/audit/` all exist, and `packages/wizard/dist` was rebuilt on 2026-11-04 with them included. A stale build is not the cause. The causes are these:

1. **Nothing links to the audit.** FE-191 registered the routes in `App.tsx` and `lib/router.ts`, but no task covered navigation. TopBar, the More menu, the phone Menu, CommandPalette, LandingScreen and NotFoundScreen have no audit entry. The only way in is typing `/audits/new`.
2. **The audit's main outputs have no screen.** The runner returns site-area grades, AI notes, PageSpeed, phone-layout shots, the Improvement Roadmap, internal linking and leaving-site data. `AnalysisScreen` renders the hierarchy, a page list and a flat findings list, and none of that data. `RewriteReview.tsx` (FE-401) is built and tested but never mounted.
3. **The journey breaks between screens.**
   - The Analysis, Review, Export, Helpers and Document settings screens have no links back or onward.
   - "Open the results" goes to the history page, not the results.
   - `/audit-settings` and `/helper` can only be reached by typing their addresses.
4. **Some styles are undefined app-wide.** `accent` is not a colour in `tailwind.config.js` and `btn-secondary` is not defined in `index.css`, so those elements render unstyled. This predates the audit and also affects ReportScreen and VisibilityScreen.
5. **The hosted copy has access issues.**
   - The beta copy closes the owner's audit screens. That is by design (ADR 0037, D-004), but the wizard still shows them and they fail with check-up wording.
   - Helpers cannot load the wizard at all. That is a runner bug against D-005.

## Evidence

Four reviews were run: audit flow and API coverage, design and wording, check-up and shell gaps, and a live browser pass on `localhost:3001` at 1280x800 and 390x844, including one Website Audit of `https://example.com`.

| # | Finding | Evidence | Sev |
|---|---|---|---|
| F1 | No audit entry in TopBar, More, phone Menu, CommandPalette, Landing or NotFound | `components/TopBar.tsx:30-39`, `components/CommandPalette.tsx:79-123`, `screens/NotFoundScreen.tsx:14-19`; live pass | blocker |
| F2 | Every audit screen's breadcrumb reads "Home / Visibility" (the ternary's default) | `components/TopBar.tsx:275`; live pass | major |
| F3 | `accent` colour undefined: badges and buttons render unstyled | `tailwind.config.js` (no `accent`); used in `ReportScreen.tsx:784,1190,1297,1341,1420`, `NewCheckupScreen.tsx:544`, `audit/results/FindingsList.tsx:27`, `audit/documents/ReviewDocumentsScreen.tsx:352` | major |
| F4 | `btn-secondary` undefined | `index.css` has only `btn-primary`, `btn-quiet` and `btn-link`; used in `VisibilityScreen.tsx:73`, `audit/saved/HelperSignInScreen.tsx:97` | major |
| F5 | Helpers get 401 on the hosted copy: the wizard page, assets and `/api/runner/status` are outside the route table, so they go through `grantAccess` | `runner/src/server.ts:1053` (gate), `:1165` (status), `:1375` (`serveUi`); ADR 0037 D-005 | blocker (hosted) |
| F6 | Beta copy closes owner audit rows (intended), but the wizard shows the screens, and each fails with check-up refusal text | `runner/src/routes/index.ts:221`, `routes/route.ts:142`, `deploy.yml:155` (`RUNNER_BETA=1`); no `ERR_BETA` handling in `screens/audit` | major (hosted) |
| F7 | `AnalysisScreen` renders none of: `siteAreas`/`page.areas` (grades and AI notes, FR-16), `page.speed` (FR-12), `page.phone`, `result.notes`, `roadmap`, `internalLinking`, `leavingSite`, `screenshotPath`. `GET :id/file` has no caller | `audit/results/AnalysisScreen.tsx:184-222`, `PageFactsView.tsx:41` | major |
| F8 | Analysis has no summary, no actions and no back link; a missing version is a dead end | `AnalysisScreen.tsx:186-228`; live pass | major |
| F9 | No back links on Review, Export, Helpers and Document settings | `ReviewDocumentsScreen.tsx:559`, `ExportDocumentsScreen.tsx:269`, `HelpersScreen.tsx:281`, `DocumentSettingsScreen.tsx:277` | major |
| F10 | "Open the results" goes to history; history opens no version and does not follow a re-run live | `audit/start/AuditStartScreen.tsx:207-211`, `audit/saved/AuditHistoryScreen.tsx:242,275-286` | major |
| F11 | Export links are plain `<a download>`, so a JSON refusal is saved as the file | `ExportDocumentsScreen.tsx:184,216,247`, `runner/src/routes/audit-export.ts:75` | major |
| F12 | `RewriteReview` is never mounted, so all four rewrite endpoints have no reachable caller | `audit/ai/RewriteReview.tsx` (0 importers) | major |
| F13 | `/audit-settings` has no link and no PageSpeed key or `rewriteOverlapWords` field; its heading "Document settings" does not match its tab title | `App.tsx:925`, `audit/documents/settings-api.ts`; live pass | major |
| F14 | Results tables overflow the page on phones (no `overflow-x-auto`) | `HierarchyView.tsx:62`, `PageContentView.tsx:84,106,134,172,202`, `PageFactsView.tsx:119` | major |
| F15 | Helpers see owner-only buttons that fail with ERR_FORBIDDEN; their list shows raw ids; the owner is never shown the `/helper` address | `AuditHistoryScreen.tsx:132-154`, `HelperSignInScreen.tsx:98`, `HelpersScreen.tsx` | minor |
| F16 | Check-up report never shows `slowerThanLastTime` (ADR 0035) | `types/src/run-report.ts:150`; no wizard reference | major |
| F17 | Settings does not say where the AI key lives, and gives no warning when the encrypted-file fallback is in use (ADR 0034) | `wizard/src/api.ts:99-111`, `runner/src/server.ts:2724-2727` | minor |
| F18 | AI copy still says the AI runs on "OpenRouter's free models" | `NewCheckupScreen.tsx:833`, `LandingScreen.tsx:415` | minor |
| F19 | Audit screens drift from shared UI: nested `<main>`, plain `<h1>`, hand-rolled notices, mixed max widths, duplicate `plural()`, no per-screen document titles | `AnalysisScreen.tsx:57,186-193`, `AuditStartScreen.tsx:186,195,280`, `saved-api.ts:265`, `AuditProgress.tsx:51` | minor |
| F20 | No "Start a Website Audit" button on the saved list once audits exist; the `/helper` off-state has no way forward | `SavedAuditsScreen.tsx:62`; live pass | minor |

Checked and fine:
- Every wizard API path and body matches the runner, through the shared `AUDIT_API` constants.
- The audit start and saved screens fit at phone width.
- No banned ([ADR 0018](../adr/0018-claim-wording.md)) or verdict wording turned up in audit strings.
- No JavaScript console errors.

Out of scope here, raise separately:
- **Possible false positive:** the example.com audit reported "Page has no main heading (H1)", but the page has one (`packages/core/src/audit/analysis/`).
- **Malformed Shared Link reply:** the `/s` prefix row (`audit-share.ts:420`) is not in `AUDIT_API`, so a malformed Shared Link gets a 401 on the hosted copy instead of "not found".

## Tickets

Words: use `CONTEXT.md` terms in all UI text. The Improvement Roadmap is never called a Plan. No audit screen shows a whole-site verdict, a stamp or pass/fail (ADR 0033). Area grades come only from deterministic checks, and AI notes are marked advisory.

### Phase 1: make it reachable (P0)

#### T-65 Website Audit in the app navigation
- **TopBar:**
  - Add a primary item "Website Audit" → `PATHS.audits`, active on every audit route name.
  - Add "Shortlist" and "Website Audit settings" to More.
  - The phone Menu gets the same items.
- **Breadcrumbs:** replace the label ternary (`TopBar.tsx:~257-275`) with an exhaustive `Record<Route['name'], string>`. Audit routes get labels such as "Website Audits / example.com / Version 2 / Export". There is no "Visibility" default.
- **CommandPalette:** add "New Website Audit", "Saved Website Audits", "Shortlist" and "Website Audit settings".
- **NotFoundScreen:** add a link to Saved Website Audits.
- Files: `components/TopBar.tsx`, `components/CommandPalette.tsx`, `screens/NotFoundScreen.tsx`.
- Tests:
  - Every `Route['name']` has a crumb label (a type-level `Record` and a test).
  - TopBar marks "Website Audit" active on each audit route.
  - CommandPalette lists the four entries.
  - Extend `wizard-e2e.test.ts` with: open the app, click Website Audit, reach `/audits`.
- Size M.

#### T-66 Undefined style classes, app-wide
- Replace `accent` with the `stamp` tokens: `bg-stamp-tint text-stamp`, `border-stamp`, and `bg-stamp text-surface` for the solid button. This covers the 8 uses in F3.
- Replace `btn-secondary` with `btn-quiet` (F4).
- Add a guard test (`tests/style-tokens.test.ts`): scan `src/**/*.tsx` for `btn-*` classes not defined in `index.css`, and for colour utilities (`bg-`, `text-`, `border-`) whose token is not in `tailwind.config.js`.
- Files: `ReportScreen.tsx`, `NewCheckupScreen.tsx`, `VisibilityScreen.tsx`, `audit/results/FindingsList.tsx`, `audit/documents/ReviewDocumentsScreen.tsx` (line 352 only), `audit/saved/HelperSignInScreen.tsx` (line 97 only).
- Size S.

#### T-67 Website Audit on the beta copy (wizard side)
- Follow ADR 0037 as decided: on a beta copy, Website Audits are for Helpers and Shared Links only.
- When `status.beta` is set:
  - TopBar hides the owner audit items.
  - `App.tsx` renders one `Notice` in place of each owner audit screen: "Website Audits run on your own copy of Release check-up", with a link to `docs/DEPLOYMENT.md`. The screens never load and fail with check-up wording.
  - Helper routes stay.
- This is handled at the route level, so the audit `*-api.ts` helpers are not touched.
- Files: `App.tsx`, `components/TopBar.tsx` (after T-65), a new `screens/audit/BetaAuditNotice.tsx`.
- Tests: beta status renders the notice on each owner audit route, and Helper routes are unaffected.
- Size S.
- Depends on T-65.

#### T-68 Helpers can load the hosted copy (runner)
- Implements D-005.
- A request with a valid Helper session cookie passes the access-key gate for:
  - the wizard page and its assets (`serveUi`);
  - `GET /api/runner/status`, which returns a reduced Helper view: no run details, no AI setup, `beta` and a `helper: true` flag.
- Every other inline `server.ts` endpoint keeps the gate.
- Optionally move `/api/runner/status` into the route table with `access: 'sign-in'`. That continues ADR 0027.
- Amend ADR 0037 Consequences with one line.
- Files: `packages/runner/src/server.ts`, `packages/runner/src/routes/*`, runner tests.
- Tests:
  - A Helper cookie and no key get 200 for `/`, `/assets/*` and status.
  - No cookie gets 401 for each.
  - A Helper on an owner inline endpoint gets 401/403.
- Size M.
- Security-sensitive: review against `SECURITY.md`.

### Phase 2: connect the journey (P1)

#### T-69 Audit journey links
- **After the audit:**
  - When the audit is done, `AuditFollowUpLink` goes to `PATHS.auditVersion(id, latestVersion)`.
  - The stream's done event carries the version. If it doesn't, read it from `GET /api/audits/:id`.
- **History page:**
  - Puts the latest finished version first, with an "Open the results" primary button.
  - Follows `GET :id/stream` while a version is running, as the start screen does.
- **Back links:** "Back to this Website Audit" on Analysis, Review, Export and Helpers. "Back to Saved Website Audits" on Document settings.
- **Analysis action row:** Review Audit Documents, Export, Preview and Shared Links, and back.
- **Missing version:** the not-found state gets Retry and a back link.
- **Saved list:** the header gets a "Start a Website Audit" button.
- **`/helper` off-state:** links home.
- Files: `audit/start/AuditStartScreen.tsx`, `audit/start/AuditProgress.tsx`, `audit/saved/AuditHistoryScreen.tsx`, `audit/saved/SavedAuditsScreen.tsx`, `audit/saved/HelperSignInScreen.tsx`, `audit/results/AnalysisScreen.tsx` (action row and not-found state only), `audit/documents/ReviewDocumentsScreen.tsx`, `audit/documents/ExportDocumentsScreen.tsx`, `audit/saved/HelpersScreen.tsx`, `audit/documents/DocumentSettingsScreen.tsx`.
- Tests: each screen renders its back link, the finished follow-up link points at the version, and history re-reads a running version on stream events.
- Size M.

#### T-70 Export downloads that report failure
- Replace the three `<a download>` links with a fetch that saves a blob. A JSON refusal shows inline as `ErrorMessage` with the runner's message.
- Read the version first, and disable export while it is running.
- Files: `audit/documents/ExportDocumentsScreen.tsx`, `audit/documents/export-api.ts`.
- Tests: a 4xx JSON reply shows the message and saves no file; a running version disables export.
- Size S.
- Order: after T-69 (it shares `ExportDocumentsScreen.tsx`).

#### T-71 Check-up gaps from the last session
- **Report:** render `slowerThanLastTime` beside its findings (ADR 0035), as a note giving the page, then and now, without claim words.
- **Settings:**
  - Show where the AI key is kept (`keychain`, encrypted file, environment or CLI).
  - Warn when the encrypted-file fallback is in use (ADR 0034).
  - The runner adds `keySource` to the `/api/ai/settings` reply (`server.ts:2724`). It never sends the key.
- **AI copy:** make the copy at `NewCheckupScreen.tsx:833` and `LandingScreen.tsx:415` provider-neutral.
- **Skipped routes:** confirm `skipReasonText` (`lib/coverage-text.ts`) has words for every `RouteSkipReason` (robots, trap-limit, session-lost, duplicate).
- Files: `ReportScreen.tsx` (after T-66), `SettingsScreen.tsx`, `api.ts`, `runner/src/server.ts` (AI settings reply only, after T-68), `NewCheckupScreen.tsx` (after T-66), `LandingScreen.tsx`, `lib/coverage-text.ts`.
- Tests: the report renders the slower note; Settings shows each key source and the fallback warning; every `RouteSkipReason` maps to text.
- Size M.

### Phase 3: show what the audit found (P1)

#### T-72 Analysis summary and site areas
- **Summary at the top of `AnalysisScreen`:**
  - pages recorded and skipped;
  - findings counted by impact;
  - a "Fix first" list of up to five, ranked by impact then effort;
  - no whole-site verdict.
- **Site areas:** one card per area, with the deterministic grade using `lib/grades.ts` tokens, "No grade: no checks ran" when that is the case, and the AI note with an "AI advisory" badge or its not-done reason.
- **Notes:** a banner for `result.notes`, such as "AI notes need an AI key", linking to Website Audit settings.
- **Further sections:** Improvement Roadmap, internal linking and leaving-site links.
- Files: `audit/results/AnalysisScreen.tsx`, new `audit/results/AuditSummary.tsx`, new `audit/results/SiteAreasView.tsx`, new `audit/results/RoadmapView.tsx`, `audit/results/analysis-text.ts`.
- Tests:
  - The summary counts and "Fix first" order.
  - An area with no checks shows no grade.
  - The AI note shows the advisory badge.
  - Run `no-banned-words.test.ts` over the new strings.
  - No "Ready to release", stamp or pass/fail text renders.
- Size L.
- Order: after T-69 (it shares `AnalysisScreen.tsx`).

#### T-73 Per-page detail and findings cards
- **Page facts:** show PageSpeed (`page.speed`, with how it was measured, per ADR 0018), the phone layout (`page.phone`), and the screenshot through `GET /api/audits/:id/file`, lazy-loaded.
- **Finding cards:** lead with the title plus impact and effort chips; Page, Section and Source go in a collapsed `<details>`.
- **Tables:** wrap every results table in `overflow-x-auto` (F14).
- Files: `audit/results/PageFactsView.tsx`, `audit/results/PageContentView.tsx`, `audit/results/HierarchyView.tsx`, `audit/results/FindingsList.tsx` (after T-66), `audit/results/analysis-client.ts` (file URL helper).
- Tests: speed, phone and screenshot render when present and are absent otherwise; each table sits inside an overflow wrapper.
- Size M.

#### T-74 Mount the AI rewrite review
- Mount `RewriteReview` on the Review screen for each Section that can be rewritten (FE-401).
- Gate it on an AI key, with the same notice as T-72.
- Files: `audit/documents/ReviewDocumentsScreen.tsx` (after T-69), `audit/ai/RewriteReview.tsx` (styling only).
- Tests: the Review screen shows the rewrite control per Section, and it is hidden without an AI key.
- Size S.

#### T-75 Website Audit settings, complete and reachable
- Title the screen "Website Audit settings", with sections "Audit Documents" and "AI models", matching the tab.
- **Links:** link it from Settings (a "Website Audit settings" row) and from Saved Website Audits.
- **New fields:**
  - PageSpeed key: write-only, shows "saved" or "not saved", never echoed back, like the AI key fields.
  - `rewriteOverlapWords`.
- Files: `App.tsx` (heading wrapper only), `audit/documents/DocumentSettingsScreen.tsx`, `audit/documents/settings-api.ts`, `audit/ai/AuditAiModelsPanel.tsx`, `SettingsScreen.tsx` (link row only, after T-71), `audit/saved/SavedAuditsScreen.tsx` (link only, after T-69).
- Tests: the PageSpeed key is never rendered back; saving sends `pagespeedKey`; the page is reachable from Settings.
- Size S.

#### T-76 Helper-aware audit screens
- Hide owner-only actions (Re-run, Delete, Helpers, Preview and Shared Links) when the caller is a Helper. Use the T-68 status flag, or `GET /api/helper/session`.
- The Helper's list shows the site host, not the audit id.
- The Helpers screen shows the `/helper` sign-in address with a copy button.
- Files: `audit/saved/AuditHistoryScreen.tsx`, `audit/saved/HelperSignInScreen.tsx`, `audit/saved/HelpersScreen.tsx`, `audit/saved/helper-api.ts`.
- Tests: Helper sessions hide owner actions, the host is shown, and the address can be copied.
- Size S.
- Depends on T-68 and T-69.

### Phase 4: consistency (P2)

#### T-77 Audit screens match the shared UI
- **AnalysisScreen:** use a `<div>`, not a nested `<main>`, and `FocusHeading`, not a plain `<h1>`.
- **Shared components:** replace hand-rolled notice, error and loading strings with `Notice`, `ErrorMessage` and `Spinner`.
- **Layout:**
  - Use `max-w-4xl` for wide views and `max-w-prose` for forms; drop the `max-w-[64rem]` and `max-w-[44rem]` variants.
  - Use `min-h-[44px]`, not `min-h-[50px]`.
  - Use `.card` for cards.
- **Helpers:**
  - Replace `plural()` in `saved-api.ts` and `AuditProgress.tsx` with `count()` from `lib/format.ts`.
  - Use one fetch helper for the audit `*-api.ts` modules where `api.ts` already has one.
- **Titles:** each screen sets its own `useDocumentTitle`, for example "Website Audit of example.com", "Version 2 results" and "Export Audit Documents". Remove the nested audit ternary in `App.tsx:962-979`.
- Files: all of `screens/audit/**` and `App.tsx`.
- Last on purpose: it touches every audit screen.
- Size M.

#### T-78 Landing page and product guide
- Add a short Website Audit section to `LandingScreen.tsx` and a "Website Audit" section to `docs/PRODUCT_GUIDE.md`.
- Its wording depends on decision D2.
- Files: `LandingScreen.tsx` (after T-71), `docs/PRODUCT_GUIDE.md`.
- Size S.

## Build order

Tickets in one wave touch disjoint files and can be built in parallel.

| Wave | Tickets | Notes |
|---|---|---|
| 1 | T-65, T-66, T-68 | Unblocks everything; the app is navigable after this wave |
| 2 | T-67, T-69, T-71 | T-67 after T-65 (TopBar); T-71 after T-66 and T-68 |
| 3 | T-70, T-72, T-74, T-75 | All after T-69. T-70 owns Export, T-72 owns Analysis, T-74 owns Review, T-75 owns settings. They are disjoint |
| 4 | T-73, T-76, T-78 | T-73 after T-66; T-76 after T-68 and T-69 |
| 5 | T-77 | Sweeps every audit screen |

Verification:
- `pnpm build`, then `pnpm exec vitest run packages/wizard/tests`.
- Before release, run `wizard-e2e.test.ts` with Chromium.
- Do a browser pass of every audit route at 1280x800 and 390x844, on a local copy and on a `RUNNER_BETA=1` copy.

## Decisions

| id | Decision | Default or decision |
|---|---|---|
| D1 | Where Website Audit sits in the top bar | Decided 2026-11-04: a primary item beside New check-up, Past check-ups and Settings |
| D2 | Whether the public landing page mentions the Website Audit, which has a different market (India-wide, free) from the Check-up (global, USD) | Decided 2026-11-04: a short secondary section below the check-up content; the check-up stays the main call to action |
| D3 | Settings provider order: commit `a3f3efe` says it reordered the providers to Anthropic, OpenAI, Gemini, OpenRouter, but `SettingsScreen.tsx:36-44` and `server.ts:315-320` still list OpenRouter first | Keep the code as it is (OpenRouter first, free models) and correct nothing until confirmed |
| D4 | Owner audits on the hosted beta copy | Unchanged. ADR 0037 D-004 keeps them closed; T-67 explains this in the UI |

## Implementation notes

Built on 2026-11-04 on branch `worktree-frontend-enhancement-plan`. Six agents built the tickets in parallel, each owning its own files. Two review passes (standards and spec) followed, and their findings were fixed. Where the code differs from the tickets above:

- **Cards:** the plan says `.card`, but `index.css` defines only `.card-1` to `.card-4`. Cards use `card-1 bg-surface`, and `tests/style-tokens.test.ts` now also rejects undefined `card` classes.
- **Breadcrumbs (T-65):** audit crumbs use generic labels ("Website Audit", "Version N"). The route carries only the audit id, and the top bar does not fetch the host.
- **AI key messages (T-72, T-74):** they link to Settings, where the key is added, not to Website Audit settings, which only picks models.
- **One fetch helper (T-77):** not done. The audit `*-api.ts` modules still each have their own `call()`, `Fetch` type and `NOT_ANSWERING` text. A shared `screens/audit/http.ts` is a follow-up.
- **Download helper (T-70):** `export-api.ts` keeps its own `saveBlob`. `saveResponse` in `api.ts` is not exported and does not read `filename*=`.
- **Report and Settings tests (T-71):** the slower note and key source are tested through their pure helpers (`lib/slower-note.ts`, `lib/key-source.ts`), not by rendering the screens.
- **Extra colour fixes (T-66):** the guard test found more undefined tokens than F3 and F4 listed: `text-warn-dark`, `bg-surface-base`, `bg-page`, `text-danger` and `emerald-*`. They are fixed as well.
