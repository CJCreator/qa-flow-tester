# T-213: Unit tier rule says what is true: no Chromium, no external network

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | inconsistency | todo |

**Files you may edit (no others):**
- `docs/TESTING.md`
- `vitest.workspace.ts` (the header comment only)

**Do not build in parallel with:** T-214 (also edits `docs/TESTING.md`).

## Problem
`docs/TESTING.md` and the comment in `vitest.workspace.ts` say a `unit` test starts "no runner server". The
files disagree. These `unit` files start a `RunnerServer` on a loopback port: `ai-gemini-models`,
`audit-run-recovery`, `health-route`, `helper-wizard-access`, `schedule-routes`, `schedule-tick-beta-extra`,
`scheduler-store`, `session-cleanup-route`, `status-and-run-events` (all in `packages/runner/tests`). Several
core `unit` files use an `http.createServer` stub on `127.0.0.1` (`access-control`, `preflight-result-truth`,
`api-spec-checks`, `docs-fetch`, `guarded-fetch`, `outbound-fetch`, `post-deploy-smoke`, `robots`).

Owner decision (2026-11-10): reword the rule, do not move the files. Unit tests may use loopback servers on an
OS-assigned port. The rule becomes "no Chromium, no external network".

## Current code
`docs/TESTING.md:9-14` (branch `worktree-audit-cleanup`)
```markdown
| Tier      | Command             | Runs                                                                                     | Needs    | Where                                                                     |
| --------- | ------------------- | ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `unit`    | `pnpm test`         | No browser, no runner server, no website: fake pages, in-memory inputs                   | Node     | Pull requests (`ci.yml`, 2 shards), `deploy.yml` before publishing, local |
| `browser` | `pnpm test:browser` | Chromium on `setContent` or `route().fulfill()` pages, or a started runner; never a site | Chromium | Nightly (`e2e-nightly.yml`, 4 shards), local                              |

`pnpm test:all` runs both. A file is `browser` only if the `BROWSER_TESTS` list in `vitest.workspace.ts` names it; every other file is `unit`. Add a file to that list when it launches Chromium or a runner.
```

`docs/TESTING.md:22`
```markdown
No fixture site, no inline `http.createServer` page to crawl. Do not add one ([ADR 0040](adr/0040-test-tiers-no-fabricated-websites.md)). Use:
```

`vitest.workspace.ts:4-10`
```ts
// Two tiers. Every test file belongs to exactly one project.
//   unit    : no browser, no runner server. `pnpm test` and PR CI run only this.
//   browser : launches Chromium (directly, or through the Spider, a discovery agent or the orchestrator) or starts
//             a runner (a RunnerServer, or the runner's CLI). `pnpm test:browser`; nightly only, never on PRs.
// `pnpm test:all` runs both. Checked on 2026-11-03 by running `--project unit` with PLAYWRIGHT_BROWSERS_PATH
// set to an empty folder: no unit file tried to launch Chromium.
// A new test file lands in `unit` by default. Add it here when it launches Chromium or a runner.
```

## Change
1. `docs/TESTING.md`, in the Tiers table, replace the text of the **Runs** cell of the two rows (keep the other
   cells; let prettier re-align the columns):
   - `unit`: `No Chromium, no external network: fake pages, in-memory inputs. A loopback server on an OS-assigned port is allowed`
   - `browser`: `Chromium on `setContent` or `route().fulfill()` pages, alone or through a started runner; never a site`
2. `docs/TESTING.md`, in the paragraph under the table, replace the last sentence
   `Add a file to that list when it launches Chromium or a runner.` with:
   ```markdown
   Add a file to that list when it launches Chromium. A unit test may start a `RunnerServer` or an `http.createServer` stub on `127.0.0.1`, on a port the OS picks (`packages/runner/tests/helpers/free-port.ts`, or `listen(0)`), never on a fixed port.
   ```
3. `docs/TESTING.md:22`, replace the line with:
   ```markdown
   No fixture site, no inline `http.createServer` page to crawl. Do not add one ([ADR 0040](adr/0040-test-tiers-no-fabricated-websites.md)). A loopback stub that answers one fetch-level check, with no Chromium and no crawl, is not a fabricated website. Use:
   ```
4. `vitest.workspace.ts`, replace lines 4-10 with exactly:
   ```ts
   // Two tiers. Every test file belongs to exactly one project.
   //   unit    : no Chromium, no external network. A loopback server on a port the OS picks is allowed (a
   //             RunnerServer, or an http.createServer stub). `pnpm test` and PR CI run only this.
   //   browser : launches Chromium (directly, or through the Spider, a discovery agent, the orchestrator or the
   //             runner's CLI). `pnpm test:browser`; nightly only, never on PRs.
   // `pnpm test:all` runs both. Checked on 2026-11-03 by running `--project unit` with PLAYWRIGHT_BROWSERS_PATH
   // set to an empty folder: no unit file tried to launch Chromium.
   // A new test file lands in `unit` by default. Add it here when it launches Chromium.
   ```
5. Do not change the `BROWSER_TESTS` list or any other code in `vitest.workspace.ts`.

## Tests
```
pnpm exec prettier --write docs/TESTING.md vitest.workspace.ts
pnpm format:check
pnpm lint
pnpm exec vitest run packages/runner/tests/config-docs.test.ts
```
This grep must print nothing:
```
grep -n "no runner server\|or a runner\." docs/TESTING.md vitest.workspace.ts
```

## Done when
- [ ] Neither file says a unit test starts "no runner server".
- [ ] Both files say: no Chromium, no external network, loopback server on an OS-picked port allowed.
- [ ] `BROWSER_TESTS` is unchanged (`git diff vitest.workspace.ts` shows comment lines only).
- [ ] `pnpm format:check` passes.

## Notes
- `packages/runner/tests/helpers/free-port.ts` is created by T-206. The sentence in step 2 names it either way;
  if T-206 is not built yet, leave the sentence as written.
- Do not edit ADR 0040 (an accepted record). The decision above is recorded in this ticket.
- Fixed-port fixes are T-206 and T-207, not this ticket.
