# Tickets

The tracker for open work and the committed record of each ticket's status. When this file and `.claude/work/backlog.md` disagree, this file wins. The ticket body is the linked section of its plan, which holds the scope, files, tests and the reason for any `blocked`, `human` or `later` status.

## Statuses

The status cell holds exactly one of these keywords:

| Status | Meaning | Set by |
|---|---|---|
| `todo` | Ticket written, not yet planned | the plan author |
| `planned` | Plan written, waiting for approval | `/ship plan` |
| `approved` | Approved, ready to build | the human (`/ship approve`) |
| `building` | Being built | `/build-next` |
| `built` | Code written; tests wait for `/verify-all` | `/build-next` |
| `done` | Verified | `/verify-all` |
| `blocked` | Cannot proceed; the reason is in the plan | whoever hits the block |
| `human` | Code built; manual steps left for a person | the builder |
| `later` | Deferred by decision | the human |

The order of work is `todo` → `planned` → `approved` → `building` → `built` → `done`. Waves order tickets within one plan only. Build a wave once every ticket in the waves before it is `built`. Gap ids and other ids resolve in the linked plan.

## Open: Website Audit reliability

Decisions: [ADR 0042](../adr/0042-website-audit-reliability-and-access.md), [ADR 0043](../adr/0043-parallel-page-fetching-in-the-website-audit.md). The Website Audit reliability plan (T-86, T-89) was removed once built; read it with `git show dfe5bc4:docs/tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md`.

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|

## Open: audit follow-up (November 2026)

One file per ticket under [audit-2026-11/](audit-2026-11/). Each file names the files it may edit and the tickets it must not be built beside. These 54 tickets cover what the audit left over: findings that never got a ticket, and work that built tickets deferred in their Notes.

The tickets are grouped into chains. Tickets in one chain edit the same files, so build them one after another in wave order. Different chains can be built at the same time, with two limits: T-240 also edits `packages/runner/src/routes/plan.ts`, so do not build it beside T-256, T-258 or T-260; and T-225 edits every workflow file, so build it after T-274 if both are in flight. No ticket is waiting on a decision: the owner settled all eleven open choices on 2026-11-11, and each ticket records the answer.

The ids are not continuous: T-235 to T-239, T-253, T-254, T-280 to T-284 and T-290 to T-294 were reserved and never used. No ticket is missing.

### CI workflows

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-226](audit-2026-11/T-226-ci-and-deploy-share-audit-and-secret-scan.md) | CI and Deploy share one audit job and one secret-scan job | - | P3 | M | 1 | todo | - |
| [T-227](audit-2026-11/T-227-quality-gate-timeout-and-stale-comment.md) | Give the CI quality gate a workable timeout | - | P3 | S | 2 | todo | T-226 |
| [T-228](audit-2026-11/T-228-run-plugin-checks-in-ci.md) | Run the plugin checks in CI | - | P3 | S | 3 | todo | T-227 |
| [T-279](audit-2026-11/T-279-release-workflow-drops-repeat-build-step.md) | Release workflow drops the repeated `Build` step | - | P4 | S | 4 | todo | T-228 |
| [T-275](audit-2026-11/T-275-tests-workflow-shard-input-description.md) | `tests.yml` shard input describes both shard counts | - | P4 | S | 5 | todo | T-279 |
| [T-225](audit-2026-11/T-225-pin-third-party-actions-to-commit-sha.md) | Pin every GitHub Action to a commit SHA | - | P2 | S | 6 | todo | T-275 |

### Dependencies (each runs `pnpm install`)

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-270](audit-2026-11/T-270-remove-duplicate-dev-script.md) | Remove the `dev` script that repeats `dev:wizard` | - | P4 | S | 1 | todo | - |
| [T-229](audit-2026-11/T-229-remove-unused-coverage-setup.md) | Remove the coverage setup nothing runs | - | P3 | S | 2 | todo | T-270 |
| [T-278](audit-2026-11/T-278-wizard-declares-core-and-runner-for-its-tests.md) | The wizard declares `@qa/core` and `@qa/runner`, which its tests import | - | P4 | S | 4 | todo | T-271 |
| [T-268](audit-2026-11/T-268-runner-declares-playwright-for-its-browser-tests.md) | The runner declares Playwright, and its browser tests import it by name | - | P3 | S | 5 | todo | T-278 |

