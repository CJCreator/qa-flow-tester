# Human to-do

Things only the owner can do. The agents do not attempt these. After each, record the result where stated and tell the agent so the gap row can be closed.

T-18 reasons chosen by planner: wrong details / no sign-in form found / site unreachable or timed out / needs more than a password. Rename in `packages/types/src/signin.ts` if unwanted.

## G38: rotate the exposed API key (do first)
1. Find which provider the key belongs to (the old saved Claude permission rule; do not paste it anywhere).
2. In that provider's console, revoke the key and create a new one.
3. Put the new key only in your local `.env` / `.qa-keys.json` and in Render and GitHub secrets if used. Never in a command.
4. Check the provider's usage page for calls you do not recognise since the exposure.
5. Record: date rotated, provider, "old key revoked: yes" in `SECURITY.md` or CHANGELOG (no key text).

## G4: prove the free-hosting path
1. Start from a fresh clone and a new account with no card on file.
2. Follow only the README: time from "open the site" to a verdict. Target under 15 minutes.
3. Test a private preview URL through the hosted beta.
4. On GitHub: note Actions minutes used by one full check-up.
5. On Render: note peak memory of one full check-up; does Chromium fit 512 MB?
6. Record in the Phase 1 section of `docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md`: minutes, Actions minutes, peak MB, pass or fail, date.

## G10 (real run): hosted beta limits
After T-11 is merged and deployed:
0. Set `RUNNER_BETA_RUNS_PER_VISITOR` and `RUNNER_BETA_RUNS_PER_DAY` in the Render dashboard (defaults 5 and 40). A restart resets the counters, so finish the test before restarting.
1. Hit the beta from two different browsers; confirm per-visitor and daily limits trigger with a clear message.
1b. Clear the cookie in one browser and confirm it gets a fresh visitor count (and loses its key); the daily cap still applies.
2. Decide whether a second host is needed (plan row 21); if yes, create it and record the URL.
3. Record: limits chosen, observed behaviour, date.

## G28: user conversations
1. List 3 to 5 people on small teams that release websites without QA staff.
2. Ask 20 minutes each: how they check before release today, whether they use GitHub Actions, what a "Not yet" verdict would make them do, what they would pay or not pay for.
3. Do not pitch. Write notes the same day.
4. Record in `docs/research/user-conversations.md`: who (role only), date, quotes, what surprised you, decision on Phase 4 and the signed-in direction.

## G30, G43, G44: pricing and go-to-market (decisions)
1. Decide who the first paying customer is and what they buy (hosting, support, hosted runs, team features).
2. Decide pricing and free limits; write them in `docs/research/pricing.md`.
3. Write a one-page go-to-market plan: target customer, positioning against Playwright, axe, Lighthouse and paid tools, 2 or 3 launch channels, content plan, in `docs/research/go-to-market.md`.
4. Tell the agent the pricing so the landing pricing section (G43) can be updated.

## G32: repo visibility and licence fit
1. Decide public or private for the tool repo. The generated workflow needs it fetchable by users' CI.
2. List runtime dependencies that are bundled or called (axe-core MPL-2.0, Pa11y LGPL, MobSF GPL, k6 AGPL); check each against FSL terms, or get advice.
3. Record: decision, date, any dependency to drop, in `docs/adr/` (ask the agent to draft the ADR) or `LICENSE` notes.

## G29 (success criteria)
1. Choose what counts as success for the landing page, e.g. "x% of visitors complete a free check-up".
2. Record the numbers in `docs/research/success-criteria.md`.

## T-13: contact and sign-up target
1. Choose the contact email address and the sign-up service (or a simple form endpoint).
2. Create it and set the env value named in the ticket's notes.
3. Send a test message end to end.
4. Contact email -> `VITE_CONTACT_EMAIL`. Sign-up service and its form-post URL -> `VITE_SIGNUP_URL`; send a test sign-up end to end.
5. Create a GoatCounter site (hosted free tier is non-commercial: check, or self-host) -> `VITE_COUNTER_URL=https://<code>.goatcounter.com/count`.
6. Set all three in the Vercel env AND Render (Docker build arg), then redeploy (build-time values).
7. Replace `packages/wizard/public/og-image.png` with final art (keep 1200x630). Current file is a plain generated placeholder.
8. `PRIVACY.md` does not exist but the landing footer links it: write it, and mention the counter and the email list.

