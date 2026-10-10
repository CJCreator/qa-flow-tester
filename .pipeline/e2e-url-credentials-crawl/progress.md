# Progress

- Step 1 ADR 0022 + 0014 note + CONTEXT.md: done, commit 55b1a1c
- Baseline re-run to .tmp-baseline.json: running; code edits wait for it (edits mid-run would skew it)
- Step 2 types: done, commit 9bfcec0, build ok. Baseline (.tmp-baseline.json): 13 failed/1069; failing files in baseline-failures.txt
- Step 3 fail-fast: done, commit 068e868, 6 tests pass (verified by me)
- Step 4 coverage: done, commit b609195 (note: socket-drop makes next page fail too in stub; unverified on real sites)
- Step 5 server: done, commit 934c982; beta test weak, plan-item check conditional (to tighten)
- Step 6 issues doc coverage: done, 32493f3
- Step 7 wizard: done, 94dac14 (not visually verified; wizard-e2e not run)
- Step 8 headless: done b7fb0a5; AC5 (headless==API fingerprints) NOT tested; agent did stash/pop mid-flight, check 5b edits intact
- Step 5b rule truth table: done 71a3c32 (beta e2e test still lenient if run fails; credentials-crawl ~195s)
- Review (a6c182c): 6 blocking found. Fix 1 (core fail-closed) 4d78f00 done; server/checkup and wizard fixes running. Build TS2353 requireSignIn/RunOptions seen mid-flight in server.ts -> recheck after server agent finishes
- Review fixes done: 4d78f00 (core), 015f729 (wizard), 0a02fd7/d64801c/754f71f (server/checkup), style 0c57a6a. Phase5: install ok, build ok, lint 0 errors/52 warnings, format:check red at BASE too (pre-existing; branch-introduced files fixed). Full suite -> .tmp-after.json
- Full parallel run after changes (.tmp-after.json): 24 failed/1116, 11 new failing files vs baseline 13/1069. Serial re-run of every failing file except wizard-e2e: 78/78 + 41/41 pass (incl. url-first, saved-session-secrecy, e2e-discovery which also failed at baseline) -> failures are load/timeouts, not regressions. wizard-e2e (browser, 9 failures at baseline AND after) not re-verified.
- Impact analysis done (read-only): no code regressions; docs fixed c144161. Open: wizard 409 approve (running), AC5 test (running), benchmark AC1 (pending)
- Wizard 409 approve re-enter creds: ee29d58 (role name always 'member' after restart; form has no component test)
