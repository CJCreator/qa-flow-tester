# Decisions

> **Append-only** record of significant engineering decisions, documentation updates and lessons learned.
> Never rewrite or delete a past entry; supersede it with a new one that references it.

Entry format:

```markdown
## DEC-001 — Title
- Date: YYYY-MM-DD
- Status: proposed | accepted | superseded by DEC-00X
- Context: what forced the decision
- Decision: what was decided
- Consequences: trade-offs, follow-ups, known limitations
- Alternatives considered: …
```

## Known limitations

Website Audit (WF-20261103-hypb, DEC-012). Open minor findings kept for a follow-up; details are in `aieos finding list`.
- Open at pause (DEC-014). Resume with `/ai-eos:go`, in this order:
  1. REC-017 (CHK-BROWSER-2, EV-0376):
     - `packages/runner/tests/saved-session-secrecy.test.ts` (a full Check-up, plan then approve then done) hits its 300 s test timeout: in shard 2 at 11:05 and 13:40, and alone with one other file running. It passed once, in EV-0352.
     - Diagnose which phase stalls (`waitForPhase(['awaiting-review'])` or `['done']`) before changing anything.
     - The file belongs to no task, so a fix needs a plan amendment (as APR-007 did for QA-706).
     - The other shard-2 failure, `auth-crawl-e2e.test.ts:119` (500 page recorded without status), passes alone: load.
     - If load-induced timeouts persist, QA-713 may lower browser-project workers in `vitest.config.ts` with a stated reason.
  2. REC-003: the old unsharded CHK-BROWSER check (EV-0006) is no longer registered, since the plan replaced it with CHK-BROWSER-1..4, but its recovery item is OPEN and the gate requires it closed. Only a PASS of that check closes it, which means the full browser suite in one run (about 45 minutes or more, past the old 30-minute limit). Decide between running it once with a longer timeout and another engine-supported way to retire it.
  3. Re-run the stale CHK-CORE-BUILD and CHK-QA-702-TYPECHECK, then every check `aieos check affected --since-pass` lists. Run browser shards at most two at a time: running them all at once caused the load timeouts.
  4. `aieos task done QA-713`, `aieos gate --complete`, `aieos trace`, `aieos completion-report`, then the autopilot commit (never push).
- Developer items outside AI-EOS: check the Deploy runs on `main` since f2c8a51; F-033 (`scripts/deploy-cloud-run.mjs` comma bug) is still deferred.
- Wizard features deferred (DEC-013):
  - document-language choice on the start screen;
  - phone-layout view (375px screenshot and overflow) on the results screens;
  - Hindi and the other beta languages on the export screen;
  - lang tagging of mixed-script text.
  The test expectations to re-add are in DEC-013.
- Helpers (major, accepted by the developer 2026-11-03): F-066. On a copy protected by an access key, a Helper without the key cannot load the wizard or `/helper`, because the UI is served after the access-key gate (`packages/runner/src/server.ts:1053`). Helper sign-in works only where the wizard is reachable without the key (local runs). Do not share the owner access key with Helpers: it makes them owner of every audit. Follow-up: serve the data-free app shell to keyless Helpers when Helper sign-in is on.
- Security and privacy:
  - F-003: PDF Chromium runs with --no-sandbox.
  - F-004: Shared Link HTML is served on the runner origin.
  - F-005: legacy plaintext key file.
  - F-046: Firebase web key restrictions are not documented.
  - F-055: a robots.txt 5xx means allow-all.
  - F-056: the crawler sends no identifying user agent.
  - F-057: robots.txt is not re-checked after a redirect.
  - F-068: rewrite state outlives a deleted audit on the cloud backend.
  - F-069: the bundle README does not mark page text as untrusted.
- Correctness:
  - F-017: the link check follows redirects into Skipped Pages.
  - F-018: the timer and listener in requestSignal are not cleared.
  - F-021: port 0 becomes 3001.
  - F-039: checker findings cite no Section.
  - F-040: header-based technology detection never runs.
  - F-054: the pipeline does not pass robots.txt or path limits to the link check yet.
  - F-062: RewriteStore queue is per instance.
  - F-063: NAP is lost from large JSON-LD blocks.
  - F-064: Page Content lists are uncapped.