### Runner `server.ts` and `routes/plan.ts`

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-255](audit-2026-11/T-255-regrade-keeps-flaky-and-marketing-options.md) | Re-grading a report keeps the flaky count and the marketing flag | - | P2 | S | 1 | todo | - |
| [T-256](audit-2026-11/T-256-plan-routes-one-no-tests-text-and-plain-context.md) | Plan routes use one "nothing to test" text and a plain context check | - | P3 | S | 2 | todo | T-255 |
| [T-259](audit-2026-11/T-259-one-copy-of-is-inside-and-cookie-reader.md) | One copy of `isInside` and one cookie reader | - | P3 | S | 3 | todo | T-256 |
| [T-267](audit-2026-11/T-267-visual-baselines-send-the-new-screenshot.md) | The Visual Baselines list sends the new screenshot, so it can be kept | - | P2 | M | 4 | todo | T-259 |
| [T-258](audit-2026-11/T-258-one-copy-of-target-url-sign-in-and-plan-load-helpers.md) | One copy each of `resolveTargetUrl`, `signInAccount`, `hasCompleteSignIn` and `ensurePlanLoaded` | - | P3 | S | 5 | todo | T-267 |
| [T-260](audit-2026-11/T-260-one-add-tokens-for-ai-usage.md) | One `addTokens` for AI token use | - | P3 | S | 6 | todo | T-258 |
| [T-261](audit-2026-11/T-261-one-https-check-for-cookie-secure-flag.md) | One "was this visit https" check for the cookie Secure flag | - | P3 | S | 7 | todo | T-260 |
| [T-265](audit-2026-11/T-265-ai-estimate-asks-openrouter-once.md) | The AI estimate asks OpenRouter for today's requests once | - | P3 | S | 8 | todo | T-261 |

### Website Audit routes, then the wizard and core text that follow them

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-257](audit-2026-11/T-257-audit-share-delete-dead-s-prefix-row.md) | Delete the dead `GET /s` prefix row in the Shared Link routes | - | P3 | S | 1 | todo | - |
| [T-262](audit-2026-11/T-262-one-refuse-store-failure-for-audit-routes.md) | One `refuse` and one `refuseStoreFailure` for the Website Audit routes | - | P3 | M | 2 | todo | T-257 |
| [T-263](audit-2026-11/T-263-one-pitch-screenshots-and-edits-reader.md) | One `pitchScreenshots` and one reader of a version's edits | - | P3 | M | 3 | todo | T-262 |
| [T-264](audit-2026-11/T-264-one-loader-for-stored-audit-settings.md) | One loader for the stored Website Audit settings | - | P3 | S | 4 | todo | T-263 |
| [T-244](audit-2026-11/T-244-preview-without-ai-key-uses-template.md) | The improved-homepage preview works without an AI key (template text) | - | P2 | S | 5 | todo | T-264 |
| [T-266](audit-2026-11/T-266-audit-scoped-stop-route.md) | `POST /api/audits/:id/stop`, a Stop that only touches that Website Audit | - | P2 | M | 6 | todo | T-244 |
| [T-289](audit-2026-11/T-289-audit-ai-key-note-links-to-settings.md) | Website Audit AI-key notes point to Settings, and two unused test names go | - | P2 | S | 7 | todo | T-266 |
| [T-269](audit-2026-11/T-269-wizard-stop-button-calls-the-audit-stop-route.md) | The Website Audit Stop button calls the audit's own stop route | - | P2 | S | 8 | todo | T-289 |
| [T-295](audit-2026-11/T-295-expired-ai-key-note-points-to-settings.md) | The expired AI key note points to Settings | - | P3 | S | 9 | todo | T-269 |

### Core crawl and robots

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-240](audit-2026-11/T-240-robots-one-token-and-discovery-honours-crawl-delay.md) | One robots token, and the discovery crawl honours Crawl-delay | - | P2 | S | 1 | todo | - |
| [T-241](audit-2026-11/T-241-docs-fetch-single-pass-entities-and-interpret-json.md) | Docs entity decoding in one pass, and `interpret.ts` reads AI JSON like the planner | - | P3 | S | 2 | todo | T-240 |
| [T-248](audit-2026-11/T-248-is-private-host-uses-the-address-classifier.md) | `isPrivateHost` uses the shared address classifier | - | P2 | S | 3 | todo | T-241 |

### Core and types findings

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-232](audit-2026-11/T-232-one-missing-title-problem-across-checks.md) | A missing page title counts as two problems (search check and accessibility scan) | - | P2 | S | 1 | todo | - |
| [T-249](audit-2026-11/T-249-one-severity-order-and-one-doc-source-of.md) | One severity order and one `docSourceOf` in core | - | P3 | S | 2 | todo | T-232 |
| [T-251](audit-2026-11/T-251-delete-six-unused-core-members.md) | Delete six unused members in core and types | - | P3 | M | 3 | todo | T-249 |

