# Review report

> Maintained by AI-EOS (`/ai-eos:review`: code-reviewer, security-engineer, architecture-analyst).
> Every finding cites the inspected code (`path:line`). No change is approved without reading its diff.

## Scope

| Field | Value |
|---|---|
| Base | |
| Head | |
| Tasks covered | |
| Reviewers | |

## Findings

<!-- ai-eos:begin findings -->
| ID | Severity | Status | Title | Location | Requirements | Source | Resolution |
|---|---|---|---|---|---|---|---|
| F-001 | major | resolved | Link checks use Playwright APIRequestContext, which bypasses the beta SSRF guard and DNS pinning | packages/core/src/orchestrator.ts:212 | — | security-engineer:SEC-001 | BE-104: link and checker requests go through makeCheckerFetch/makeOutboundFetch; verified |
| F-002 | minor | resolved | DEC-004 implemented as 'no key = every caller is owner', not 'local request = owner' | packages/runner/src/server.ts:820 | — | security-engineer:SEC-001 | BE-102 correction verified: loopback-only owner without key (DEC-004); Helper dispatch wiring incl. id-less view rows |
| F-003 | minor | open | PDF Chromium launched with --no-sandbox while printing untrusted page text and AI output | packages/core/src/audit/documents/render-pdf.ts:38 | — | security-engineer:SEC-001 | — |
| F-004 | minor | open | Shared Link HTML (preview.html) will be served on the runner origin that holds the access cookie | packages/core/src/audit/store/audit-store.ts:390 | — | security-engineer:SEC-001 | — |
| F-005 | minor | open | Encrypted key fallback: legacy plaintext may persist, and an undecryptable file is overwritten | packages/core/src/ai/key-resolver.ts:271 | — | security-engineer:SEC-001 | — |
| F-006 | info | open | Route dispatch: exact matching, validated params, closed by default; unmatched paths still gated | packages/runner/src/routes/route.ts:143 | — | security-engineer:SEC-001 | — |
| F-007 | info | open | isPublicAddress treats 192.0.0.0/24 and 198.18.0.0/15 as public (not changed by this workflow) | packages/core/src/address-class.ts:57 | — | security-engineer:SEC-001 | — |
| F-008 | info | open | Helper grants store the plaintext email address (third-party personal data, ADR 0036) | packages/core/src/audit/store/helper-grants.ts:70 | — | security-engineer:SEC-001 | — |
| F-009 | info | open | resolveShare returns the full AuditSummary for the public route | packages/core/src/audit/store/shares.ts:138 | — | security-engineer:SEC-001 | — |
| F-010 | info | open | Gemini API key is put in the request URL (not changed by this workflow) | packages/core/src/ai/providers/gemini.ts:108 | — | security-engineer:SEC-001 | — |
| F-011 | info | open | No XSS sinks in the wizard audit screens; HTML/DOCX/ZIP outputs escaped or sanitized | packages/core/src/audit/documents/render-html.ts:74 | — | security-engineer:SEC-001 | — |
| F-012 | major | resolved | Hindi documents mix Hindi labels with English per-builder wording | packages/core/src/audit/documents/structure.ts:77 | REQ-018, REQ-027, REQ-032 | code-reviewer:REVIEW-002 | DEC-005: Hindi documents render English with beta note; verified by QA-711 23/23 |
| F-013 | minor | open | betaLabel is never used; beta-language documents carry no 'Beta translation' label (Q-45) | packages/core/src/audit/documents/labels/index.ts:68 | REQ-032 | code-reviewer:REVIEW-002 | — |
| F-014 | minor | open | Page language detection has no Devanagari; the wizard keeps a separate, different script table | packages/core/src/audit/analysis/language.ts:22 | REQ-013, REQ-032 | code-reviewer:REVIEW-002 | — |
| F-015 | minor | open | Wizard copies values from @qa/types/@qa/core instead of importing them through browser.js | packages/wizard/src/screens/audit/ai/stage-models-api.ts:15 | REQ-039, REQ-027, REQ-002 | code-reviewer:REVIEW-002 | — |
| F-016 | minor | open | Wizard and the Structure document use different link-region order and labels | packages/wizard/src/screens/audit/results/analysis-text.ts:40 | REQ-018 | code-reviewer:REVIEW-002 | — |
| F-017 | minor | open | Broken-link fetch contract allows following redirects into Skipped Pages | packages/core/src/audit/analysis/analyse-site.ts:62 | REQ-014, REQ-047 | code-reviewer:REVIEW-002 | — |
| F-018 | minor | open | requestSignal never clears its timer or abort listener after success | packages/core/src/ai/timeout.ts:52 | — | code-reviewer:REVIEW-002 | — |
| F-019 | info | open | HelperPermission redeclared in the runner | packages/runner/src/routes/route.ts:111 | — | code-reviewer:REVIEW-002 | — |
| F-020 | info | open | Outbound pacer covers the first-hop host only | packages/core/src/safe-net.ts:316 | — | code-reviewer:REVIEW-002 | — |
| F-021 | minor | open | RunnerServer treats port 0 as 3001 (`options.port \|\| 3001`) | packages/runner/src/server.ts:683 | REQ-046 | qa-engineer:QA-706 | — |
| F-022 | info | open | A stopped run may keep executing tests after stop (not confirmed) | packages/runner/src/session/checkup-run.ts | REQ-053 | qa-engineer:QA-706 | — |
| F-023 | major | resolved | Crawl result carries neither the HostPacer nor robots Crawl-delay, so pipeline checks ignore it | packages/core/src/audit/crawl/crawl.ts:51 | REQ-003 | code-reviewer:REVIEW-003 | BE-204 returns pacer/crawlDelayMs (EV-0172); BE-192 pipeline uses crawl.pacer (EV-0175) |
| F-024 | major | resolved | Pipeline leaves the version 'running' on save failure; updateVersion failure after a stored result throws the same save error | packages/core/src/audit/pipeline/pipeline.ts:640 | REQ-016 | code-reviewer:REVIEW-003 | Fixed. Pipeline (BE-192, pipeline.ts:661-689): a save failure throws AuditPipelineError 'save-failed'; a failed updateVersion after a stored result is retried once, then throws the distinct 'status-not-updated'. Caller (BE-205, audit-crawl.ts:292-307 runAuditVersion): abort -> 'stopped', 'status-not |
| F-025 | major | resolved | helperGrants gets no audit id for id-less view routes (/api/audits, /api/shortlist); HelperRouteStore does not match AuditStore | packages/runner/src/server.ts:827 | REQ-033 | code-reviewer:REVIEW-003 | BE-102 correction verified: loopback-only owner without key (DEC-004); Helper dispatch wiring incl. id-less view rows |
| F-026 | minor | open | Duplicated pitchScreenshots, IMAGE_TYPES and MAX_SCREENSHOT_BYTES in export and share | packages/runner/src/routes/audit-share.ts:158 | REQ-024 | code-reviewer:REVIEW-003 | — |
| F-027 | minor | open | Preview file name defined three times and preview image cap duplicates core's PREVIEW_IMAGE_MAX_BYTES | packages/runner/src/routes/audit-preview.ts:50 | REQ-024 | code-reviewer:REVIEW-003 | — |
| F-028 | minor | open | invalid-key store error maps to 404 in helper rows but 400 elsewhere; not-found wording differs | packages/runner/src/routes/audit-helpers.ts:78 | REQ-033 | code-reviewer:REVIEW-003 | — |
| F-029 | minor | open | 500 replies lack a code field, unlike every other audit refusal | packages/runner/src/routes/audit-store.ts:50 | REQ-028 | code-reviewer:REVIEW-003 | — |
| F-030 | major | resolved | REVIEW-005: a Check-up can enter Plan Review and run tests while a Website Audit or benchmark holds the run slot | packages/runner/src/routes/plan.ts:221 | REQ-049 | review | Fixed by BE-102 correction: ensurePlanLoaded (plan.ts:218-225 and server.ts:3342-3348) sets awaiting-review only when RunSlot.begin() succeeds; approve and waiting-plans POST answer 409 ERR_RUN_IN_PROGRESS while an audit or benchmark holds the slot; waiting-plans takes the slot through begin(). Regr |
| F-031 | major | resolved | REVIEW-005: a version left 'running' after a runner stop can never be deleted or re-run | packages/runner/src/routes/audit-rerun.ts:90 | REQ-028 | review | Fixed: re-run decides running from the live AuditRuns registry (BE-603, EV-0206) and routes/index.ts passes a live-run isRunning to auditStoreRoutes (BE-190 second pass, EV-0228), so a version left running after a restart can be deleted and re-run. |
| F-032 | major | resolved | REVIEW-005: deploy.yml --set-env-vars has a comma inside the RUNNER_ALLOWED_ORIGINS value, so gcloud rejects it | .github/workflows/deploy.yml:140 | REQ-029 | review | Fixed by BE-607 correction: deploy.yml:143 --set-env-vars uses gcloud's ^@^ alternate delimiter so RUNNER_ALLOWED_ORIGINS keeps both origins as one value; deploy-audit-store.test.ts parses the flag as gcloud does (^DELIM^ prefix, KEY=value per item, unique keys) and failed on the old comma-only line |
| F-033 | minor | open | scripts/deploy-cloud-run.mjs has the same comma-in-RUNNER_ALLOWED_ORIGINS problem as deploy.yml (pre-existing, f2c8a51; no task owns the file) | scripts/deploy-cloud-run.mjs:65 | REQ-029 | review | — |
| F-034 | minor | resolved | REVIEW-005: edits overlay has two writers (PATCH edits queued, rewrite accept not): lost update | packages/runner/src/routes/audit-documents.ts:62 | REQ-020 | review | Fixed: updateEditsOverlay exported from audit-documents.ts on the per-version queue (BE-509, EV-0214); PATCH and the rewrite-accept path in routes/index.ts both use it (BE-190 second pass, EV-0228). |
| F-035 | minor | resolved | REVIEW-005: Shared Link create answers 409 with code ERR_INVALID_REQUEST | packages/runner/src/routes/audit-share.ts:326 | REQ-024 | review | Fixed by BE-604 correction: preview link without stored preview answers 400 ERR_INVALID_REQUEST; pitch link without finished result answers 404 ERR_AUDIT_NOT_FOUND (as audit-export.ts); running stays 409 ERR_AUDIT_RUNNING. Tests updated. |
| F-036 | minor | resolved | REVIEW-005: CONFIGURATION.md says Helper sign-in needs all three Firebase values; code and DEPLOYMENT.md need project ID plus access key | docs/CONFIGURATION.md:70 | REQ-033 | review | Fixed by BE-704 correction: CONFIGURATION.md states Helper sign-in turns on with FIREBASE_PROJECT_ID and RUNNER_ACCESS_TOKEN; FIREBASE_WEB_API_KEY and FIREBASE_AUTH_DOMAIN optional (default <projectId>.firebaseapp.com); wizard falls back to VITE_FIREBASE_*; DEC-011 re-sign-in note added (code change |
| F-037 | minor | resolved | REVIEW-005: start screen gives no link to the finished audit; a 404 stream shows Reconnecting forever | packages/wizard/src/screens/audit/start/AuditStartScreen.tsx:275 | REQ-001 | review | Fixed by FE-200 correction: a finished audit links to /audits/:id (AuditFollowUpLink); a closed EventSource (readyState 2) is final (onEnd) and shows a plain 'progress stream ended' message with the history link instead of Reconnecting. Tests in audit-start-screen.test.tsx and audit-start-form.test. |
| F-038 | info | open | REVIEW-005: RunSlot.release() is not tied to the claiming run | packages/runner/src/routes/audit-rerun.ts:132 | REQ-049 | review | — |
| F-039 | minor | open | REVIEW-004: checker (phone, accessibility) findings cite no Section and citationProblems are dropped | packages/core/src/audit/pipeline/pipeline.ts:594 | REQ-017 | review | — |
| F-040 | minor | open | REVIEW-004: technology detection by response header never runs in a real audit | packages/core/src/audit/pipeline/page-recorder.ts:89 | REQ-010 | review | — |
| F-041 | minor | open | REVIEW-004: listAudits lists every object in the store on each Saved Audits or Shortlist view | packages/core/src/audit/store/audit-store.ts:334 | REQ-028 | review | — |
| F-042 | info | open | REVIEW-004: Cloud Storage deletePrefix deletes one object at a time while the audit lock is held | packages/core/src/audit/store/gcs-backend.ts:252 | REQ-028 | review | — |
| F-043 | info | open | REVIEW-004: Check-up SEO broken-link check no longer follows redirects | packages/core/src/orchestrator.ts:569 | REQ-047 | review | — |
| F-044 | info | open | REVIEW-004: a 120 s default deadline now applies to every Check-up AI call | packages/core/src/ai/timeout.ts:7 | — | review | — |
| F-045 | blocker | resolved | SEC-003: Helper session cookie is signed with a key derived from RUNNER_ACCESS_TOKEN, which every beta tester holds: any tester can forge a Helper session for any email | packages/runner/src/helpers/helper-session.ts:25 | REQ-033 | review | Fixed by BE-606 correction per DEC-011: helperSessionKey (HKDF of RUNNER_ACCESS_TOKEN) removed; each HelperAccess signs qa_helper with randomBytes(32) held in memory; cookie claims {email, sub, exp}, sub required and MAC-covered. Regression tests: old-HKDF cookies, another instance's key, missing or |
| F-046 | minor | open | SEC-003: Firebase web API key (public via /api/helper/status) has no documented API or referrer restriction | docs/DEPLOYMENT.md:113 | REQ-033 | review | — |
| F-047 | minor | resolved | SEC-003: PDF exports launch one Chromium per request with no concurrency cap | packages/runner/src/routes/audit-export.ts:227 | REQ-022 | review | Fixed by BE-510 correction: PDF exports limited to 2 concurrent per runner (deps.maxConcurrentPdf), over the limit answers 503 with Retry-After and ERR_RUN_IN_PROGRESS; slot released in finally; tests for 503, non-PDF unaffected, release after error. |
| F-048 | info | open | SEC-003: removeHelper sends the Helper email in the query string (lands in request logs) | packages/runner/src/routes/audit-helpers.ts:138 | REQ-033 | review | — |
| F-049 | info | open | SEC-003: export, edits and AI rows get no caller and rely only on the dispatch Helper check | packages/runner/src/routes/audit-export.ts:223 | REQ-033 | review | — |
| F-050 | info | open | SEC-003: Helper sessions are stateless; sign-out does not end a copied cookie (up to 8 h) | packages/runner/src/routes/audit-helpers.ts:204 | REQ-033 | review | — |
| F-051 | major | resolved | SEC-002: audit crawl does not pin the audited host in Chromium; DNS rebinding passes the public-only guard and private content is read, stored and shareable | packages/core/src/audit/crawl/crawl.ts:174 | REQ-002 | review | Fixed by BE-204 correction: crawl resolves the start host once with resolvePublic and fails closed (AuditCrawlRefusedError), launches its own Chromium with --host-resolver-rules pinning the host and www twin (~NOTFOUND when not public), never inherits browserPolicy.pinned; DNS-rebinding test added. |
| F-052 | major | resolved | SEC-002: audit browser context allows service workers, whose requests skip the request guard and blockChanges | packages/core/src/browser.ts:145 | REQ-002 | review | Fixed by BE-204 correction: audit context created with serviceWorkers 'block' (crawl.ts:276); test asserts it. |
| F-053 | minor | resolved | SEC-002: preview CSS sanitiser lets an unbalanced [ or ( in an AI selector swallow the frame CSS, so the AI-preview note can be covered | packages/core/src/audit/preview/sanitize.ts:509 | REQ-024 | review | Fixed by BE-605 correction: balancedSelector drops selectors with unbalanced brackets, parentheses or quotes; FRAME_CSS is served in its own style element after the AI's; both CSPs hash every style element. |
| F-054 | minor | open | SEC-002: after the crawl time limit, the link check can GET robots-disallowed and checkout paths | packages/core/src/audit/analysis/broken-links.ts:112 | REQ-036 | review | — |
| F-055 | minor | open | SEC-002: robots.txt 5xx, 429 or no answer is treated as allow-all (RFC 9309: server error means disallow) | packages/core/src/competitive/robots.ts:101 | REQ-034 | review | — |
| F-056 | minor | open | SEC-002: audit crawler does not identify itself (HeadlessChrome UA, no UA on outbound fetches) though robots uses QA-Benchmarking-Bot | packages/core/src/audit/crawl/crawl.ts:25 | REQ-034 | review | — |
| F-057 | minor | open | SEC-002: robots.txt checked only against the requested path and start origin; a disallowed landed path after a redirect is still recorded | packages/core/src/discovery/deterministic-spider.ts:652 | REQ-034 | review | — |
| F-058 | minor | resolved | SEC-002: test fixture matches the anthropic-key secret rule (high); needs a human check that it is synthetic | packages/core/tests/key-resolver-encryption.test.ts:158 | REQ-052 | review | False positive: the developer confirmed on 2026-11-03 that packages/core/tests/key-resolver-encryption.test.ts:158 holds no real Anthropic key (value not read by the orchestrator). No rotation needed. |
| F-059 | info | open | SEC-002: Gemini model id goes into the request URL without encoding | packages/core/src/ai/providers/gemini.ts:110 | — | review | — |
| F-060 | major | resolved | REVIEW-006: Improvement Roadmap item titles ignore finding edits and removed pages (Roadmap, Proposal timeline, Owner Audit show corrected text) | packages/core/src/audit/documents/edits.ts:518 | REQ-020 | review | Fixed by BE-500 correction: buildEditedView rebuilds roadmap items from kept findings as edited (title from first kept finding; priority/effort/phase recomputed with buildRoadmap's rule when findings drop). 4 regression tests failed before and pass after; neighbouring document suites pass (6 files,  |
| F-061 | minor | open | REVIEW-006: claim-word check is English-only but AI writes Tamil copy | packages/core/src/audit/documents/wording.ts:9 | REQ-016 | review | — |
| F-062 | minor | open | REVIEW-006: RewriteStore save queue is per object but the runner creates a new store per request (lost approvals) | packages/core/src/audit/ai/rewrite-store.ts:170 | REQ-030 | review | — |
| F-063 | minor | open | REVIEW-006: NAP from a LocalBusiness JSON-LD block over 4,000 characters is lost (cut copy no longer parses) | packages/core/src/audit/analysis/nap.ts:114 | — | review | — |
| F-064 | minor | open | REVIEW-006: Page Content caps only page text; link, image, CTA, heading, form and address lists and heading text are uncapped | packages/core/src/audit/analysis/read-page.ts:264 | REQ-007 | review | — |
| F-065 | info | open | REVIEW-006: with a cloud store, rewrite state is kept on the runner's local /tmp and lost on scale-to-zero | packages/runner/src/routes/index.ts:159 | REQ-030 | review | — |
| F-066 | major | accepted | SEC-004: on a keyed copy a Helper without the access key cannot load the wizard or /helper (UI served after the access-key gate), so using Helpers means handing out the owner key | packages/runner/src/server.ts:1053 | REQ-033 | review | Known limitation (DEC-012): fix in follow-up |
| F-067 | minor | open | SEC-004: Helper sign-in cannot work from the site host, yet DEPLOYMENT.md says to add the site host to Firebase authorized domains | docs/DEPLOYMENT.md:116 | REQ-033 | review | — |
| F-068 | minor | open | SEC-004: rewrite state on the cloud backend lives in <dataDir>/audit-rewrites and is not removed when the audit is deleted (ADR 0036) | packages/runner/src/routes/index.ts:159 | REQ-028 | review | — |
| F-069 | minor | open | SEC-004: export bundle README tells a coding assistant to act on site.json (verbatim page text) without marking it untrusted | packages/core/src/audit/documents/bundle.ts:157 | REQ-021 | review | — |
| F-070 | info | open | SEC-004: rewrite answers are not checked for new phone numbers, emails, URLs or prices absent from the original | packages/core/src/audit/ai/rewrite.ts:128 | REQ-030 | review | — |
| F-071 | info | open | SEC-004: NAP extraction takes any <address> element and keeps emails in mixed lines | packages/core/src/audit/analysis/nap.ts:153 | — | review | — |
| F-072 | info | open | SEC-004: content and file rows declare no explicit beta policy (default closed) | packages/runner/src/routes/audit-content.ts:53 | REQ-048 | review | — |
<!-- ai-eos:end findings -->

Severity: `blocker` (must fix before completion; blocks the gate), `major` (fix or explicitly accept),
`minor`, `info`.

## Integration check

<!-- ai-eos:begin integration -->
_Run `aieos integrate check` to populate._
<!-- ai-eos:end integration -->

## Review notes

### Correctness

### Architecture and interfaces

### Maintainability and conventions

### Error handling and performance

### Security

## Verdict

_`changes required` while any blocker is open; otherwise `acceptable` with listed follow-ups._