- Languages: F-013 (beta label), F-014 (no Devanagari detection), F-061 (claim words English only).
- Consistency and duplication: F-015, F-016, F-026, F-027, F-028, F-029.
- Cost: F-041 (listAudits lists every object).
- Docs and deploy: F-033 (`scripts/deploy-cloud-run.mjs` comma bug), F-067 (DEPLOYMENT.md site-host advice).
- Info findings: every open info finding from REVIEW-004 to REVIEW-006 and SEC-002 to SEC-004 is a follow-up item (`aieos finding list`).
- Behaviour notes:
  - While a Website Audit or benchmark holds the run slot, `GET /api/runner/plan` answers 404; the plan comes back when the slot is free.
  - After pages are removed, edited Roadmap items keep their id and list position, so `site.json` order can show a lower-priority item first.
  - `edits.ts` copies roadmap.ts's highest-scale rule because it is not exported.
- Review coverage not reached:
  - Analysis modules: hierarchy, technology, accessibility-basics, language, most of marketing-signals.
  - Wizard results, export, settings, AI panel, RewriteReview, Saved Audits, Shortlist and Helpers screens.

## Technical debt register

## Lessons learned

## Entries

## DEC-001 — Declared per-route access levels in the runner (REC-06)
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: Runner authorization is imperative path checks in `packages/runner/src/server.ts:1280-1347`; the Website Audit adds about 40 routes with six access levels (`AUDIT_API`, `packages/types/src/website-audit.ts`), including public Shared Links. A route missing from those lists is open to every beta visitor (architecture AR-06, AR-07; RISK-002).
- Decision: Before any audit route is added, extend `Route` (`packages/runner/src/routes/route.ts`) with an `access` field matching `AUDIT_API[*].access` plus a beta policy, enforced at `matchRoute` dispatch and closed by default. Audit routes go in the route table, not inline in `server.ts`. The owner/helper/public authorization model is recorded in an ADR (0036/0037).
- Consequences: Refactor of a security-sensitive dispatch path, with tests. Remaining inline endpoints move to the table over time (finishing ADR 0027).
- Alternatives considered: keep ad hoc path checks and add the audit routes to them (rejected: fails open).

## DEC-002 — Single run lock with a run kind (REC-07)
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: Run exclusion is split between `RunSlot` and `benchmarkBusy` (`packages/runner/src/server.ts:481,1227`); ADR 0033 says the audit shares the run slot, which would add a third flag and a race (AR-08).
- Decision: `RunSlot` becomes the only run lock, with `kind: 'checkup' | 'benchmark' | 'audit'`; `benchmarkBusy` is removed.
- Consequences: Touches the Check-up and benchmark start paths and their tests.
- Alternatives considered: a third busy flag for the audit (rejected: race).

## DEC-003 — ADR 0036 on hosted audit storage before audit persistence (REC-08)
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: Hosted data lives in memory-backed `/tmp` on a single scale-to-zero Cloud Run instance (`.github/workflows/deploy.yml:127-130`); audits hold third-party personal data and public Shared Links (AR-09, RISK-004). ADR 0033 names 0036 as a follow-up; it is not written.
- Decision: Write ADR 0036 (hosted audit storage and Shared Links: where data lives, retention and deletion, how `/s/:linkId` is served) before any audit store task is built. Audit persistence tasks depend on it.
- Consequences: The storage choice must be weighed against the $0 hosting goal; the ADR's open choices go to the developer.
- Alternatives considered: build on `/tmp` now (rejected: data loss on scale-to-zero).

## DEC-004 — Local requests are the owner when no access key is set
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: ADR 0037 (DOC-105) defines the owner as the holder of the access key. The runner today treats a request from the local machine as the owner when `RUNNER_ACCESS_TOKEN` is not set (`packages/runner/src/cli.ts:36-41` refuses a non-loopback start without a token). The DOC-105 agent asked for this to be confirmed.
- Decision: When no access key is set, a request from the local machine counts as the owner. ADR 0037 keeps this rule; BE-102's `authorizeRoute` implements it.
- Consequences: Local runs need no key. A non-loopback start still requires `RUNNER_ACCESS_TOKEN`, so this does not open the hosted copy.
- Alternatives considered: require a key even locally (rejected by the developer).

## DEC-005 — Hindi Audit Documents stay English (beta) until every builder has Hindi wording
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: REVIEW-002 major finding: `labelsFor('hi')` returns the Hindi table (BE-709) but the per-builder wording tables (structure, content, findings, pitch, owner-audit, roadmap-document, proposal, settings) only have en/ta, so a Hindi document mixes Hindi headings with English body text.
- Decision: Option (a). Until every builder has Hindi wording, `labelsFor('hi')` reports a fallback: the whole document is English, and documents for a beta language carry the `betaLabel` note. The Hindi table (hi.ts) and `documentText` stay as they are.
- Consequences: Hindi users get a consistent English document with a "Beta translation" note; full Hindi documents are a follow-up.
- Alternatives considered: (b) write Hindi wording for every builder now (rejected for now: more work, no native-speaker review).