### Core orchestrator

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-247](audit-2026-11/T-247-source-locator-skips-the-tools-own-repository.md) | The source locator does not search the tool's own repository | - | P3 | S | 1 | todo | - |
| [T-252](audit-2026-11/T-252-visual-baseline-recording-is-unreachable.md) | Recording masked visual baselines is unreachable (`RunOptions.updateBaselines`) | - | P3 | S | 2 | todo | T-247 |

### Independent (any order, beside anything)

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-230](audit-2026-11/T-230-test-run-completed-reaches-on-event.md) | Test that the finished-run event reaches `onEvent` as the logged object | - | P3 | S | 1 | todo | - |
| [T-231](audit-2026-11/T-231-keyboard-walk-reads-the-focusable-list-once.md) | The Tab walk rebuilds the list of focusable elements on every key press | - | P3 | S | 1 | todo | - |
| [T-233](audit-2026-11/T-233-delete-unused-run-start-and-approval-replies.md) | Delete the two check-up API reply types that only a test uses | - | P3 | S | 1 | todo | - |
| [T-234](audit-2026-11/T-234-security-csrf-and-depth-checks-that-fail-say-so.md) | The CSRF check and the security-depth checks that could not run read as a pass | - | P2 | S | 1 | todo | - |
| [T-242](audit-2026-11/T-242-ux-gap-synthesizer-checks-provider-type.md) | The UX gap synthesizer checks `providerType`, not the class name | - | P3 | S | 1 | todo | - |
| [T-243](audit-2026-11/T-243-one-zip-writer.md) | One ZIP writer: the Playwright export uses `writeZip` | - | P3 | S | 1 | todo | - |
| [T-245](audit-2026-11/T-245-replan-keeps-document-items.md) | Re-planning keeps the Plan Items that came from documents | - | P2 | M | 1 | todo | - |
| [T-246](audit-2026-11/T-246-planning-batches-run-in-parallel.md) | Page planning batches run in parallel when the AI pacing allows | - | P3 | M | 1 | todo | - |
| [T-250](audit-2026-11/T-250-delete-account-pool-figma-sync-and-unused-namespacer-methods.md) | Delete the account pool, the Figma sync and two unused `EntityNamespacer` methods | - | P3 | S | 1 | todo | - |
| [T-272](audit-2026-11/T-272-ignore-files-list-generated-folders.md) | ESLint and Docker ignore the generated folders; `.gitignore` loses redundant lines | - | P3 | S | 1 | todo | - |
| [T-273](audit-2026-11/T-273-site-nginx-gzip-and-one-csp.md) | Site nginx compresses text files and states the CSP once | - | P3 | S | 1 | todo | - |
| [T-274](audit-2026-11/T-274-dependabot-watches-site-image.md) | Dependabot watches the site image | - | P3 | S | 1 | todo | - |
| [T-276](audit-2026-11/T-276-manual-deploy-script-matches-ci.md) | The manual deploy script allows the same origins as CI and verifies the commit | - | P3 | S | 1 | todo | - |
| [T-277](audit-2026-11/T-277-runner-dockerfile-single-stage-decision.md) | Record why the runner image stays single-stage | - | P4 | S | 1 | todo | - |
| [T-285](audit-2026-11/T-285-wizard-delete-unused-plan-translate-functions.md) | Wizard: delete four unused Plan translation functions and their tests | - | P3 | S | 1 | todo | - |
| [T-286](audit-2026-11/T-286-wizard-delete-unused-context-and-onboarding-helpers.md) | Wizard: delete `buildProductContext` and `hasNonDefaultOptions` and their tests | - | P3 | S | 1 | todo | - |
| [T-287](audit-2026-11/T-287-plan-group-switch-outside-summary.md) | Plan Review: the group "Switch off" button leaves the `<summary>` | - | P3 | S | 1 | todo | - |
| [T-288](audit-2026-11/T-288-favicon-and-share-image-use-current-palette.md) | Favicon and share image use the current palette | - | P4 | S | 1 | todo | - |

## Open: findings of the 11 November 2026 audit

One file per ticket under [audit-2026-11/](audit-2026-11/), T-296 to T-387 (92 tickets). They cover the findings of the read-only audit of 11 November 2026 (on `d225418`) that no open ticket covered. The `gaps` column holds that audit's finding ids: H = High, M = Medium, L = Low. Every ticket was checked against the code on `2c89c86`.

