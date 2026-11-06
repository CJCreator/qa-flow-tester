Check-up QA report: arocord.com
As of 6 Nov 2026
Summary
No blockers found: a first-time user can still finish a check-up. Six major problems give wrong results or misleading messages, so the results should not yet be used for a release decision.
Stage
Status
Main finding

1. Start
   Partly passed
   Address checks work. The ownership chip says “Live site” while “Only look at it” is selected (CHK-009).
2. Scan
   Partly passed
   Reloading after the scan goes to plan review. A reload during the scan was not tested.
3. Plan review
   Failed
   “Add page” does nothing (CHK-003). A switched-off test comes back after re-plan (CHK-004).
4. Testing and Stop
   Failed
   Stop shows “The check-up wasn't stopped” even though the stop was accepted (CHK-006).
5. Report and Visibility
   Failed
   Headline counts change on re-open (CHK-001). The SEO score is 0% with no explanation (CHK-013).
6. Past check-ups
   Failed
   Severity counts differ from the report for the same run (CHK-002).
7. Settings and related screens
   Partly passed
   Defaults save and persist. The Benchmark page briefly redirected during a lost connection (CHK-014).
8. Cross-cutting
   Partly passed
   A double-click creates one run. Back and forward keep state. The 390px width check is not verified.
   Stages: none fully passed, four partly passed (1, 2, 7, 8), four failed (3 to 6), none blocked.
   Issues by severity: Blocker 0, Major 6, Minor 9, Nit 3, 18 in total. Earlier I marked CHK-001 and CHK-002 as blockers. Under your definition they are Major, because a first-time user can still finish.
   Issue list
   Major issues come first. Each entry gives severity, blocker status, stage and screen, what happened, what should happen, a repro from a fresh start, evidence and a proposed fix. A fix is marked as a guess when the cause cannot be confirmed from the browser.
   CHK-001 · Major · Blocker: no
   Stage and screen: Stage 5, report page /reports/run-1793945975214.
   What happened: The headline counts for the same finished run changed between two opens. First view: 77, 42 and 19. Re-open: 80, 44 and 20.
   What should happen: The same counts each time for a finished run that has not changed.
   Repro from fresh start: Start a check-up on https://arocord.com, approve the plan, and wait for the run to finish. Note the three headline counts. Leave the report, open the same run again from Past check-ups, and compare. Seen on run-1793945975214 only. Not yet reproduced on a new run.
   Evidence: Session notes from the first run. The current report headline is in checkup_report.gif. No console or network error was captured for this step.
   Proposed fix (guess, code): The report and the Past check-ups list probably count findings from different sources at different times. Store one set of counts when the run ends, and show that set on every screen.
   CHK-002 · Major · Blocker: no
   Stage and screen: Stage 6, Past check-ups (/reports), compared with the report for the same run.
   What happened: The list and the report disagree. Run at 12:51: the list reads “5 block release · 14 major · 51 minor · 21 suggestions”, and the report headline reads “18 problems must be fixed first”. Run at 12:12: the list reads “5 block release”, and its report said 17 must-fix. Partial run at 12:24: the list reads “2 block release”, and its report said “9 problems must be fixed first”.
   What should happen: One count for the same run, with the same labels, on the list and on the report.
   Repro from fresh start: Run a check-up to completion. Open /reports and read that run's counts. Open the same run's report and read the headline.
   Evidence: Page text of /reports after run-1793948386155 finished. checkup_past.gif shows the list. checkup_report.gif shows the headline.
   Proposed fix (guess, code): The list probably maps severity names differently from the report headline (“block release” against “must fix”), or reads older data. Use one summary object for both screens.
   CHK-003 · Major · Blocker: no
   Stage and screen: Stage 3, plan review (/check/plan), Add page control.
   What happened: I entered /contact and clicked Add page. The page showed “Updating the plan: Opening /contact…”. The Pages heading still read “Pages (1, 1 tested)”. No page was added, and no message or error appeared.
   What should happen: The page is added to the plan, or a clear error appears.
   Repro from fresh start: Start a check-up on https://arocord.com and wait for the plan. On the plan page, click Add page, type /contact, and submit. Wait 30 seconds and read the Pages heading.
   Evidence: Network: POST /api/runner/plan/add-page returned 202. No later error was captured. Page text after the attempt still showed “Pages (1, 1 tested)”. No GIF.
   Proposed fix (guess, code): The add job probably finishes or fails without the plan reloading. After the 202, poll the plan and show either success or the error text.
   CHK-004 · Major · Blocker: no
   Stage and screen: Stage 3, plan review. Switching off a test, then Re-plan everything with the AI.
   What happened: I switched off “Contact Support via Email”. The count went from 48 to 45, and Won't run showed (1). After Re-plan everything with the AI, Won't run showed (0), journeys fell from 8 to 5, and tests fell from 45 to 39. The dialog says: “What you switched off stays off, but changes you made to tests and journeys are replaced.”
   What should happen: The switched-off test stays off after a re-plan and still appears under Won't run.
   Repro from fresh start: On the plan page, switch off one test. Click Re-plan everything with the AI and confirm. Read the Won't run count.
   Evidence: Session notes of the plan page before and after the re-plan. No GIF. No network error.
   Proposed fix (guess, code, or wording if intended): The re-plan probably regenerates the test list and drops the switched-off state. Store switched-off items by ID and apply them after every re-plan. If dropping them is intended, change the dialog text so it does not say they stay off.
   CHK-005 · Major · Blocker: no
   Stage and screen: Stage 3, New check-up (/check), and Past check-ups (/reports).
   What happened: A plan was waiting for review. The New check-up page showed “Your check-up of arocord.com is waiting for your review. Open the plan →”. But GET /api/runner/waiting-plans returned {"plans":[]}. GET /api/runner/status returned hasPlan true, phase “awaiting-review”, and runId run-1793948386155. Past check-ups showed “A check-up is already running.” The Open the plan link worked.
   What should happen: The waiting-plans list includes the plan, and the wording says waiting, not running.
   Repro from fresh start: Start a check-up on https://arocord.com and wait for the plan. Open /check and read the banner. In the browser console, run await (await fetch('/api/runner/waiting-plans')).json(). Open /reports.
   Evidence: Network: GET /api/runner/waiting-plans returned 200 with an empty list. GET /api/runner/status returned 200 with hasPlan true. Page text of /check and /reports. No GIF shows this banner.
   Proposed fix (guess, code): The waiting-plans endpoint probably filters on a field that the status endpoint does not set. Make the list read the same source as the status. Change “already running” to “waiting for your review” when the phase is awaiting-review.
   CHK-006 · Major · Blocker: no
   Stage and screen: Stage 4, testing (/check/testing). The Stop control and its dialog.
   What happened: I pressed Stop testing and chose “Make a report from what's done”. The page showed “The check-up wasn't stopped. Nothing was stopped. The check-up may have already finished.” At the same time POST /api/runner/abort returned 200. About a minute later the run ended with a partial report: “A partial check-up. Testing was stopped after 3 of 39 tests.”
   What should happen: No error once the abort is accepted. Show “Stopping…” until the run ends, then show the partial report.
   Repro from fresh start: Start a check-up on https://arocord.com and approve the plan. Wait until a few tests have run. Press Stop testing and choose “Make a report from what's done”. Watch the message for about a minute.
   Evidence: Network: POST /api/runner/abort returned 200. Page text: the error above, then the partial report text. No GIF of this flow.
   Proposed fix (guess, code): The Stop screen probably reads the run status before the server marks the run as stopping, and shows an error when that read is empty. Treat the 200 as accepted, and poll until the run is done.
   Minor issues come next, then nits.
   CHK-007 · Minor · Blocker: no
   Stage and screen: Stage 3, plan review. The Pages section and its Sample Pages text.
   What happened: The plan says “Other, with 1 page”, and Pages reads “(1, 1 tested)”. The Visibility findings name /aboutus, /contacts and /terms-conditions-arocord. The plan says pages with the same layout are tested through “Sample Pages”. It is not clear whether those three pages were tested or only sampled.
   What should happen: The plan names the pages it tested and the pages it sampled.
   Repro from fresh start: Start a check-up on https://arocord.com. Read the Pages section of the plan. Open the report's Visibility page and compare the pages listed.
   Evidence: Page text of the plan and of the Visibility page for run-1793948386155. No GIF. Needs verification: which pages the run actually tested.
   Proposed fix (guess, wording): Name the sampled pages in the plan text, with their status (tested or sampled).
   CHK-008 · Minor · Blocker: no
   Stage and screen: Stage 3, plan review, yellow banner about ownership.
   What happened: The banner says: “If it's yours, start a new check-up and tick ‘I own this site’.” The New check-up page has no such checkbox. It has three radio options: “Only look at it: nothing is sent or changed”, “It's my live site: only look at it”, and “It's a test copy I'm allowed to test fully”.
   What should happen: The banner names an option that exists on the New check-up page.
   Repro from fresh start: Start a check-up on https://arocord.com and open the plan. Read the banner. Go to New check-up and look at the ownership options.
   Evidence: Page text of the plan and of /check. No GIF.
   Proposed fix (guess, wording): Change the banner to name the radio option, for example: choose ‘It's my live site’.
   CHK-009 · Minor · Blocker: no
   Stage and screen: Stage 1, New check-up (/check), chip beside the address.
   What happened: After I typed https://arocord.com, the chip read “Live site: only looks, nothing is sent or changed”. The selected option was “Only look at it: nothing is sent or changed”. The two labels describe different modes.
   What should happen: The chip uses the same label as the selected option.
   Repro from fresh start: On /check, type https://arocord.com. Read the chip, then read which option is selected.
   Evidence: Page text of /check, and a screenshot from the session. checkup_start.gif shows the form before the address is typed.
   Proposed fix (guess, wording): Build the chip from the selected option's label, not a fixed phrase.
   CHK-010 · Minor · Blocker: no
   Stage and screen: Stage 3, plan review. The estimate under What approving runs.
   What happened: The plan says “39 tests on 1 page at 3 screen sizes (375px, 768px, 1440px) · about 3 min”. The report for the approved run says “39 tests in 16 min”.
   What should happen: An estimate close to the real duration, or a range.
   Repro from fresh start: Start a check-up on https://arocord.com and read the estimate. Approve the plan and time the run.
   Evidence: Page text of the plan. The report headline, shown in checkup_report.gif.
   Proposed fix (guess, code): Calibrate the estimate from past run times, or show a range such as 3 to 16 min.
   CHK-011 · Nit · Blocker: no
   Stage and screen: Stage 3, plan review. The heading Works 30 Tests.
   What happened: The heading reads “Works 30 Tests”, beside the summary “39 tests” and the chip “Works (10)”. The three numbers do not obviously agree.
   What should happen: Each label says what its number counts.
   Repro from fresh start: Start a check-up and read the top of the plan.
   Evidence: Page text of the plan. No GIF.
   Proposed fix (guess, wording): Use “30 of 39 tests”, or remove the heading.
   CHK-012 · Nit · Blocker: no
   Stage and screen: Stage 3, plan review. The Find in the plan filter.
   What happened: Typing “Features” cut the page text from 5,539 to 3,482 characters. Journeys (5) and Navigation (6) kept their full counts.
   What should happen: Counts show the filtered number, for example 2 of 5.
   Repro from fresh start: On the plan page, type Features into Find in the plan. Read the Journeys and Navigation headings.
   Evidence: Page-text measurements from the session. No GIF.
   Proposed fix (guess, code): Show “x of y” while a filter is active.
   CHK-013 · Minor · Blocker: no
   Stage and screen: Stage 5, Search and AI visibility, SEO tab. Also the robots.txt finding in the Findable list.
   What happened: The Search (SEO) score is 0%. It lists 14 items needing attention, three of them marked Must fix. AEO is 93%, GEO 91% and Marketing 92%. The page does not say how the score is worked out. One finding reads “Found on /robots.txt” for a file that does not exist.
   What should happen: The score has a visible explanation, and a missing file is described as missing.
   Repro from fresh start: Open the report for run-1793948386155, then Search and AI visibility. Read the SEO score and the robots.txt finding.
   Evidence: checkup_visibility.gif shows the SEO score of 0% and the tabs. Page text of the Visibility page.
   Proposed fix (guess, wording and possibly code): Add a line that explains the score. Change the robots.txt text to “Not found at /robots.txt”. Check whether 0% is intended. It may be that partial credit is not counted.
   CHK-014 · Minor, intermittent · Blocker: no
   Stage and screen: Stage 7 and Stage 8. The Benchmark page (/benchmark) and the Visual baselines page.
   What happened: Opening /benchmark redirected to /shortlist. The page showed “Lost contact with Release check-up. Retrying…” and the text “Check that it's still running in its terminal (start it with pnpm start). This page keeps trying.” The tab's network log shows GET /api/runner/status returning 503 twice. Later loads of /benchmark worked. On a later visit to /baselines the same banner appeared, while the status endpoint returned 200.
   What should happen: A brief connection problem shows a retry notice and does not move the user to another page.
   Repro from fresh start: Hard to reproduce on demand. Load /benchmark while the status endpoint is failing, or reload while the app restarts.
   Evidence: Network: GET http://localhost:3001/api/runner/status returned 503, two times in the session. checkup_baselines.gif shows the banner on Visual baselines. The redirect has no GIF.
   Proposed fix (guess, code): A failed status call is probably treated as no route and triggers a redirect. Keep the current page and show only the retry notice.
   CHK-015 · Minor, UX · Blocker: no
   Stage and screen: Stage 1 and Stage 4, New check-up (/check).
   What happened: After the address was typed, the form grew and the Start button moved below the fold. My double-click aimed at Start first hit an ownership option label and changed the selected option to Only look at it. The second click then landed where Stop the check-up appeared. No duplicate run was created: there was one run request, and no abort in that step.
   What should happen: Start stays where the user can reach it. A second click cannot land on Stop.
   Repro from fresh start: On /check, type https://arocord.com. Then double-click the Start button where it was before the form grew.
   Evidence: Network resource log: one /api/runner/run, and no /api/runner/abort in that step. Screenshot from the session. No GIF.
   Proposed fix (guess, code or layout): Keep Start visible, for example in a sticky footer. Disable Start after the first click. Do not reuse its position for Stop.
   CHK-016 · Minor · Blocker: no
   Stage and screen: Stage 8, theme choice (all pages).
   What happened: The theme is saved under two localStorage keys, qa-color-theme and qa-theme. In an earlier check they disagreed.
   What should happen: One stored value, read everywhere.
   Repro from fresh start: Change the theme in Settings. In the browser console, read both keys and compare.
   Evidence: Browser-storage read from the session. No GIF.
   Proposed fix (guess, code): Keep one key, migrate the other, and remove it.
   CHK-017 · Minor, needs verification · Blocker: no
   Stage and screen: Stage 6, Past check-ups history.
   What happened: The report shows Since the last check-up: fixed 4, new 66, still there 47. The Past check-ups history does not show which run that comparison was made against.
   What should happen: The history shows the baseline run for the comparison.
   Repro from fresh start: Open /reports, and compare its rows with the Since the last check-up panel on the report for the same run.
   Evidence: Page text of /reports and of run-1793948386155. No GIF.
   Proposed fix (guess, wording or code): Show the baseline run and its date in the history row. First confirm that the comparison is meant to appear there.
   CHK-018 · Nit · Blocker: no
   Stage and screen: Stage 3, plan review. Editing a journey step's wording.
   What happened: I edited a step to “The Terms and Conditions page is shown”. It saved as “Page mentions ‘The Terms and Conditions page is shown’ (confirmed by you)”. The saved text reads as a claim about the page.
   What should happen: The saved text stays as plain as the user's wording.
   Repro from fresh start: On the plan page, open a journey step, click Change the wording, enter the text, and confirm.
   Evidence: Page text before and after the edit. No GIF.
   Proposed fix (guess, wording): Save the user's text without the generated prefix, or label the prefix as a template.
   Fix order
   There are no blockers, so the order starts with the majors. Issues that share one cause sit in the same step.