## DEC-006 — Keep BE-104's outbound-fetch behaviour changes
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: BE-104 (F-001 fix) moved checker and link requests onto `makeCheckerFetch`.
- Decision: Keep all three side effects: no browser cookies on checker/link requests; `/robots.txt` and `/sitemap.xml` redirects not followed (maxRedirects 0); `packages/core/src/audit/store/select-backend.ts` stays on the source-grep exception list for its fixed Cloud Storage endpoints.
- Consequences: signed-in-only targets answer as signed out; a site that redirects its robots/sitemap may get a "missing file" finding; ADR 0031 wording ("report nothing" → "reported as not checked") needs a docs update.
- Alternatives considered: follow redirects or forward cookies (rejected: weaker isolation).

## DEC-007 — Add ERR_AI_FAILED to the audit error codes
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: BE-410's rewrite route answers 502 with code `ERR_AI_FAILED` when the AI gives no usable copy (budget spent, provider failure, claim words); the code was not in `AUDIT_ERROR_CODES` (`packages/types/src/website-audit.ts`).
- Decision: Option (a): add `ERR_AI_FAILED` to `AUDIT_ERROR_CODES` so the contract stays typed.
- Consequences: wizard clients can show a specific "AI could not write copy" message; no task in the plan owns website-audit.ts, so the one-line change is an off-plan edit.
- Alternatives considered: (b) map AI failures to an existing code (rejected).

## DEC-008 — Served previews and Shared Link pages keep their own style block (CSP style hash)
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: ADR 0036's CSP for served pages has `style-src 'self'`, which blocks the inline `<style>` element of the improved-homepage preview and the Pitch Glimpse, so they render unstyled over GET /api/audits/:id/preview and /s/:linkId. BE-604 used `style-src 'unsafe-inline'` instead.
- Decision: Option (a). Keep the strict CSP and allow only the page's own style element through a `'sha256-…'` hash computed from the exact `<style>` content served; no `'unsafe-inline'`, no `style` attributes beyond what the sanitiser allows. ADR 0036 is updated to say so.
- Consequences: previews and Shared Link pages are styled; any change to the served style text changes the hash automatically because it is computed per response.
- Alternatives considered: (b) leave them unstyled (rejected); `'unsafe-inline'` (rejected: wider than needed).

## DEC-009 — Upgrade firebase to clear the @grpc/grpc-js advisory
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: SEC-002: `firebase` 13.1.0 (packages/wizard) pulls `@grpc/grpc-js` < 1.13.6 through `@firebase/firestore` (GHSA-f596-whhp-79r4; 1 high, 1 low in `pnpm audit --prod`).
- Decision: Upgrade `firebase` in packages/wizard to the lowest exact version whose dependency tree has `@grpc/grpc-js` >= 1.13.6, pinned exactly, through the package manager.
- Consequences: lockfile changes limited to firebase and its dependencies; the wizard still imports only `firebase/app` and `firebase/auth`.
- Alternatives considered: accept the risk (rejected by the developer).
- Update (2026-11-03): no firebase release fixes it (every @firebase/firestore pins @grpc/grpc-js ~1.9.0). Developer chose option (a): a pnpm override `'@grpc/grpc-js': '>=1.13.6'` in pnpm-workspace.yaml `overrides`, then `pnpm install`. The wizard does not use firestore. Applied: `pnpm audit --prod` reports no known vulnerabilities.

## DEC-010 — "Test again" keeps the approved plan's screen sizes
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: QA-705 found wizard-e2e.test.ts:735 expecting all three screen sizes after "Test again", changed in unrelated commit f7fdeed6, while the product (site-memory.ts:41-42, checkup-run.ts:665) and checkups.test.ts:387 reuse the sizes the plan was approved with.
- Decision: "Test again" reuses only the approved plan's screen sizes. The e2e test expects exactly the first check-up's sizes (1440px in that test).
- Consequences: no product change; the e2e expectation is restored.
- Alternatives considered: always test all three sizes (rejected).

## DEC-011 — Helper sessions are signed with a random per-runner key
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: SEC-003 blocker F-045: the `qa_helper` cookie key is HKDF(RUNNER_ACCESS_TOKEN) with a fixed salt and label (`packages/runner/src/helpers/helper-session.ts:25-27`), and every beta tester receives the access key (README.md:226), so any tester can forge a Helper session for any email.
- Decision: Option (a). Each runner signs Helper sessions with a random 32-byte key generated at start and held in memory only; nothing derived from the access key. The cookie also carries the Google account id (`sub`) it was issued for. Helper sign-in stays off without FIREBASE_PROJECT_ID and the runner's access key, as before.
- Consequences: no new secret or configuration; a Helper signs in with Google again after each runner restart (Cloud Run scales to zero when idle). The runner keeps exactly one HelperAccess (BE-612 `auditWiring`), so routes and dispatch share the key; a second HelperAccess instance would refuse the first one's cookies.
- Alternatives considered: (b) dedicated HELPER_SESSION_SECRET from Secret Manager (rejected for now: new secret and configuration); server-side session ids (not needed).