Wave numbers run across all 92 tickets. Two tickets in the same wave never edit the same file, so a whole wave can be built at once. Build a ticket when its `depends on` tickets are built and no ticket named in its "Do not build in parallel with" line is being built; that line also names the open tickets T-225 to T-295 it shares files with. `server.ts`, `checkup-run.ts`, `orchestrator.ts` and the wizard's `App.tsx` are the busy files: their tickets run one after another. Wave 1 holds most P1 tickets.

Ten tickets wait on an owner decision: T-298, T-301, T-308, T-312, T-331, T-343, T-367, T-373, T-376 and T-385. Each one builds its option A unless the owner picks another.

Findings with no new ticket:

- Covered by an open ticket: M11 (T-225), M27 (T-247), L12 (T-23), M9's Figma part (T-250), M10's gzip and single CSP (T-273), M13's ignored folders (T-272), L5's duplicated jobs, site image and release build (T-226, T-274, T-279), L7's Tab-walk speed (T-231), L13's plan-context fallback, account pool and Figma sync (T-256, T-250), L17's `isPrivateHost` copy (T-248), and the UX gap synthesizer check (T-242).
- Already done: H11's formatting failures (676f7bb; T-374 adds the deploy gate) and L3's missing index entries (PR #66).
- Closed by an owner decision: M13's two-stage runner image (T-277 keeps one stage) and M15, coverage in CI (T-229 removes the coverage setup; reopen only if T-229 is reversed).
- Corrected while writing: H12's five failing browser tests are out of date, not app faults. The refusal rule changed on purpose in 27acd13 and the landing theme in 2902365. T-337 and T-361 update the tests.

### Runner: hosted beta isolation

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-296](audit-2026-11/T-296-sign-in-test-uses-only-its-own-headers.md) | The sign-in test sends only its own request's headers, and run secrets are cleared when a run ends | H1 | P1 | S | 1 | todo | - |
| [T-297](audit-2026-11/T-297-beta-access-key-is-not-audit-owner.md) | On a beta copy the access key alone is not an audit owner inside the audit handlers | H2 | P1 | S | 2 | todo | T-296 |
| [T-298](audit-2026-11/T-298-beta-schedules-belong-to-an-owner.md) | On a beta copy each schedule belongs to its owner, with a cap per owner | H3 | P1 | M | 3 | todo | T-297 |
| [T-299](audit-2026-11/T-299-scheduled-checkup-reports-open-for-owner.md) | Reports from scheduled Check-ups open for the schedule's owner on the hosted copy | M3 | P2 | M | 4 | todo | T-298 |
| [T-300](audit-2026-11/T-300-hosted-browser-limit-and-stream-cap.md) | One browser-launch limit and an event-stream cap on the hosted copy; sign-in tests and smoke runs count against the quota | M1 | P2 | M | 5 | todo | T-299 |
| [T-301](audit-2026-11/T-301-beta-quotas-survive-restarts.md) | Beta and audit quotas survive a restart, and the trusted forwarded hop is configurable | M2 | P2 | M | 6 | todo | T-300 |
| [T-302](audit-2026-11/T-302-beta-sessions-and-canonical-host.md) | Sign-in rows create no beta session, and canonical URLs use PUBLIC_URL | L11 | P3 | S | 15 | todo | T-357 |
| [T-303](audit-2026-11/T-303-runner-security-headers.md) | The runner sends frame-ancestors, a CSP and HSTS | M10 | P2 | S | 7 | todo | T-301 |
| [T-304](audit-2026-11/T-304-site-csp-enforced-and-hsts.md) | The static site enforces its CSP and sends HSTS | M10 | P2 | S | 1 | todo | T-273 |

