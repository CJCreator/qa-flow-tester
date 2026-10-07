# Human to-do

Things only the owner can do. The agents do not attempt these. After each, record the result where stated and tell the agent so the gap row can be closed.

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
1. Hit the beta from two different browsers; confirm per-visitor and daily limits trigger with a clear message.
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

## G31: release tag (after T-19 is verified)
1. Review CHANGELOG and version 0.1.0.
2. On `main` after your merge: `git tag v0.1.0` and push the tag yourself.
3. Check the release workflow ran; record the image or release URL.

## Merge and deploy
The agent never pushes, merges or opens a PR. After each wave you review `ship/wave-<n>`, open the PR and merge when satisfied.