## DEC-012 — Finish the Website Audit run trimmed: open minor findings become known limitations
- Date: 2026-11-03
- Status: accepted (developer, 2026-11-03)
- Context: After more than 6 hours of running, the developer chose to wind up today (option 2). The remaining work is the dependency chain BE-612 → BE-190 → QA-195/QA-500/QA-600 → QA-712 → QA-713 → final checks.
- Decision: Fix only what the chain and the open majors need. Do not reopen BE-192 for F-039, F-040 or the F-054 pipeline wiring. Skip F-033 (a plan change to `scripts/deploy-cloud-run.mjs`). Every open minor and info finding stays recorded in AI-EOS and is listed under Known limitations for a follow-up feature.
- Consequences: robots.txt and path limits are re-checked by the link check only when a caller passes them. The checkout/payment refusal is already active (BE-305), but the pipeline does not pass the crawl's robots policy yet. `scripts/deploy-cloud-run.mjs` still has the comma bug fixed in deploy.yml.
- Alternatives considered: (1) pause and resume next session; (3) finish everything (about 3 hours).

## DEC-013 — Wizard language choice, phone-layout view and Hindi export deferred to a follow-up
- Date: 2026-11-04
- Status: accepted (developer, 2026-11-04)
- Context: QA-712's browser test (`packages/wizard/tests/audit-languages-browser.test.ts`) passed for the Tamil page content and the Tamil export. It failed on four points the wizard does not build:
  - `AuditStartScreen.tsx` has no document-language choice, so `AuditStartBody.language` is never sent.
  - The results screens never show the phone layout (no 375px screenshot, no overflow result).
  - `export-api.ts:20` limits `EXPORT_LANGUAGES` to en/ta.
  - `results/analysis-text.ts` tags a mixed-script block by the first matching script, so a Hindi block with Tamil words gets lang=ta.
- Decision: Defer all four to a follow-up feature. QA-712 is narrowed (autopilot replan) to the Tamil content and Tamil export tests. The four tests for the deferred features are removed, not skipped. The follow-up re-adds them with these expectations:
  - Start screen: a combobox or radiogroup named /language/i offering all 12 `DOCUMENT_LANGUAGES` by English name, with a beta mark on the 11 beta ones.
  - Hindi: `/hi` content inside lang="hi".
  - Phone layout: a Sample Page shows an img named /phone|375/i plus the overflow result.
  - Export: the documents screen offers Hindi, and a Hindi export carries the beta note (DEC-005).
- Consequences: in the UI, every audit is started in the default document language, Hindi and other beta document languages cannot be picked, and the phone layout is recorded and stored but not shown. Tamil works end to end. REQ-032 and REQ-037 are only partly visible to the tool user until the follow-up.
- Alternatives considered: build the four features now (about 40-50 minutes; declined to wind up the run).

## DEC-014 — Pause the Website Audit run before the completion gate
- Date: 2026-11-04
- Status: accepted (developer, 2026-11-04: "stop here and write the follow-ups")
- Context: 87 of 88 tasks are VERIFIED. Passing on the final tree:
  - build EV-0371, lint EV-0370, type check EV-0372, unit EV-0374 (258 files), secrets EV-0373;
  - browser shards 1, 3 and 4: EV-0375, EV-0369, EV-0368;
  - every task check.
  Two blockers remain, each needing a fix round of about 45 minutes or more, because any code change makes every whole-repo check and all four shards stale.
- Decision: stop here. Work stays uncommitted on `feat/website-audit` (no completion gate, so no autopilot commit). `/ai-eos:go` resumes; the steps are under Known limitations → "Open at pause (DEC-014)".
- Fixed late in the run, for the record:
  - BE-105: `RobotsPolicy.fetch` now reads a local origin's own robots.txt again; public origins stay public-only. Regression tests are in robots.test.ts.
  - QA-706: `docs-url-beta.test.ts` clears its fixed data folders in beforeAll. Plan amended, APR-007.
  - QA-713: 20 browser test files moved to BROWSER_TESTS.
- Alternatives considered: continue (about 1.5-2 hours more).