### Core: browser guard and plan safety

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-305](audit-2026-11/T-305-form-constraints-checked-in-the-browser.md) | A page's form `pattern` and `minlength` cannot freeze or flood the runner | H4 | P1 | S | 1 | todo | - |
| [T-306](audit-2026-11/T-306-docs-fetch-strips-html-in-linear-time.md) | Docs fetch strips HTML in linear time | H5 | P1 | S | 1 | todo | T-241 |
| [T-307](audit-2026-11/T-307-browser-guard-covers-websockets-and-service-workers.md) | The browser guard covers WebSockets and blocks service workers in every context | H6 | P1 | M | 1 | todo | - |
| [T-308](audit-2026-11/T-308-pinned-egress-proxy-for-chromium.md) | Decide, then build, a pinned egress proxy for Chromium | H6 | P2 | L | 8 | todo | T-303, T-307 |
| [T-309](audit-2026-11/T-309-plan-steps-stay-on-the-target-site.md) | Plan steps and start pages stay on the target site, and sign-in placeholders fill only on the target origin | H7 | P1 | S | 1 | todo | - |
| [T-310](audit-2026-11/T-310-test-case-ids-are-safe-file-names.md) | Test case ids are safe file names before they reach evidence paths | H8 | P1 | S | 2 | todo | T-309 |
| [T-311](audit-2026-11/T-311-one-safety-filter-for-spaced-wording-and-journeys.md) | One Safety Filter that reads spaced wording, applied to AI journeys too | H9 | P1 | M | 3 | todo | T-310 |
| [T-312](audit-2026-11/T-312-tls-errors-reported-outside-test-hosts.md) | Certificate errors are ignored only for local and test hosts, and reported otherwise | M7 | P2 | M | 9 | todo | T-307, T-308 |

### Core: AI providers, redaction and Roles

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-313](audit-2026-11/T-313-ai-providers-adc-local-only-and-unknown-refused.md) | AI providers: Google sign-in (ADC) only on a local runner, unknown provider names refused, error bodies trimmed | M4, L17 | P2 | M | 10 | todo | T-312 |
| [T-314](audit-2026-11/T-314-docx-conversion-caps-inflated-size.md) | The .docx conversion caps the inflated size, not just the declared size | M5 | P2 | M | 1 | todo | - |
| [T-315](audit-2026-11/T-315-agent-facing-files-frame-site-text-as-data.md) | report.md and the export bundle mark site text as untrusted data | M6 | P2 | S | 1 | todo | - |
| [T-316](audit-2026-11/T-316-redaction-on-every-exit-and-all-secrets.md) | Evidence is redacted on every exit, and redaction knows headers, tunnel auth and saved sessions | M8 | P2 | S | 10 | todo | T-312 |
| [T-317](audit-2026-11/T-317-api-spec-checks-use-guarded-fetch.md) | API spec checks use the guarded fetch, and the outbound grep catches aliased fetch | M9 | P2 | S | 1 | todo | T-250 |
| [T-318](audit-2026-11/T-318-token-and-header-roles-in-every-context.md) | Token and header Roles stay signed in for every test context; the re-login context always closes | M25 | P2 | S | 11 | todo | T-316 |
| [T-319](audit-2026-11/T-319-export-password-only-in-password-fields.md) | The Playwright export types the Role password only into password fields | L17 | P3 | S | 1 | todo | - |
| [T-320](audit-2026-11/T-320-address-classifier-gaps-and-allow-private.md) | The address classifier knows 6to4, Teredo and the benchmark ranges, and allowPrivate follows the guard | L17 | P3 | S | 9 | todo | T-308 |

### Core: Website Audit store and pipeline

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-321](audit-2026-11/T-321-cloud-storage-deletes-record-last-with-timeouts.md) | Cloud Storage: the audit record is deleted last, and requests time out and retry | H15, H16 | P1 | M | 1 | todo | - |
| [T-322](audit-2026-11/T-322-audit-page-data-capped-and-hosted-max-pages.md) | Website Audit page data is capped, and the hosted page limit applies | M37 | P2 | M | 2 | todo | T-321 |
| [T-323](audit-2026-11/T-323-rewrite-state-lives-in-the-audit-store.md) | Section rewrite state lives in the audit store, so it survives deploys and goes with deletion | M38 | P2 | M | 3 | todo | T-322 |
| [T-324](audit-2026-11/T-324-page-content-treats-www-twin-as-same-site.md) | Page Content treats the www twin as the same site | M39 | P2 | S | 3 | todo | T-322 |
| [T-325](audit-2026-11/T-325-shared-link-reads-one-version.md) | A Shared Link view reads only its own version, and audit listing has bounded concurrency | M40 | P2 | S | 2 | todo | T-321 |
| [T-326](audit-2026-11/T-326-pagespeed-honours-stop-and-runs-in-a-pool.md) | PageSpeed and site analysis honour Stop, and PageSpeed runs a small pool with a page cap | M31 | P2 | M | 3 | todo | T-322 |
| [T-327](audit-2026-11/T-327-preview-fallback-localised-and-reported.md) | The preview template is localised, filters claim words, and the result says when it fell back | L18, L13 | P3 | S | 1 | todo | - |
| [T-328](audit-2026-11/T-328-pipeline-write-all-circular-import.md) | Move `pageContentName` out of the pipeline to end a circular import | L13 | P4 | S | 4 | todo | T-326 |

