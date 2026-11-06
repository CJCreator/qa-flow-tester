## Final report: Website Audit stall test

**1. Summary**

- **Runs created:** 12 audits on arocord.com and httpbin.org. Ten finished and two failed. Zero were stuck and zero stopped.
- **Rejected at the form:** one invalid address (`.invalid`) never created a run.
- **Worst stall:** none. The longest run took 30 s and the longest stage about 15 s ("Reading the pages"). No audit stayed on one stage for more than 2 minutes.
- **Worst problem:** Stop was ignored (STK-001). The server accepted the stop request, the audit ran to Ready anyway, and it was saved as a finished version.
- **Correction:** Earlier I said no stop request was sent. My network filter missed it. Stop calls `POST /api/runner/stop`, which returned 200 in the retry run (13:18). I didn't capture it for the two earlier Stop clicks.

**2. Stall list**

No stalls were found. The issues below are the ones I did find, most severe first. Severity uses your scale where it applies. STK-001 is outside that scale, since nothing stalled.

**STK-001: Major (not a stall; Stop does nothing)**

- Stage and page: any stage on arocord.com. The click was at about 5 to 10 s into a run.
- Duration and what the user saw: no change. The run finished at 25 to 27 s and the list showed "Finished". Three Stop clicks, on 13:14, 13:15 and 13:18, all did the same. I confirmed the button was clickable and no browser dialog was raised.
- App limit fired: no. The audit moved on normally.
- Repro: (1) Open /audits/new, enter `https://arocord.com`, leave default limits, press Enter. (2) Within about 10 s, scroll down and click Stop. (3) The run still reaches Ready, and the list shows Finished.
- Evidence: GIF `audit_t4_stop_attempts.gif`. Request `POST /api/runner/stop`, 200 (13:18 run). Timeline for 13:18: 12 s "Reading the pages (now)", then 17 s "Writing notes (now)", then 25 s still "Writing notes", then done at about 25 s. Console: none captured.
- Proposed fix: make Stop cancel this audit's own run ID. Show "Stopping…" until the server confirms, and show an error if the run can't be cancelled. Guess: the cause is in the runner stop route, not the crawl or AI files, because the stop reaches the server but doesn't end this audit.

**STK-002: Minor (recovers, but the cause is hidden)**

- Stage and page: live progress stream, all stages.
- Duration: the screen kept updating, so the user saw no problem. The stream returned 503 on seven of the eight captured runs.
- App limit fired: not visible. Progress continued, so the audit moved on.
- Repro: any run from a fresh start. Check the network log for `/api/audits/<id>/stream`.
- Evidence: 503 on `ZWUT3WbQcPCMJg5CSH4sCQ`, `uSuNj08VOuUI6JW5zMFJkA`, `RpZtsQAmWgsrHoKFl59f5A`, `FWv_7QKjetwTuFbZw8v__g`, `Ra8xUVoMXx2HijeCV1PLTA`, `cjpPiZ7VgbAWfIYXdlyL6Q` and `J-HjuFVh8zHkboc0QTe-yA`. The one 200 was `uMb-xRzNdyITD0WMJCx8gQ`.
- Proposed fix: when the stream fails, show "Live updates paused, retrying" and retry with backoff. Make sure the page does not depend on a fallback that can't be verified. Guess: the stream route.

**STK-003: Minor (second start silently dropped; probably one cause with STK-002)**

- Stage and page: start form, while a run is active.
- Duration: no run was created and nothing was shown. The form reset and the typed URL was lost.
- App limit fired: not applicable.
- Repro: (1) Start arocord.com. (2) About 8 s later, open /audits/new, enter the same URL, press Enter. (3) No new run appears in the list and no message is shown.
- Evidence: a POST to `/api/audits` was left "pending" in the same window as 503s on `/api/runner/status`, `/api/runs`, `/api/runner/waiting-plans` and `/api/ai/settings`. The POST's final status was not captured. The guard may have worked, or the runner may have been unavailable for a few seconds. I can't tell which from the browser.
- Proposed fix: show "Another audit is running, open it" with a link when the start is refused. Show "Could not start, try again" for a 503, and keep the typed URL. Guess: runner availability.

**STK-004: Minor (reload hides progress)**