## T-15: landing items only the owner can do
1. Supply real testimonials, or confirm none are shown (marketing copy is not invented).
2. Review the "Could not verify" list in `docs/research/self-checkup-landing.md`; decide whether to do a real-device or real-network pass.
3. After the T-13 contact and sign-up target exists, re-run the command in `docs/TESTING.md` ("Check-up of our own landing page") and add the dated run to the summary.

## G31: release tag (after T-19 is verified)
1. Review CHANGELOG and version 0.1.0.
2. Merge the `ship/wave-3` PR.
3. On `main`: `git tag v0.1.0`, then `git push origin v0.1.0` (owner only; the agent never tags).
4. In GitHub Actions, check "Release build" is green and its "Tag matches the package version" step passed.
5. Confirm the ref resolves: `git ls-remote https://github.com/CJCreator/qa-flow-tester refs/tags/v0.1.0` prints a line.
6. Order: tag BEFORE deploying the wizard. Generated workflows pin `ref: v0.1.0`; until the tag exists they fail at "Get the check-up tool" (ref not found). Old copies of the file that track `main` keep working.

## G46: landing audit tail (T-14)
1. Run an assistive-technology pass (NVDA or VoiceOver) and Lighthouse on the deployed landing page.
2. Default theme: landing is dark unless the visitor picks light; `DESIGN.md` used to say it follows the system. Decide: keep dark or follow system.
3. Per-area links into the sample report need ids on the sections in `packages/core/src/html-report.ts` and a regenerated sample; today each area links to the whole report.
4. When `tests/sample-report-format.test.ts` fails, regenerate `packages/wizard/public/sample-report.html` (landing spec section 11).
5. Set `VITE_WAKE_LIMIT_SECONDS` in Vercel only if Render's wake time changes.

## G13: Playwright export (T-17)
1. Confirm the sign-in env var names (`QA_<ROLE>_USERNAME`, `QA_<ROLE>_PASSWORD`, `QA_<ROLE>_LOGIN_PATH`) and the generic email/password/submit selectors in the generated `global-setup.ts`.
2. Decide whether to publish a stable Playwright version pin for the export (today: core's `playwright` range).

## G16: a11y and security depth (T-22)
1. Decide whether to wire the existing response-header checks (CSP missing, HSTS, nosniff, clickjacking, referrer) into the orchestrator. Today they never run in real Check-ups; wiring them changes the fixture verdict and the benchmark. Needs its own ticket and an ADR note.
2. After /verify-all, run the fixture benchmark (`pnpm benchmark --sites fixture --no-ai`), review false positives from the new checks, calibrate `fixtures/benchmarks/thresholds.json`.
3. CrUX panel stays out (external API); file as a separate ticket.
4. Review the "What this did not check" report section (ADR 0018 consequence; not built here).

## G15: visual baseline polish (T-21)
1. Re-record baselines with update mode to get masking; older baselines keep comparing unmasked (no sidecar). Nothing was rewritten.
2. A baseline taken mid-load (fallback font, unloaded lazy image) may now differ because pages are stabilised before capture; review any new Visual regression findings.
3. After /verify-all, run the benchmark (`pnpm benchmark --sites fixture --no-ai`) as the ticket asks.
4. Look at one real-site report: file size with three images per visual finding, and whether the date/ad rules hid anything real. Add `visualMaskSelectors` or ask for an opt-out if needed.
5. Ticket status (T-21) and the G15 gap row are yours to close.

## Merge and deploy
The agent never pushes, merges or opens a PR. After each wave you review `ship/wave-<n>`, open the PR and merge when satisfied.