### Core: plan, AI budget, reports and tests

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-329](audit-2026-11/T-329-visual-baselines-keyed-by-host-and-item.md) | Visual baselines are keyed by host and a stable Plan Item key | M26 | P2 | M | 12 | todo | T-318 |
| [T-330](audit-2026-11/T-330-stop-cancels-in-flight-ai-requests.md) | Stop cancels AI requests already in flight | M29 | P2 | S | 1 | todo | - |
| [T-331](audit-2026-11/T-331-dollar-cap-needs-a-price-and-reserves-cost.md) | A dollar cap is refused when no price is known, and cost is reserved before sending | M30 | P2 | M | 13 | todo | T-329, T-330 |
| [T-332](audit-2026-11/T-332-docs-fetch-and-narrow-pass-respect-limits.md) | Docs fetch counts every attempt, and the narrow-screen pass keeps the scan deadline | M31 | P2 | S | 10 | todo | T-306, T-312 |
| [T-333](audit-2026-11/T-333-ai-answers-validated-visual-review-and-journeys.md) | Visual review validates the AI's answer, and a failed journeys repair keeps the first answer | M32 | P2 | S | 1 | todo | - |
| [T-334](audit-2026-11/T-334-one-guess-fill-value.md) | One `guessFillValue` for page tests and journeys | L13 | P4 | S | 2 | todo | T-333 |
| [T-335](audit-2026-11/T-335-report-headings-and-table-scope.md) | The HTML report's headings follow order and its tables have header scope | L15 | P3 | S | 1 | todo | - |
| [T-336](audit-2026-11/T-336-discovery-agent-and-orchestrator-tests.md) | Tests for the DiscoveryAgent helpers and the orchestrator's stop and retry paths | M16 | P3 | M | 11 | todo | T-380 |

### Checkers and types

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-337](audit-2026-11/T-337-refusal-tests-match-the-rule.md) | The refusal browser tests set the page up the way the rule now reads it, and the evaluate results are checked | H12 | P1 | S | 1 | todo | - |
| [T-338](audit-2026-11/T-338-spec-conformance-text-and-url-patterns.md) | Spec Conformance: text expectations ignore case, URL patterns are capped wildcards, API paths match whole segments | M22, M23 | P2 | S | 1 | todo | - |
| [T-339](audit-2026-11/T-339-security-headers-parsed.md) | The security header checks parse HSTS, frame-ancestors and the CSP | M19 | P2 | S | 1 | todo | T-234 |
| [T-340](audit-2026-11/T-340-seo-noindex-link-probe-and-lengths.md) | SEO: noindex counts only for public visitors, the link probe skips action links, and title and description lengths are checked | M22, M24, L7 | P2 | S | 1 | todo | - |
| [T-341](audit-2026-11/T-341-aeo-geo-answer-and-schema-detection.md) | AEO reads answers in divs and details, the Organization check waits for the home page, GEO matches author classes as words | M22, L7 | P3 | S | 12 | todo | T-336 |
| [T-342](audit-2026-11/T-342-permission-matrix-validated.md) | The permission matrix is validated, and a load error is shown | M20 | P2 | S | 13 | todo | T-329 |
| [T-343](audit-2026-11/T-343-stable-rule-code-for-fingerprints.md) | Findings carry a stable rule code, and fingerprints use it | M21 | P2 | M | 2 | todo | T-340 |
| [T-344](audit-2026-11/T-344-robots-parser-keeps-groups.md) | The robots.txt reader keeps a group across blank lines and does not cache failures | L7 | P3 | S | 1 | todo | - |
| [T-345](audit-2026-11/T-345-ux-quality-wcag-names-and-one-target-size.md) | The UX check names every WCAG criterion it reports and reports a small target once | L7, L9 | P3 | S | 1 | todo | - |
| [T-346](audit-2026-11/T-346-keyboard-selectors-escaped.md) | Keyboard check selectors are CSS-escaped and built by one helper | L7 | P3 | S | 1 | todo | T-231 |
| [T-347](audit-2026-11/T-347-sri-first-party-subdomains.md) | The SRI check treats the site's own subdomains as first party | L7 | P4 | S | 1 | todo | T-234 |
| [T-348](audit-2026-11/T-348-console-errors-without-url-unknown-origin.md) | Console errors with no URL are not scored as first-party Blockers | L7 | P3 | S | 1 | todo | - |
| [T-349](audit-2026-11/T-349-marketing-heuristics-tightened.md) | Marketing checks need a real call to action and contact link, and the cookie-notice scan is bounded | L7 | P4 | S | 13 | todo | T-341 |
| [T-350](audit-2026-11/T-350-visual-diff-size-cap.md) | The visual diff checks image size before decoding | L8 | P3 | S | 1 | todo | - |
| [T-351](audit-2026-11/T-351-types-browser-entry-exports-map.md) | `@qa/types` gets an exports map with a browser entry, and the verdict input is narrowed | L9 | P4 | S | 1 | todo | - |
| [T-352](audit-2026-11/T-352-runtime-guards-for-stored-plans.md) | Stored Plans, summaries and benchmark jobs are checked when read | M28 | P2 | M | 10 | todo | T-312 |

