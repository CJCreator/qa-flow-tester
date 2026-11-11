# T-336: Tests for the DiscoveryAgent helpers and the orchestrator's stop and retry paths

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | core | test-gap | todo |

**Files you may edit (no others):**

- `packages/core/tests/discovery-agent-helpers.test.ts` (new)
- `packages/core/tests/orchestrator-run-paths.test.ts` (new)
- `vitest.workspace.ts`

**Do not build in parallel with:** T-308, T-341, T-349, T-379, T-380 (all edit `vitest.workspace.ts`).

## Problem

The two most important files in `core` have almost no unit coverage (local run, 11 Nov 2026). `packages/core/src/discovery/discovery-agent.ts` shows 1.6 percent of lines: no test imports it, although two of its helpers are exported and pure enough to test (`mergeCrawls`, line 167, and `restoreSession`, line 302). `packages/core/src/orchestrator.ts` shows 28 percent: only `orchestrator-teardown.test.ts` and `orchestrator-access-wiring.test.ts` touch it. `runChecks` (line 352 to about 1692) holds the paths where a mistake costs the most and nothing covers them: Stop (`options.signal`, ~498), "Make a report" (`options.finishSignal`, ~649 and ~1515), the clean retry of a flaky test (~1026), the refusal to retry after a form was sent (~1027-1046, `SendGuard`), video keeping (`removeVideosExcept`, ~706 and ~1452) and the sign-in again after a session expired (~794).

## Current code

Branch from `main`.

`grep -n "^export function mergeCrawls\|^export async function restoreSession" packages/core/src/discovery/discovery-agent.ts`. `grep -n "sentAny\|maxRetries" packages/core/src/orchestrator.ts` finds the retry decision. `grep -rn "lookAtNarrowScreens" packages/core/tests` and `grep -rln "discovery-agent" packages/core/tests` find nothing today.

`vitest.workspace.ts` has the list `BROWSER_TESTS` (`core: ['browser-guard', 'browser-restart', ...]`). A file that launches Chromium must be named there; the others run in the `unit` project.

## Change

No source file changes. Test code only, plus the browser list entry.

1. New `packages/core/tests/discovery-agent-helpers.test.ts` (unit tier, no browser).
2. New `packages/core/tests/orchestrator-run-paths.test.ts` (browser tier: it launches Chromium).
3. `vitest.workspace.ts`: add `'orchestrator-run-paths'` to the `core` list in `BROWSER_TESTS`.
4. Run `pnpm exec prettier --write` on the new files.

## Tests

`packages/core/tests/discovery-agent-helpers.test.ts` (unit, plain objects as `SpiderResult` values):

- `mergeCrawls`: the visitor crawl and a role crawl that reach the same path give one page with `reachedBy: ['visitor', 'admin']` and the role's elements; a link seen by both has `seenBy` of both and keeps the first `landsOn`; a role's `landsOn` is stored in `landsOnBy` under that role; a sign-in wall reached by a role is not listed in `signInWalls`; forms and sensitive actions with the same key are listed once; ambiguity questions are renumbered `Q-001`, `Q-002`.
- `restoreSession` with a fake context (`clearCookies`, `addCookies`, `addInitScript`, `pages()` returning one fake page with `evaluate`): cookies are cleared then added; an origin with `localStorage` entries gets one init script and one `evaluate` on each open page; an origin with no entries is skipped; an `evaluate` that rejects does not throw; nothing is logged (spy on `console`).

`packages/core/tests/orchestrator-run-paths.test.ts` (browser tier; follow `orchestrator-teardown.test.ts`): spy on `BrowserManager.prototype.createContext` so every context is a real Chromium context with `context.route('**/*', ...)` answering the target's pages from strings (the `route()` style ADR 0040 allows; no server and no fixture site). Cases, each with `specTestCases` of one or two small tests:

- Stop: abort `options.signal` after the first test starts; `run` ends, the report has no unrun test marked as passed, and `BrowserManager.prototype.close` was called.
- Make a report: abort `options.finishSignal` after the first test; the report is `partial` and keeps the first test's result.
- Flaky: a test whose first attempt fails and second passes is reported as flaky, not failed (`flakyReruns: 1`).
- Sent form: a test that sends a form (route sees a `POST`) and then fails is not retried; the route saw exactly one `POST`.
- Video: with `recordVideo: true` a passing test leaves no `.webm` in its evidence folder; a failing one keeps one.
- Re-login: a test that ends because the Role was signed out signs in again once and is not counted as flaky (spy on `restoreSession`'s caller or the sign-in function; if the setup is too heavy for one case, write the first five and list this one as a follow-up in Notes).

Run: `pnpm exec vitest run packages/core/tests/discovery-agent-helpers.test.ts`, then `pnpm exec vitest run --project browser packages/core/tests/orchestrator-run-paths.test.ts` (needs Chromium; it runs nightly, not on pull requests), then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "orchestrator-run-paths" vitest.workspace.ts` finds the browser entry.
- [ ] `grep -rln "mergeCrawls" packages/core/tests` finds the new unit test.
- [ ] The new tests pass; the unit project does not launch Chromium; `pnpm build` passes.

## Notes

- Audit finding M16, core part (audit of 11 Nov 2026 on `d225418`). The wizard part is T-372.
- Do not add a fixture site or an `http.createServer` page for the orchestrator tests (`docs/adr/0040-test-tiers-no-fabricated-websites.md`, `docs/TESTING.md`).
- If a test finds a real defect, do not fix it here: write a short note in the pull request and open a ticket.
- Related open tickets: T-252 (removes baseline recording in `orchestrator.ts`; these tests do not touch baselines), T-247.
