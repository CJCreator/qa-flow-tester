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

Plan: [WEBSITE-AUDIT-RELIABILITY-PLAN.md](WEBSITE-AUDIT-RELIABILITY-PLAN.md). Decisions: [ADR 0042](../adr/0042-website-audit-reliability-and-access.md), [ADR 0043](../adr/0043-parallel-page-fetching-in-the-website-audit.md).

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-86](WEBSITE-AUDIT-RELIABILITY-PLAN.md#t-86-hosted-audits-for-the-signed-in-owner) | Hosted audits for the signed-in owner | A8 | P1 | M | 4 | built | - |
| [T-89](WEBSITE-AUDIT-RELIABILITY-PLAN.md#t-89-proving-the-audit-works) | Proving the audit works | A12 | P1 | M | 4 | todo | - |

## Open: audit follow-up (November 2026)

One file per ticket under [audit-2026-11/](audit-2026-11/). Each file names the files it may edit and the tickets it must not be built beside. These 54 tickets cover what the audit left over: findings that never got a ticket, and work that built tickets deferred in their Notes.

The tickets are grouped into chains. Tickets in one chain edit the same files, so build them one after another in wave order. Different chains can be built at the same time, with two limits: T-240 also edits `packages/runner/src/routes/plan.ts`, so do not build it beside T-256, T-258 or T-260; and T-225 edits every workflow file, so build it after T-274 if both are in flight. "(owner decision)" marks a ticket written for a default the owner should confirm first.

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
| [T-271](audit-2026-11/T-271-core-drops-pngjs-and-typecheck-config-leftovers.md) | `@qa/core` stops declaring `pngjs`; clean the typecheck config | - | P4 | S | 3 | todo | T-229 |
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
| [T-260](audit-2026-11/T-260-one-add-tokens-for-ai-usage.md) | One `addTokens` for AI token use (owner decision) | - | P3 | S | 6 | todo | T-258 |
| [T-261](audit-2026-11/T-261-one-https-check-for-cookie-secure-flag.md) | One "was this visit https" check for the cookie Secure flag (owner decision) | - | P3 | S | 7 | todo | T-260 |
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
| [T-232](audit-2026-11/T-232-one-missing-title-problem-across-checks.md) | A missing page title counts as two problems (search check and accessibility scan) (owner decision) | - | P2 | S | 1 | todo | - |
| [T-249](audit-2026-11/T-249-one-severity-order-and-one-doc-source-of.md) | One severity order and one `docSourceOf` in core | - | P3 | S | 2 | todo | T-232 |
| [T-251](audit-2026-11/T-251-delete-six-unused-core-members.md) | Delete six unused members in core and types | - | P3 | M | 3 | todo | T-249 |

### Core orchestrator

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-247](audit-2026-11/T-247-source-locator-skips-the-tools-own-repository.md) | The source locator does not search the tool's own repository (owner decision) | - | P3 | S | 1 | todo | - |
| [T-252](audit-2026-11/T-252-visual-baseline-recording-is-unreachable.md) | Recording masked visual baselines is unreachable (`RunOptions.updateBaselines`) (owner decision) | - | P3 | S | 2 | todo | T-247 |

### Independent (any order, beside anything)

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-230](audit-2026-11/T-230-test-run-completed-reaches-on-event.md) | Test that the finished-run event reaches `onEvent` as the logged object | - | P3 | S | 1 | todo | - |
| [T-231](audit-2026-11/T-231-keyboard-walk-reads-the-focusable-list-once.md) | The Tab walk rebuilds the list of focusable elements on every key press | - | P3 | S | 1 | todo | - |
| [T-233](audit-2026-11/T-233-delete-unused-run-start-and-approval-replies.md) | Delete the two check-up API reply types that only a test uses | - | P3 | S | 1 | todo | - |
| [T-234](audit-2026-11/T-234-security-csrf-and-depth-checks-that-fail-say-so.md) | The CSRF check and the security-depth checks that could not run read as a pass | - | P2 | S | 1 | todo | - |
| [T-242](audit-2026-11/T-242-ux-gap-synthesizer-checks-provider-type.md) | The UX gap synthesizer checks `providerType`, not the class name | - | P3 | S | 1 | todo | - |
| [T-243](audit-2026-11/T-243-one-zip-writer.md) | One ZIP writer: the Playwright export uses `writeZip` | - | P3 | S | 1 | todo | - |
| [T-245](audit-2026-11/T-245-replan-keeps-document-items.md) | Re-planning keeps the Plan Items that came from documents (owner decision) | - | P2 | M | 1 | todo | - |
| [T-246](audit-2026-11/T-246-planning-batches-run-in-parallel.md) | Page planning batches run in parallel when the AI pacing allows | - | P3 | M | 1 | todo | - |
| [T-250](audit-2026-11/T-250-delete-account-pool-figma-sync-and-unused-namespacer-methods.md) | Delete the account pool, the Figma sync and two unused `EntityNamespacer` methods | - | P3 | S | 1 | todo | - |
| [T-272](audit-2026-11/T-272-ignore-files-list-generated-folders.md) | ESLint and Docker ignore the generated folders; `.gitignore` loses redundant lines | - | P3 | S | 1 | todo | - |
| [T-273](audit-2026-11/T-273-site-nginx-gzip-and-one-csp.md) | Site nginx compresses text files and states the CSP once | - | P3 | S | 1 | todo | - |
| [T-274](audit-2026-11/T-274-dependabot-watches-site-image.md) | Dependabot watches the site image | - | P3 | S | 1 | todo | - |
| [T-276](audit-2026-11/T-276-manual-deploy-script-matches-ci.md) | The manual deploy script allows the same origins as CI and verifies the commit (owner decision) | - | P3 | S | 1 | todo | - |
| [T-277](audit-2026-11/T-277-runner-dockerfile-single-stage-decision.md) | Record why the runner image stays single-stage (owner decision) | - | P4 | S | 1 | todo | - |
| [T-285](audit-2026-11/T-285-wizard-delete-unused-plan-translate-functions.md) | Wizard: delete four unused Plan translation functions and their tests | - | P3 | S | 1 | todo | - |
| [T-286](audit-2026-11/T-286-wizard-delete-unused-context-and-onboarding-helpers.md) | Wizard: delete `buildProductContext` and `hasNonDefaultOptions` and their tests | - | P3 | S | 1 | todo | - |
| [T-287](audit-2026-11/T-287-plan-group-switch-outside-summary.md) | Plan Review: the group "Switch off" button leaves the `<summary>` (owner decision) | - | P3 | S | 1 | todo | - |
| [T-288](audit-2026-11/T-288-favicon-and-share-image-use-current-palette.md) | Favicon and share image use the current palette (owner decision) | - | P4 | S | 1 | todo | - |

## Open: carried over

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| T-23 | Split large files by area | G35 | P3 | L | 19 | later | - |
| QSP-009 | Wizard smoke option (qaskills-patterns F3) | - | - | - | - | later | - |

- **T-23:** later. Partly done: the plan, schedule, Website Audit and health routes live under `packages/runner/src/routes/`. `packages/runner/src/server.ts` is still about 4,100 lines and keeps the inline endpoints listed in `docs/API.md`. Splitting the rest is not scheduled.

## Built work

Built work is in git. Audit of November 2026, T-91 to T-224 (134 tickets, all built and verified on `d225418`): the ticket files stay under [audit-2026-11/](audit-2026-11/). Website Audit T-79 to T-85, T-87, T-88, T-90: `fdf287f`, `a4cb689`, `b237983`. Earlier tracks (demo readiness, review remediation, qaskills-patterns) are in earlier history. T-52 (container hardening and health): non-root runner and site images, `/healthz` health checks, `docker-compose.yml`, `docs/CONTAINER_DEPLOYMENT.md`.
