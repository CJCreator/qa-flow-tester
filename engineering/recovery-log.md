# Recovery log

> **Append-only.** Entries are written by `aieos recovery` and `aieos check run` when a check linked to an
> open recovery item is re-run. At most 3 correction attempts per failure. The third failed attempt marks
> the item, its task and the workflow `BLOCKED` until a developer intervenes.

## Open items

<!-- ai-eos:begin open -->
| ID | Status | Check | Category | Tasks | Responsible | Attempts | Last evidence |
|---|---|---|---|---|---|---|---|
| REC-003 | OPEN | CHK-BROWSER | integration | — | — | 0/3 | EV-0006 |
| REC-017 | OPEN | CHK-BROWSER-2 | flaky | QA-713 | qa-engineer | 0/3 | EV-0376 |
<!-- ai-eos:end open -->

## Log

### REC-001 · opened · 2026-11-03T05:54:36.247Z
- Check: CHK-UNIT (unit) · Category: test
- Tasks: — · Requirements: — · Responsible: orchestrator
- Failing evidence: EV-0005 (exit code 1; Test Files  1 failed | 150 passed (151))
- Attempt budget: 3
- Failure excerpt:

```text
, collect 172.71s, tests 88.73s, environment 99ms, prepare 103.66s)


stderr | packages/core/tests/complete-plan.test.ts > PacedAI > asks for fewer, shorter journeys when the answer is cut off, instead of repeating the same request
[JourneyPlanner] The answer was cut off; asking for fewer, shorter journeys...

stderr | packages/core/tests/ai-provider.test.ts > AIProvider and KeyResolver > should fall back to the local key file when no keychain is available
[KeyResolver] OS keychain unavailable (no secret service); storing the key encrypted in C:\Users\HP\OneDrive\Desktop\Projects\AntiGravity - Google - Projects\QA Tool\.tmp-ai-keys-test\.qa-keys.json.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |unit|  packages/runner/tests/config-docs.test.ts > .env.example lists every variable the code reads > each name the code reads appears in .env.example exactly once
AssertionError: read in code but not in .env.example: expected [ 'XDG_CONFIG_HOME' ] to deeply equal []

- Expected
+ Received

- Array []
+ Array [
+   "XDG_CONFIG_HOME",
+ ]

 ❯ packages/runner/tests/config-docs.test.ts:81:61
     79|     expect(reads.size).toBeGreaterThan(30);
     80|     const missing = [...reads.keys()].filter((name) => !counts.has(nam…
     81|     expect(missing, 'read in code but not in .env.example').toEqual([]…
       |                                                             ^
     82| 
     83|     const repeated = [...counts].filter(([, n]) => n !== 1).map(([name…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

### REC-002 · opened · 2026-11-03T05:54:43.158Z
- Check: CHK-TYPECHECK (typecheck) · Category: type
- Tasks: — · Requirements: — · Responsible: orchestrator
- Failing evidence: EV-0003 (exit code 2; [ELIFECYCLE] Command failed with exit code 2. · $ tsc -p tsconfig.test.json --noEmit)
- Attempt budget: 3
- Failure excerpt:

```text
 TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/lib/summary.js'?
packages/wizard/tests/wizard-e2e.test.ts(85,31): error TS2488: Type 'NodeListOf<HTMLDetailsElement>' must have a '[Symbol.iterator]()' method that returns an iterator.
packages/wizard/tests/wizard-e2e.test.ts(170,27): error TS2488: Type 'NodeListOf<HTMLImageElement>' must have a '[Symbol.iterator]()' method that returns an iterator.
packages/wizard/tests/wizard-e2e.test.ts(622,47): error TS18046: 'g' is of type 'unknown'.
packages/wizard/tests/wizard-e2e.test.ts(626,70): error TS2339: Property 'title' does not exist on type '{}'.
packages/wizard/tests/wizard-e2e.test.ts(628,59): error TS2339: Property 'title' does not exist on type '{}'.
packages/wizard/tests/wizard-e2e.test.ts(638,40): error TS2339: Property 'title' does not exist on type '{}'.
packages/wizard/tests/workflow.test.ts(4,39): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/lib/workflow.js'?
scripts/benchmark.ts(155,29): error TS7016: Could not find a declaration file for module '../fixtures/test-app/server.js'. 'C:/Users/HP/OneDrive/Desktop/Projects/AntiGravity - Google - Projects/QA Tool/fixtures/test-app/server.js' implicitly has an 'any' type.
[ELIFECYCLE] Command failed with exit code 2.

$ tsc -p tsconfig.test.json --noEmit
```

### REC-003 · opened · 2026-11-03T05:58:19.924Z
- Check: CHK-BROWSER (integration) · Category: integration
- Tasks: — · Requirements: — · Responsible: orchestrator
- Failing evidence: EV-0006 (timed out; stderr | packages/core/tests/discovery-agent-fill-value.test.ts > DiscoveryAgent fill-step value handling > retries with a repair prompt and uses the repaired value when the AI supplies one on retry · [JourneyPlanner] AI response needs repair (Flow "FLOW-LOGIN" step "Fill Email" has action "fill" but no non-empty "value".); retrying with a repair prompt...)
- Attempt budget: 3
- Failure excerpt:

```text
a.test.ts > Docs address > a public-looking site does not read a private docs address; the run goes on with a note
[DiscoveryAgent] Crawling routes and interactive forms on http://localhost:3724/...