9. Count and severity source (CHK-001, CHK-002). Use one shared summary for the report headline and the Past check-ups row.
10. Waiting-plan state (CHK-005). Make the waiting-plans list read the same source as the status. Then change “already running” to “waiting for your review”.
11. Plan edits (CHK-003, CHK-004). Both lose a change on the plan page: an added page and a switched-off test. Save plan edits by ID, and re-apply them after each add or re-plan.
12. Stop flow (CHK-006). Treat the 200 from the abort as accepted, and poll until the run is done.
13. Connection handling (CHK-014). On a failed status call, keep the current page and show only the retry notice.
14. Wording and labels (CHK-008, CHK-009, CHK-010, CHK-011, CHK-012, CHK-013, CHK-018). These can be fixed together after one copy review. CHK-013 also needs a decision on whether 0% is correct.
15. Layout and storage (CHK-015, CHK-016). Keep Start in view on the New check-up page, and keep one theme key.
16. Verify before fixing (CHK-007, CHK-017). Confirm which pages the run tested, and whether the Since the last check-up panel should appear in the history.
    Coverage
    Tested: the New check-up page and its address checks, a full scan and plan, a full 39-test run, the Stop flow with a partial run, the report and its tabs, the Visibility tabs, Past check-ups, Visual baselines, the Benchmark empty form, Settings defaults, and back, forward and reload on the plan page.
    Not reached or not tested:
    • Stage 2: reload during the scan. The scan finished in about one minute, so there was no window to reload in.
    • Stage 3: “bring one back”, because the brief's wording was unclear. Re-plan of the waiting plan, which uses the free AI quota (35 requests were left that day). The Add page success path, because the add step fails.
    • Stage 4: “Throw away the results”, because it deletes run data and needs your approval. The visual review and baseline prompts, because no baselines exist and no visual run was made. “Keep testing” in the Stop dialog.
    • Stage 5: Print, “Which limits were missed”, the Problems found filters beyond the page list, and comparison with the sample report.
    • Stage 6: opening more past check-ups, and deleting one, which needs your approval.
    • Stage 7: a live Benchmark comparison, which needs a second site address. Visual baselines with saved items, because none exist.
    • Stage 8: the 390px check for horizontal scrolling. Resizing the window reported success, but the width did not change. Keyboard and focus tests are partial, with Escape tested. Loading states were not captured. Console errors were not captured for each step; only network statuses were.
    • Start: private-address diagnostics were only partly re-checked.
    • Out of scope: the Website Audit settings and Shortlist pages. The Website Audit findings are in an earlier report and are not in this document.
    • GIFs: there are no per-stage GIFs for the scan, plan, testing or Stop, because you chose to skip them.
    Side effects and files
    Check-up runs created on arocord.com:
    • run-1793945975214, 12:12, complete.
    • run-1793947915290, 12:24, stopped after 3 of 39 tests.
    • run-1793948386155, 12:51, complete. Its plan was approved, and all 39 tests ran.
    Settings: the Tablet (768px) default was unticked for one reload, then ticked again. It is back to how it was.
    Website Audit: documents were downloaded from audit C61bNm1gZxPBsUx2MdTiQA, version 1: Audit Documents (Markdown, English), Pitch Glimpse (PDF, English) and Owner Audit (PDF, English). Nothing in the audit was changed.
    GIF files, saved to the Chrome download folder: checkup_recording.gif (5.9 MB), checkup_start.gif (199 KB), checkup_report.gif (336 KB), checkup_visibility.gif (357 KB), checkup_past.gif (240 KB), checkup_settings.gif (622 KB), checkup_baselines.gif (246 KB), and checkup_benchmark.gif (640 KB). An earlier checkup_baselines file (285 KB) shows the Settings page by mistake, so you can delete it.
    No code or settings were changed. No one signed in, and nothing was submitted on arocord.com.