- Stage and page: any stage, seen after a reload at about 4 s ("Reading the pages").
- Duration: the progress view was gone. /audits/new showed a blank form with no sign of the run. The run kept going on the server.
- App limit fired: no. The run finished at about 25 s.
- Repro: (1) Start arocord.com. (2) At about 4 s, reload /audits/new. (3) The form appears with no progress. (4) Open /audits and the run shows "Running", then "Finished" with 1 page and 30 findings.
- Evidence: audit `J-HjuFVh8zHkboc0QTe-yA`, "Running" in the list. The "tool-restarted" path wasn't tested because it needs a server restart.
- Proposed fix: on /audits/new, if a run is active, show it at the top with a link to it.

**STK-005: Minor (wrong message)**

- Stage and page: "Checking the address", at `httpbin.org/status/404`.
- Duration: stopped at 8 s. The message reads "This website blocks automated visitors." A plain 404 is not a bot block. I couldn't check the response in the browser because navigation to httpbin.org was refused.
- App limit fired: probably the address-check limit, at about 8 s. Guess.
- Repro: enter `https://httpbin.org/status/404` on a fresh /audits/new.
- Evidence: list shows "Failed", 13:11. Console: none captured.
- Proposed fix: give HTTP 404 its own message, such as "This page was not found (404)". Keep the bot-block message for challenge pages only. Guess: the address-check classifier.

**STK-006: Minor (speed chip contradicts results)**

- Stage and page: "Measuring speed", arocord.com.
- Duration: about 1 s. The chip says "Speed: measured by this tool", but the results say "No grade: no checks ran".
- App limit fired: not applicable.
- Repro: run arocord.com, then compare the chip on the progress page with the Speed section on the results page.
- Evidence: results page, 13:07 run `ZWUT3WbQcPCMJg5CSH4sCQ`.
- Proposed fix: either run the speed check and show its result, or label the chip "not measured" and give the reason. Guess: the speed check may be skipped silently.

**STK-007: Nit (two names for one state)**

- Stage and page: address check, at `httpbin.org/delay/120` and `httpbin.org/status/404`.
- Duration: stopped at 8 s. The page says "The Website Audit stopped" but the list says "Failed".
- Repro: run either httpbin address, then compare the page with /audits.
- Proposed fix: use "Failed" on both the page and the list.

**Positive checks:** the invalid host was rejected at the form in under 5 s with a clear message. The two httpbin addresses both ended in about 8 s with a message, rather than hanging.

**3. Fix order**

1. **STK-001** first. Stop is the only manual way out of a run, and it is ignored.
2. **STK-002 and STK-003 together.** Both point to runner availability: the 503 stream responses, and a start that was dropped in the same window. Fix the runner availability first, then the messages.
3. **STK-004** next. Losing the progress view after a reload is easy to hit.
4. **Messages:** STK-005, STK-006 and STK-007.

**4. Coverage**

- **T8 not run:** arocord.com yields one page, and you didn't give a many-page site.
- **T9 not run:** you didn't give a site with robots-disallowed pages.
- **T10 partial:** the results sections loaded on a finished run, and the review page loaded with 30 findings. I did not open the seven documents. I did not click Save on the review page.
- **T3 partial:** no public never-answering host or redirect loop was found, and I didn't invent one.
- **T4 stall check not reached:** no stage ran long enough to test the 2-minute limit.
- **T5 partial:** the "tool-restarted" path needs a server restart. Reload during assessing wasn't tested because the run was too short.
- **T2 inconclusive:** both limit settings produced one page, so the cap was never reached.
- **T6 inconclusive:** the second start may have been dropped by the runner outage rather than the concurrency guard.
- **Console:** tracking started late, so an error during the first test may have been missed. Nothing matched the pattern in any window I checked.
- **Lost evidence:** the GIF for the Stop retry was cleared before I exported it.
- **GIFs saved:** `audit_t1_main.gif`, `audit_t2_limits.gif`, `audit_t3_invalid_slow.gif`, `audit_t4_stop_attempts.gif`, `audit_t5_t6_t7_reload_concurrent_double.gif`.

To finish T8, T9 and T10, I need a many-page site and a site with robots-blocked pages.