### Runner: session, scheduler and CLI

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-353](audit-2026-11/T-353-prune-protects-parked-plans-after-restart.md) | Pruning keeps a waiting Plan's run folder after a restart | H13 | P1 | S | 1 | todo | - |
| [T-354](audit-2026-11/T-354-schedule-store-refuses-unreadable-file.md) | The schedule store refuses an unreadable file, and a scheduler tick logs its errors | H14, M33 | P1 | S | 1 | todo | - |
| [T-355](audit-2026-11/T-355-checkup-cli-handles-signals.md) | The CI check-up handles SIGINT and SIGTERM, and shutdown fits Cloud Run's grace period | M33 | P2 | S | 14 | todo | T-331 |
| [T-356](audit-2026-11/T-356-checkup-cli-strict-flags-and-redaction.md) | The CI check-up refuses bad flags and hides more secret-looking text | L10 | P3 | S | 15 | todo | T-355 |
| [T-357](audit-2026-11/T-357-event-replay-truncation-and-feed-keep.md) | Event replay says when it dropped events, and a reconnect keeps the live feed | L10, M41 | P2 | S | 14 | todo | T-331 |
| [T-358](audit-2026-11/T-358-teardown-timeout-closes-old-browser.md) | When a stopped run does not tear down in time, its browser is closed before the slot is freed | M34 | P2 | M | 15 | todo | T-355 |
| [T-359](audit-2026-11/T-359-run-storage-atomic-and-capped.md) | Run reports are written atomically, and run storage has a global cap | M35 | P2 | M | 11 | todo | T-352, T-353 |
| [T-360](audit-2026-11/T-360-invalid-run-inputs-refused-for-every-caller.md) | Invalid run inputs are refused for every caller, not dropped | M36 | P2 | S | 16 | todo | T-358 |

### Wizard and static site

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-361](audit-2026-11/T-361-landing-browser-test-timeouts.md) | The landing page browser test finds the theme button again (3 timeouts) | H12 | P1 | S | 1 | todo | - |
| [T-362](audit-2026-11/T-362-status-refresh-after-sign-in.md) | The wizard reads the runner status again after a Helper or owner signs in | H17 | P1 | S | 1 | todo | - |
| [T-363](audit-2026-11/T-363-stop-finishing-is-success.md) | "Stop and plan" and "Make a report" treat a finishing run as stopped | M42 | P2 | S | 15 | todo | T-357 |
| [T-364](audit-2026-11/T-364-unsaved-document-edits-block-navigation.md) | Unsaved Audit Document edits ask before Back or a palette jump | M43 | P2 | M | 1 | todo | - |
| [T-365](audit-2026-11/T-365-error-boundary-and-entry-catch.md) | A render error shows a message with Reload, not a blank page | M44 | P2 | S | 16 | todo | T-363 |
| [T-366](audit-2026-11/T-366-site-build-replaces-origin-placeholders.md) | The static site build replaces the `%ORIGIN%` placeholders | M45 | P2 | S | 1 | todo | - |
| [T-367](audit-2026-11/T-367-privacy-claim-and-policy.md) | The "nothing leaves your machine" claim names the AI provider, and PRIVACY.md covers sign-in and saved audits | M46 | P2 | S | 1 | todo | - |
| [T-368](audit-2026-11/T-368-shortcuts-respect-setting-and-dialogs.md) | The `?` shortcut follows the single-key setting, and j/k stop behind a dialog | L14 | P3 | S | 1 | todo | T-287 |
| [T-369](audit-2026-11/T-369-hosted-lost-contact-text-and-abort-fallback.md) | The hosted copy's lost-contact text fits the hosted copy, and the timeout works on older browsers | L14 | P3 | S | 17 | todo | T-365 |
| [T-370](audit-2026-11/T-370-robots-ai-groups-keep-disallow.md) | robots.txt AI crawler groups keep the private paths closed | L14 | P3 | S | 1 | todo | - |
| [T-371](audit-2026-11/T-371-lazy-load-plan-review-and-testing.md) | Plan Review, Testing and Scanning load on demand | L16 | P4 | S | 18 | todo | T-369 |
| [T-372](audit-2026-11/T-372-app-event-reducer-with-tests.md) | The wizard's run events go through a tested reducer | M16 | P3 | M | 19 | todo | T-371 |
| [T-373](audit-2026-11/T-373-signup-url-control-or-removal.md) | `VITE_SIGNUP_URL` either shows its email-updates control or goes away | L13 | P4 | S | 16 | todo | T-302 |