stdout | packages/core/tests/discovery-agent-fill-value.test.ts > DiscoveryAgent fill-step value handling > retries with a repair prompt and uses the repaired value when the AI supplies one on retry
[DiscoveryAgent] Spider found 11 pages, 3 forms, 0 sensitive actions.

stdout | packages/core/tests/discovery-agent-fill-value.test.ts > DiscoveryAgent fill-step value handling > retries with a repair prompt and uses the repaired value when the AI supplies one on retry
[DiscoveryAgent] Discovery draft saved to C:\Users\HP\OneDrive\Desktop\Projects\AntiGravity - Google - Projects\QA Tool\.tmp-discovery-fill-value\repaired\discovery-draft.json

stdout | packages/core/tests/discovery-agent-fill-value.test.ts > DiscoveryAgent fill-step value handling > backfills a heuristic placeholder rather than leaving a fill step blank when the repair also omits value
[DiscoveryAgent] Crawling routes and interactive forms on http://localhost:3096...


stderr | packages/core/tests/discovery-agent-fill-value.test.ts > DiscoveryAgent fill-step value handling > retries with a repair prompt and uses the repaired value when the AI supplies one on retry
[JourneyPlanner] AI response needs repair (Flow "FLOW-LOGIN" step "Fill Email" has action "fill" but no non-empty "value".); retrying with a repair prompt...
```

### REC-004 · opened · 2026-11-03T07:40:48.493Z
- Check: CHK-BE-101-SPIDER (integration) · Category: test
- Tasks: BE-101 · Requirements: REQ-047 · Responsible: backend-engineer
- Failing evidence: EV-0042 (exit code 1; Test Files  1 failed | 2 passed (3))
- Attempt budget: 3
- Failure excerpt:

```text
 target pages are found via data-href and click exploration 27737ms
   ✓ DeterministicSpider link discovery and trap protection (T-112) > a page with a fixed cookie banner (/lab/overlay) is crawled and its links are found 21428ms
   ✓ DeterministicSpider link discovery and trap protection (T-112) > in-test server with /sitemap.xml listing unlinked /hidden page: crawled when seeded, skipped when seedSitemap: false 10608ms
   × DeterministicSpider link discovery and trap protection (T-112) > maxDurationMs: 2000 against /lab/trap/1 ends in about 2s with a time-limit skip entry 8655ms
     → expected 8630 to be less than 8000

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 14 passed (15)
   Start at  13:07:00
   Duration  213.16s (transform 2.32s, setup 0ms, collect 12.21s, tests 319.89s, environment 2ms, prepare 1.34s)


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |browser|  packages/core/tests/spider-links-and-traps.test.ts > DeterministicSpider link discovery and trap protection (T-112) > maxDurationMs: 2000 against /lab/trap/1 ends in about 2s with a time-limit skip entry
AssertionError: expected 8630 to be less than 8000
 ❯ packages/core/tests/spider-links-and-traps.test.ts:195:23
    193|       });
    194|       const elapsed = Date.now() - start;
    195|       expect(elapsed).toBeLessThan(8000);
       |                       ^
    196|       expect((res.skipped || []).some((s) => s.why === 'time-limit')).…
    197|     } finally {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

#### REC-004 · analysis · 2026-11-03T07:41:16.663Z
- Root cause: Spider overruns maxDurationMs: with a 2000 ms limit the crawl of /lab/trap/1 returns after ~8.6 s on a quiet machine (EV-0042), so the deadline is only checked between pages and in-flight work (navigation/settle/close) is not bounded by the remaining budget. Not shown to be caused by BE-101's sitemap change (agent measured 9.4-9.9 s with seeding off).
- Correction: In deterministic-spider.ts (BE-101 ownership): bound every step after the deadline is near (navigation timeout, settle waits, sitemap/robots outbound fetch timeouts) by the remaining maxDurationMs budget so crawl returns within ~maxDurationMs + small overhead; keep the time-limit skip entry. Test unchanged.

#### REC-004 · attempt 1/3 · PASS · EV-0048 · 2026-11-03T07:58:43.307Z
- Result: exit code 0; Test Files  3 passed (3)

#### REC-004 · RESOLVED · 2026-11-03T07:58:43.307Z
- Re-run related regression checks before completing (aieos gate lists them).

### REC-005 · opened · 2026-11-03T09:52:20.974Z
- Check: CHK-FE-500-UNIT (unit) · Category: environment
- Tasks: FE-500 · Requirements: REQ-020 · Responsible: frontend-engineer
- Failing evidence: EV-0071 (exit code 1; ------^ · For help, run: pnpm help exec)
- Attempt budget: 3
- Failure excerpt:

```text
[ERROR] unexpected end of the stream within a single quoted scalar (12:1)

  9 | overrides:
 10 |   playwright: '1.63.0'
 11 |   playwright-core: '1.63.0
 12 | 
------^
For help, run: pnpm help exec
```

### REC-006 · opened · 2026-11-03T09:52:21.466Z
- Check: CHK-BE-103-SERVER (integration) · Category: environment
- Tasks: BE-103 · Requirements: REQ-049 · Responsible: backend-engineer
- Failing evidence: EV-0072 (exit code 1; ------^ · For help, run: pnpm help exec)
- Attempt budget: 3
- Failure excerpt:

```text
[ERROR] unexpected end of the stream within a single quoted scalar (12:1)

  9 | overrides:
 10 |   playwright: '1.63.0'
 11 |   playwright-core: '1.63.0
 12 | 
------^
For help, run: pnpm help exec
```

#### REC-005 · attempt 1/3 · PASS · EV-0073 · 2026-11-03T10:00:18.778Z
- Result: exit code 0; Test Files  1 passed (1)

#### REC-005 · RESOLVED · 2026-11-03T10:00:18.778Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-006 · attempt 1/3 · FAIL · EV-0074 · 2026-11-03T10:07:51.247Z
- Result: exit code 1; Test Files  1 failed | 2 passed (3)

#### REC-006 · analysis · 2026-11-03T10:08:28.065Z
- Root cause: pnpm fixed; remaining failure is runner-server.test.ts 'keeps sign-in details out of the saved plan…' stuck in 'scanning' (expected awaiting-review, 46s) — the known runner-server browser failure that QA-706 owns (diagnose and fix runner-server and url-first browser failures)
- Correction: Wait for QA-706's fix, then re-run CHK-BE-103-SERVER

### REC-007 · opened · 2026-11-03T11:57:05.063Z
- Check: CHK-BE-104-CHECKERS (integration) · Category: test
- Tasks: BE-104 · Requirements: REQ-047 · Responsible: backend-engineer
- Failing evidence: EV-0150 (exit code 1; Test Files  1 failed | 2 passed (3))
- Attempt budget: 3
- Failure excerpt:

```text
/core/tests/orchestrator-access-wiring.test.ts > orchestrator runs the access checks (ADR 0030) > finds a page that opens signed out and one that leaks another role name
[QA Orchestrator] Reports generated: report.md and findings.json

 ❯ |browser| packages/core/tests/orchestrator-access-wiring.test.ts (1 test | 1 failed) 221ms
   × orchestrator runs the access checks (ADR 0030) > finds a page that opens signed out and one that leaks another role name 173ms
     → expected false to be true // Object.is equality

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 40 passed (41)
   Start at  17:24:21
   Duration  9.88s (transform 5.35s, setup 0ms, collect 9.36s, tests 313ms, environment 1ms, prepare 2.17s)


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |browser|  packages/core/tests/orchestrator-access-wiring.test.ts > orchestrator runs the access checks (ADR 0030) > finds a page that opens signed out and one that leaks another role name
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ packages/core/tests/orchestrator-access-wiring.test.ts:75:90
     73|     });
     74| 
     75|     expect(requests.some((r) => r.state === 'signed-out' && r.url.ends…
       |                                                                                          ^
     76|     const ids = report.findings.map((f) => f.id);
     77|     expect(ids.some((i) => i.startsWith('F-ACCESS-OPEN-'))).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

#### REC-007 · analysis · 2026-11-03T11:57:11.744Z
- Root cause: orchestrator-access-wiring.test.ts:75 stubs context.request.get, but BE-101 moved contextFetcher (access-control.ts:182-197) onto makeOutboundFetch with injectable NetDeps; the stub is never called, so the access checks see no response. Test outdated, not a product bug. The test file is owned by no plan task.
- Correction: Plan change: add packages/core/tests/orchestrator-access-wiring.test.ts to BE-104 ownership (autopilot replan), then BE-104 updates the test to inject fake NetDeps (or stub makeOutboundFetch) instead of context.request.get, keeping both assertions.

#### autopilot re-plan of BE-104 (1/1) · 2026-11-03T11:57:18.205Z
- Reason: REC-007: CHK-BE-104-CHECKERS needs packages/core/tests/orchestrator-access-wiring.test.ts, which no task owns; add it to BE-104 ownership
- Items: —. Re-submit with `aieos plan check --submit`.

#### REC-007 · attempt 1/3 · PASS · EV-0151 · 2026-11-03T12:00:39.230Z
- Result: exit code 0; Test Files  3 passed (3)

#### REC-007 · RESOLVED · 2026-11-03T12:00:39.230Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-006 · attempt 2/3 · PASS · EV-0160 · 2026-11-03T12:12:53.989Z
- Result: exit code 0; Test Files  3 passed (3)

#### REC-006 · RESOLVED · 2026-11-03T12:12:53.989Z
- Re-run related regression checks before completing (aieos gate lists them).

### REC-008 · opened · 2026-11-03T12:43:35.115Z
- Check: CHK-BE-102-SERVER (integration) · Category: flaky
- Tasks: BE-102 · Requirements: REQ-048 · Responsible: backend-engineer
- Failing evidence: EV-0179 (exit code 1; Test Files  1 failed | 3 passed (4))
- Attempt budget: 3
- Failure excerpt:

```text
vity - Google - Projects/QA Tool

stdout | packages/runner/tests/beta.test.ts > beta limits: a runner that is not a beta > beta limits: a runner that is not a beta is never limited
[QA Orchestrator] Running Pre-flight health check on http://127.0.0.1:9/...

 ❯ |browser| packages/runner/tests/beta.test.ts (24 tests | 1 failed) 506ms
   × beta limits: a runner that is not a beta > beta limits: a runner that is not a beta is never limited 57ms
     → ENOTEMPTY: directory not empty, rmdir 'C:\Users\HP\OneDrive\Desktop\Projects\AntiGravity - Google - Projects\QA Tool\.tmp-beta\plain-report'
 ✓ |unit| packages/runner/tests/route-access-server.test.ts (18 tests) 247ms
 ✓ |browser| packages/runner/tests/route-inventory.test.ts (66 tests) 5271ms
   ✓ route inventory (T-203) > 'POST' '/api/runner/ai-estimate' is matched (not the generic 404) 713ms
 ✓ |browser| packages/runner/tests/access-token.test.ts (6 tests) 54ms

 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 113 passed (114)
   Start at  18:13:05
   Duration  20.88s (transform 12.94s, setup 0ms, collect 37.39s, tests 6.08s, environment 4ms, prepare 2.73s)


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |browser|  packages/runner/tests/beta.test.ts > beta limits: a runner that is not a beta > beta limits: a runner that is not a beta is never limited
Error: ENOTEMPTY: directory not empty, rmdir 'C:\Users\HP\OneDrive\Desktop\Projects\AntiGravity - Google - Projects\QA Tool\.tmp-beta\plain-report'
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

#### REC-008 · analysis · 2026-11-03T12:43:46.185Z
- Root cause: beta.test.ts 'a runner that is not a beta is never limited' passes its assertions but its finally-cleanup fs.rm/rmdir of .tmp-beta/plain-report throws ENOTEMPTY on Windows when run together with other files (file-handle/race). Passes alone. Test-only defect; the file is owned by no plan task.
- Correction: Plan change: add packages/runner/tests/beta.test.ts to BE-102 ownership; make the cleanup use fs.rm({recursive,force,maxRetries,retryDelay}) without weakening assertions.

#### autopilot re-plan of BE-102 (1/1) · 2026-11-03T12:43:46.369Z
- Reason: REC-008: CHK-BE-102-SERVER needs packages/runner/tests/beta.test.ts (cleanup race), owned by no task
- Items: —. Re-submit with `aieos plan check --submit`.

#### autopilot re-plan of QA-703 (1/1) · 2026-11-03T12:43:46.744Z
- Reason: QA-703 blocked: packages/wizard/tests/signin-form.test.ts type errors (planId) are owned by no task
- Items: —. Re-submit with `aieos plan check --submit`.

#### REC-008 · attempt 1/3 · PASS · EV-0182 · 2026-11-03T12:49:30.379Z
- Result: exit code 0; Test Files  4 passed (4)

#### REC-008 · RESOLVED · 2026-11-03T12:49:30.379Z
- Re-run related regression checks before completing (aieos gate lists them).

#### autopilot re-plan of BE-190 (1/1) · 2026-11-03T17:02:59.858Z
- Reason: BE-190 partial: AUDIT_API.content and AUDIT_API.file have no route implementation and no owner (REQ-048 AC-2 fails); production RunnerServer (cli.ts) never receives helperAccess and routes/index.ts reads private server members. Add BE-611 (content/file routes) and BE-612 (server/cli wiring with public accessors); BE-190 then depends on both.
- Items: —. Re-submit with `aieos plan check --submit`.

#### autopilot re-plan of QA-712 (1/1) · 2026-11-03T18:55:47.901Z
- Reason: QA-712 found three wizard features not built (start-screen document-language choice, phone-layout view on results, Hindi/beta languages on the export screen). Developer chose to defer them to a follow-up (DEC-013): QA-712 narrows to the two passing Tamil tests.
- Items: —. Re-submit with `aieos plan check --submit`.

### REC-009 · opened · 2026-11-04T03:38:09.424Z
- Check: CHK-QA-712-WIZARD-LANG (e2e) · Category: flaky
- Tasks: QA-712 · Requirements: REQ-044 · Responsible: qa-engineer
- Failing evidence: EV-0235 (exit code 1; Test Files  1 failed (1))
- Attempt budget: 3
- Failure excerpt:

```text
RUN  v2.1.9 C:/Users/HP/OneDrive/Desktop/Projects/AntiGravity - Google - Projects/QA Tool

 ❯ |unit| packages/wizard/tests/audit-languages-browser.test.ts (2 tests) 91427ms
   ✓ Website Audit screens: Tamil content and export (browser) > results show the /ta Page Content unchanged, inside an element with lang="ta" 1567ms
   ✓ Website Audit screens: Tamil content and export (browser) > the documents screen > exporting in Tamil downloads documents whose headings come from the Tamil table 1587ms

 Test Files  1 failed (1)
      Tests  2 passed (2)
   Start at  09:04:37
   Duration  107.31s (transform 6.39s, setup 0ms, collect 12.91s, tests 91.43s, environment 1ms, prepare 504ms)


⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |unit|  packages/wizard/tests/audit-languages-browser.test.ts > Website Audit screens: Tamil content and export (browser)
Error: Hook timed out in 30000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

#### REC-009 · analysis · 2026-11-04T03:38:33.897Z
- Root cause: beforeAll (wizard build, server start, fixture audit) exceeded the default 30 s hook timeout under load from about 60 parallel checks (EV-0235); the file passes alone (2/2).
- Correction: QA-712 sets an explicit beforeAll timeout with a comment giving the reason; no assertion change; re-run on a quieter tree.

### REC-010 · opened · 2026-11-04T04:24:56.358Z
- Check: CHK-LINT (lint) · Category: lint
- Tasks: — · Requirements: — · Responsible: orchestrator
- Failing evidence: EV-0236 (exit code 1; [ELIFECYCLE] Command failed with exit code 1. · $ eslint .)
- Attempt budget: 3
- Failure excerpt:

```text
SettingsScreen.tsx
  258:16  warning  Promise-returning function provided to attribute where a void return was expected  @typescript-eslint/no-misused-promises
  779:24  warning  Promise-returning function provided to attribute where a void return was expected  @typescript-eslint/no-misused-promises
  805:63  warning  Unexpected any. Specify a different type                                           @typescript-eslint/no-explicit-any
  863:62  warning  Unexpected any. Specify a different type                                           @typescript-eslint/no-explicit-any
  998:16  warning  Promise-returning function provided to attribute where a void return was expected  @typescript-eslint/no-misused-promises

C:\Users\HP\OneDrive\Desktop\Projects\AntiGravity - Google - Projects\QA Tool\scripts\deploy-cloud-run.mjs
  3:10  warning  'readFileSync' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  3:24  warning  'existsSync' is defined but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars

C:\Users\HP\OneDrive\Desktop\Projects\AntiGravity - Google - Projects\QA Tool\scripts\tunnel.mjs
  136:22  warning  Unexpected control character(s) in regular expression: \x1b, \x1b, \x07  no-control-regex
  148:19  warning  Unexpected control character(s) in regular expression: \x1b              no-control-regex

✖ 220 problems (1 error, 219 warnings)

[ELIFECYCLE] Command failed with exit code 1.

$ eslint .
```

#### REC-010 · analysis · 2026-11-04T04:25:30.987Z
- Root cause: prefer-const error in packages/runner/tests/audit-persistence-integration.test.ts:374: 'server' is declared with let and assigned once, but the helper-access closure reads it before that assignment, so const is impossible
- Correction: lint-only: eslint-disable-next-line prefer-const with the reason; no behaviour change (orchestrator, file owned by VERIFIED QA-600, no running task holds it)

### REC-011 · opened · 2026-11-04T04:26:20.069Z
- Check: CHK-BE-103-SERVER (integration) · Category: flaky
- Tasks: BE-103 · Requirements: REQ-049 · Responsible: backend-engineer
- Failing evidence: EV-0239 (timed out; [QA Orchestrator] Pre-flight check PASSED. · [QA Orchestrator] Executing PAGE-001 ("page-visit") on 375px as visitor...)
- Attempt budget: 3
- Failure excerpt:

```text
cal\Temp\qa-test-runner-server-W77Ypv\report\runs\run-1793763787709...

stdout | packages/runner/tests/runner-server.test.ts > RunnerServer > keeps sign-in details out of the saved plan, and asks for them again after a restart
[QA Orchestrator] Reports generated: report.md and findings.json

stdout | packages/runner/tests/runner-server.test.ts > RunnerServer > runs straight through to completion when skipReview: true is provided
[DiscoveryAgent] Crawling routes and interactive forms on http://localhost:60981...

stdout | packages/runner/tests/runner-server.test.ts > RunnerServer > runs straight through to completion when skipReview: true is provided
[DiscoveryAgent] Spider found 10 pages, 3 forms, 0 sensitive actions.

stdout | packages/runner/tests/runner-server.test.ts > RunnerServer > runs straight through to completion when skipReview: true is provided
[DiscoveryAgent] Discovery draft saved to C:\Users\HP\AppData\Local\Temp\qa-test-runner-server-W77Ypv\report\runs\run-1793764224098\discovery-draft.json

stdout | packages/runner/tests/runner-server.test.ts > RunnerServer > runs straight through to completion when skipReview: true is provided
[QA Orchestrator] Running Pre-flight health check on http://localhost:60981...

stdout | packages/runner/tests/runner-server.test.ts > RunnerServer > runs straight through to completion when skipReview: true is provided
[QA Orchestrator] Pre-flight check PASSED.
[QA Orchestrator] Executing PAGE-001 ("page-visit") on 375px as visitor...
```

### REC-012 · opened · 2026-11-04T04:26:21.789Z
- Check: CHK-BE-105-SPIDER (integration) · Category: flaky
- Tasks: BE-105 · Requirements: REQ-034, REQ-035 · Responsible: backend-engineer
- Failing evidence: EV-0243 (exit code 1; Test Files  2 failed | 1 passed (3))
- Attempt budget: 3
- Failure excerpt:

```text
disallowed path alone, and reports it 13611ms
   ✓ DeterministicSpider honours robots.txt (T-304) > records the same path when there is no policy 28546ms
   ✓ DeterministicSpider honours robots.txt (T-304) > lets a longer Allow beat Disallow 17977ms
   ✓ DeterministicSpider honours robots.txt (T-304) > REQ-034 AC-2: with no robots.txt (404) the crawl proceeds normally, with no robots skips 27981ms
   ✓ DeterministicSpider honours robots.txt (T-304) > skips a URL with a query when a rule says so 23136ms
   ✓ REQ-034: robots.txt on the audit fixture (Disallow: /private) > AC-1: a disallowed page met by link or only in sitemap.xml is never requested, and is a robots Skipped Page 18634ms

 Test Files  2 failed | 1 passed (3)
      Tests  9 passed (9)
   Start at  09:06:36
   Duration  185.07s (transform 11.86s, setup 0ms, collect 42.06s, tests 256.23s, environment 2ms, prepare 2.59s)


⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |unit|  packages/core/tests/spider-host-pacing.test.ts > Spider with a HostPacer (REQ-035)
Error: Hook timed out in 30000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL |browser|  packages/core/tests/spider-robots.test.ts > DeterministicSpider honours robots.txt (T-304)
Error: Hook timed out in 30000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯
```

### REC-013 · opened · 2026-11-04T04:26:23.714Z
- Check: CHK-QA-702-TYPECHECK (typecheck) · Category: type
- Tasks: QA-702 · Requirements: REQ-051 · Responsible: qa-engineer
- Failing evidence: EV-0297 (exit code 2; packages/runner/tests/audit-documents-flow.test.ts(211,30): error TS7006: Parameter 'r' implicitly has an 'any' type. · packages/runner/tests/website-audit-e2e.test.ts(33,20): error TS2307: Cannot find module 'playwright' or its corresponding type declarations.)
- Attempt budget: 3
- Failure excerpt:

```text
packages/runner/tests/audit-documents-flow.test.ts(31,116): error TS2307: Cannot find module 'playwright' or its corresponding type declarations.
packages/runner/tests/audit-documents-flow.test.ts(211,30): error TS7006: Parameter 'r' implicitly has an 'any' type.
packages/runner/tests/website-audit-e2e.test.ts(33,20): error TS2307: Cannot find module 'playwright' or its corresponding type declarations.
```

#### REC-011 · analysis · 2026-11-04T04:26:37.787Z
- Root cause: Check timed out at the 900 s limit (exit null, timed_out true) while ~70 checks ran in one run-many; scheduler.test.ts and benchmark.test.ts passed, runner-server.test.ts was still running. Load, not a code defect: no file under the check's paths changed since its last PASS except shared runner files edited by verified tasks.
- Correction: Re-run alone on a quiet tree (no locks, no other checks running)

#### REC-012 · analysis · 2026-11-04T04:26:38.366Z
- Root cause: spider-host-pacing and spider-robots failed with 'Hook timed out in 30000ms' in beforeAll (Chromium launch) under the same run-many load; no assertion failed
- Correction: Re-run alone on a quiet tree; if it repeats, raise the hook timeout in the two test files through BE-105

#### REC-013 · analysis · 2026-11-04T04:26:38.979Z
- Root cause: 3 TS errors in test files: website-audit-e2e.test.ts:33 and audit-documents-flow.test.ts:31 import 'playwright', which the runner package does not depend on; audit-documents-flow.test.ts:211 implicit any on 'r'
- Correction: QA-195 and QA-500 corrections (dispatched): type-import playwright from ../../core/node_modules/playwright as audit-preview-browser.test.ts:14 does; type 'r'

#### REC-009 · attempt 1/3 · PASS · EV-0311 · 2026-11-04T04:33:47.195Z
- Result: exit code 0; Test Files  1 passed (1)

#### REC-009 · RESOLVED · 2026-11-04T04:33:47.195Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-013 · analysis · 2026-11-04T04:36:15.133Z
- Root cause: Same 3 TS errors. The corrections in website-audit-e2e.test.ts (QA-195) and audit-documents-flow.test.ts (QA-500) were written at 04:25:33Z, 50 s before this item opened (04:26:23Z), so the item's base fingerprint already contains them and the first re-run was refused as unchanged.
- Correction: Type fixes already in the tree (QA-195 and QA-500 VERIFIED: EV-0308, EV-0307). The tree change before this re-run is a lint-only cleanup in QA-702's plan-routes.test.ts (unused type import PlanRouteContext, no-unused-vars warning), made by the orchestrator under the lint-only rule.

#### REC-002 · attempt 1/3 · PASS · EV-0312 · 2026-11-04T04:36:15.849Z
- Result: exit code 0; $ tsc -p tsconfig.test.json --noEmit

#### REC-002 · RESOLVED · 2026-11-04T04:36:15.849Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-013 · attempt 1/3 · PASS · EV-0315 · 2026-11-04T04:37:32.801Z
- Result: exit code 0; Already up to date · Done in 5.1s using pnpm v11.10.0

#### REC-013 · RESOLVED · 2026-11-04T04:37:32.801Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-001 · attempt 1/3 · PASS · EV-0318 · 2026-11-04T04:56:19.418Z
- Result: exit code 0; Test Files  258 passed (258)

#### REC-001 · RESOLVED · 2026-11-04T04:56:19.418Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-012 · attempt 1/3 · PASS · EV-0319 · 2026-11-04T04:58:26.886Z
- Result: exit code 0; Test Files  3 passed (3)

#### REC-012 · RESOLVED · 2026-11-04T04:58:26.886Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-011 · attempt 1/3 · PASS · EV-0320 · 2026-11-04T05:11:16.558Z
- Result: exit code 0; Test Files  3 passed (3)

#### REC-011 · RESOLVED · 2026-11-04T05:11:16.558Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-010 · attempt 1/3 · PASS · EV-0321 · 2026-11-04T05:16:13.014Z
- Result: exit code 0; ✖ 218 problems (0 errors, 218 warnings) · $ eslint .

#### REC-010 · RESOLVED · 2026-11-04T05:16:13.014Z
- Re-run related regression checks before completing (aieos gate lists them).

### REC-014 · opened · 2026-11-04T05:45:19.213Z
- Check: CHK-BROWSER-2 (integration) · Category: test
- Tasks: QA-713 · Requirements: REQ-046, REQ-053, REQ-052, REQ-051 · Responsible: qa-engineer
- Failing evidence: EV-0330 (exit code 1; Test Files  2 failed | 29 passed (31))
- Attempt budget: 3
- Failure excerpt:

```text
gent fill-step value handling > retries with a repair prompt and uses the repaired value when the AI supplies one on retry
[JourneyPlanner] AI response needs repair (Flow "FLOW-LOGIN" step "Fill Email" has action "fill" but no non-empty "value".); retrying with a repair prompt...

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |browser|  packages/core/tests/safe-crawl-links.test.ts > Read-only scan follows links > visits pages of every shape first, groups pages built from one template, and stays read-only
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ packages/core/tests/safe-crawl-links.test.ts:86:97
     84|     expect(report.coverage.totalTestPoints).toBe(5);
     85|     expect(report.notes).toContain('Stopped after 5 pages, the limit f…
     86|     expect(report.notes?.some((n) => n.includes('robots.txt') && n.inc…
       |                                                                                                 ^
     87| 
     88|     // Never: robots-blocked pages, files, logging out, or anything bu…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL |browser|  packages/runner/tests/saved-session-secrecy.test.ts > Saved sessions stay in memory > never shows the session in the plan, events, files, report or log, and drops it when the run ends
Error: Test timed out in 300000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯
```

### REC-015 · opened · 2026-11-04T05:45:20.603Z
- Check: CHK-QA-705-WIZARD-E2E (e2e) · Category: test
- Tasks: QA-705 · Requirements: REQ-053, REQ-046 · Responsible: qa-engineer
- Failing evidence: EV-0331 (exit code 1; Test Files  1 failed (1))
- Attempt budget: 3
- Failure excerpt:

```text
 clean signed-in scan with the first check-up’s specs, and stopping keeps the form
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Go deeper: test the signed-in pages' })

 ❯ packages/wizard/tests/wizard-e2e.test.ts:787:85
    785|   it('Go deeper starts a clean signed-in scan with the first check-up’…
    786|     await page.goto(`${toolUrl}/reports/${secondRunId}`);
    787|     await page.getByRole('button', { name: 'Go deeper: test the signed…
       |                                                                                     ^
    788|     await page.getByLabel('Email or username').fill('manager@example.c…
    789|     await page.getByLabel('Password').fill('manager-password');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL |browser|  packages/wizard/tests/wizard-e2e.test.ts > Release check-up end to end, on the one server > Settings: the key in use, and replacing it
TimeoutError: page.waitForURL: Timeout 30000ms exceeded.
=========================== logs ===========================
waiting for navigation to "http://localhost:3486/check" until "load"
============================================================
 ❯ packages/wizard/tests/wizard-e2e.test.ts:849:16
    847| 
    848|     await page.goBack();
    849|     await page.waitForURL(`${toolUrl}/check`);
       |                ^
    850|     await page.goForward();
    851|     await page.waitForURL(`${toolUrl}/settings`);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯
```

#### REC-014 · analysis · 2026-11-04T05:49:52.456Z
- Root cause: safe-crawl-links.test.ts:86 (real, fails alone too): RobotsPolicy.fetch (packages/core/src/competitive/robots.ts:97, BE-105) now defaults to makeOutboundFetch({ allowPrivate: false }); the fixture runs on localhost, so robots.txt is refused, the policy falls back to allowAll, no page is skipped and the robots note is missing. saved-session-secrecy.test.ts timed out at 300 s while wizard-e2e (CHK-QA-705) ran at the same time: load.
- Correction: BE-105: robots.txt fetch allows a private origin when the crawl target itself is a private/local host (same-origin robots for a local Check-up), public origins stay public-only; regression test. Then re-run CHK-BROWSER-2 alone.

#### REC-015 · analysis · 2026-11-04T05:49:53.016Z
- Root cause: 4 wizard-e2e tests timed out (first: waitForURL 360 s for a check-up to finish, then cascading). The check ran at the same time as browser shard 2 (CPU at 99%), both starting runners and Chromium; the check passed before the QA-713 workspace change made it stale. Load, not a code defect, unless it repeats alone.
- Correction: Re-run alone on a quiet tree after the BE-105 correction (REC-014); if it fails alone, correct through QA-703.

#### REC-014 · attempt 1/3 · PASS · EV-0352 · 2026-11-04T06:14:18.043Z
- Result: exit code 0; Test Files  31 passed (31)

#### REC-014 · RESOLVED · 2026-11-04T06:14:18.043Z
- Re-run related regression checks before completing (aieos gate lists them).

### REC-016 · opened · 2026-11-04T06:49:28.616Z
- Check: CHK-BROWSER-4 (integration) · Category: test
- Tasks: QA-713 · Requirements: REQ-046, REQ-053, REQ-052, REQ-051 · Responsible: qa-engineer
- Failing evidence: EV-0354 (exit code 1; Test Files  1 failed | 28 passed (29))
- Attempt budget: 3
- Failure excerpt:

```text
xture, with no journey planned at all
[QA Orchestrator] Generating release readiness report in C:\Users\HP\OneDrive\Desktop\Projects\AntiGravity - Google - Projects\QA Tool\.tmp-page-sweep\run...

stdout | packages/core/tests/page-sweep.test.ts > Page sweep > finds all four defects planted in the fixture, with no journey planned at all
[QA Orchestrator] Reports generated: report.md and findings.json

 ✓ |browser| packages/core/tests/page-sweep.test.ts (1 test) 162710ms
   ✓ Page sweep > finds all four defects planted in the fixture, with no journey planned at all 162647ms
 ✓ |browser| packages/checkers/tests/spec-denial.test.ts (4 tests) 6ms

 Test Files  1 failed | 28 passed (29)
      Tests  1 failed | 211 passed (212)
   Start at  12:06:09
   Duration  635.06s (transform 4.14s, setup 0ms, collect 68.06s, tests 1592.70s, environment 9ms, prepare 9.78s)


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |browser|  packages/runner/tests/docs-url-beta.test.ts > Docs address > a public-looking site does not read a private docs address; the run goes on with a note
AssertionError: expected 409 to be 202 // Object.is equality

- Expected
+ Received

- 202
+ 409

 ❯ packages/runner/tests/docs-url-beta.test.ts:89:24
     87|       contextUrl: `http://localhost:${DOCS_PORT}/page1`,
     88|     });
     89|     expect(res.status).toBe(202);
       |                        ^
     90|     await waitForPhase(['awaiting-review']);
     91|     const p = await plan();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

#### REC-015 · attempt 1/3 · PASS · EV-0355 · 2026-11-04T06:55:29.117Z
- Result: exit code 0; Test Files  1 passed (1)

#### REC-015 · RESOLVED · 2026-11-04T06:55:29.117Z
- Re-run related regression checks before completing (aieos gate lists them).

#### REC-016 · analysis · 2026-11-04T06:57:47.521Z
- Root cause: docs-url-beta.test.ts (unowned, pre-existing) keeps its runner data in the fixed folder .tmp-docs-url-data and clears it only in afterAll. The previous shard-4 run was stopped mid-file (the orchestrator stopped the stale batch), so afterAll never ran and a plan awaiting review was left in that folder; this run's first POST /api/runner/run met it and answered 409 ERR_PLAN_WAITING instead of 202. The file passes alone (2/2) once the folder is gone. Not a product defect.
- Correction: Plan amendment (D-015): add packages/runner/tests/docs-url-beta.test.ts to QA-706; clear outputDir and dataDir in beforeAll as well as afterAll so leftover state from an interrupted run cannot leak in; no assertion change. Then re-run CHK-BROWSER-4.

#### REC-016 · analysis · 2026-11-04T06:59:38.389Z
- Root cause: docs-url-beta.test.ts (unowned, pre-existing) keeps its runner data in the fixed folder .tmp-docs-url-data and clears it only in afterAll. The previous shard-4 run was stopped mid-file (the orchestrator stopped the stale batch), so afterAll never ran and a plan awaiting review was left in that folder; this run's first POST /api/runner/run met it and answered 409 ERR_PLAN_WAITING instead of 202. The file passes alone (2/2) once the folder is gone. Not a product defect.
- Correction: Plan amendment: add packages/runner/tests/docs-url-beta.test.ts to QA-706; clear outputDir and dataDir in beforeAll as well as afterAll so leftover state from an interrupted run cannot leak in; no assertion change. Then re-run CHK-BROWSER-4.

#### REC-016 · attempt 1/3 · PASS · EV-0368 · 2026-11-04T07:46:07.788Z
- Result: exit code 0; Test Files  29 passed (29)

#### REC-016 · RESOLVED · 2026-11-04T07:46:07.788Z
- Re-run related regression checks before completing (aieos gate lists them).

### REC-017 · opened · 2026-11-04T08:26:43.470Z
- Check: CHK-BROWSER-2 (integration) · Category: flaky
- Tasks: QA-713 · Requirements: REQ-046, REQ-053, REQ-052, REQ-051 · Responsible: qa-engineer
- Failing evidence: EV-0376 (exit code 1; Test Files  2 failed | 29 passed (31))
- Attempt budget: 3
- Failure excerpt:

```text
core/tests/discovery-agent-fill-value.test.ts > DiscoveryAgent fill-step value handling > retries with a repair prompt and uses the repaired value when the AI supplies one on retry
[JourneyPlanner] AI response needs repair (Flow "FLOW-LOGIN" step "Fill Email" has action "fill" but no non-empty "value".); retrying with a repair prompt...

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |browser|  packages/core/tests/auth-crawl-e2e.test.ts > T-117 Auth and crawl end-to-end (auth-crawl-e2e.test.ts) > end-to-end: discovers with session, hands off to orchestrator, single sign-in, headers on all phases, secrets redacted
AssertionError: expected undefined to be 500 // Object.is equality

- Expected: 
500

+ Received: 
undefined

 ❯ packages/core/tests/auth-crawl-e2e.test.ts:119:30
    117|       const err403 = skipped.find((s) => s.urlPath === '/lab/forbidden…
    118|       expect(err500).toBeTruthy();
    119|       expect(err500?.status).toBe(500);
       |                              ^
    120|       expect(err403).toBeTruthy();
    121|       expect(err403?.status).toBe(403);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL |browser|  packages/runner/tests/saved-session-secrecy.test.ts > Saved sessions stay in memory > never shows the session in the plan, events, files, report or log, and drops it when the run ends
Error: Test timed out in 300000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯
```