### CI, build and docs

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-374](audit-2026-11/T-374-deploy-waits-for-quality-gate-and-image-scan.md) | Deploy waits for the CI quality gate and scans the image it ships | H11 | P1 | S | 1 | todo | - |
| [T-375](audit-2026-11/T-375-deploys-queue-instead-of-cancel.md) | A new push queues behind a running deploy instead of cancelling it | M12 | P2 | S | 3 | todo | T-376 |
| [T-376](audit-2026-11/T-376-generated-workflow-pins-tool-ref-and-scopes-key.md) | The generated check-up workflow pins the tool version and gives the AI key only to the check-up step | H10 | P1 | S | 2 | todo | T-374 |
| [T-377](audit-2026-11/T-377-base-images-pinned-and-nested-dockerignore.md) | Docker base images are pinned by digest, and `.dockerignore` covers nested secrets and data | M13 | P3 | S | 3 | todo | T-272, T-277, T-376 |
| [T-378](audit-2026-11/T-378-promise-lint-rules-errors-and-warning-ratchet.md) | Promise lint rules are errors, and lint fails above the current warning count | M14 | P3 | M | 11 | todo | T-272, T-380 |
| [T-379](audit-2026-11/T-379-loopback-runner-tests-in-unit-tier-and-pr-browser-job.md) | Loopback runner tests run on every PR, and browser tests run on PRs that touch browser code | M17 | P2 | M | 9 | todo | T-308 |
| [T-380](audit-2026-11/T-380-vitest-4-upgrade.md) | Upgrade vitest to 4.x and move the workspace to `test.projects` | M18 | P2 | M | 10 | todo | T-229, T-379 |
| [T-381](audit-2026-11/T-381-gitleaks-allowlist-and-node-version-file.md) | Gitleaks allowlists only the test files that hold fake keys, and workflows read Node from `.nvmrc` | L5 | P3 | S | 4 | todo | T-375 |
| [T-382](audit-2026-11/T-382-compose-hardening.md) | docker-compose drops capabilities and limits memory | L6 | P4 | S | 17 | todo | T-373 |
| [T-383](audit-2026-11/T-383-playwright-and-node-version-check.md) | Playwright 1.65, and a Node major check | L19 | P4 | M | 17 | todo | T-373 |
| [T-384](audit-2026-11/T-384-licence-wording-and-spdx.md) | Say source-available, not open source, and give every package an SPDX licence | L1 | P4 | S | 18 | todo | T-383 |
| [T-385](audit-2026-11/T-385-security-policy-contact-and-versions.md) | SECURITY.md names a contact and the supported versions | L2 | P3 | S | 9 | todo | T-308 |
| [T-386](audit-2026-11/T-386-contributing-adr-numbering-and-defer-tests-text.md) | CONTRIBUTING drops stale ADR numbers, and CLAUDE.md says DEFER_TESTS is not enforced in a clone | L3 | P4 | S | 19 | todo | T-384 |
| [T-387](audit-2026-11/T-387-plugin-hook-documented-as-installed-code.md) | The plugin README says its hook is code that runs on every Bash call | L4 | P4 | S | 1 | todo | - |

## Open: carried over

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
## Built work

Built work is in git. Audit of November 2026, T-91 to T-224 (134 tickets, all built and verified on `d225418`): the ticket files were removed once built; read one with `git show 409a01b:docs/tickets/audit-2026-11/<file>`. Open tickets that name a T-91 to T-224 ticket do so as background only. Website Audit T-79 to T-85, T-87, T-88, T-90: `fdf287f`, `a4cb689`, `b237983`. Earlier tracks (demo readiness, review remediation, qaskills-patterns) are in earlier history. T-52 (container hardening and health): non-root runner and site images, `/healthz` health checks, `docker-compose.yml`, `docs/CONTAINER_DEPLOYMENT.md`.
