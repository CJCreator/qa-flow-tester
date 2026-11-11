# T-367: The "nothing leaves your machine" claim names the AI provider, and PRIVACY.md covers sign-in and saved audits

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | inconsistency | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/faq.ts`
- `packages/wizard/index.html`
- `packages/wizard/src/screens/LandingScreen.tsx`
- `packages/wizard/src/screens/ConnectionScreen.tsx`
- `PRIVACY.md`
- `packages/wizard/tests/privacy-wording.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

The landing page promises more privacy than the tool gives:

- The FAQ "Where does my check-up run, and who can see it?" ends: "To check a site on your own computer or network, run Release check-up yourself, and nothing leaves your machine." (`packages/wizard/src/lib/faq.ts:17`, and word for word in the FAQPage JSON-LD, `packages/wizard/index.html:137`).
- "Where it runs", row "Your own computer": "Everything stays on your machine." (`packages/wizard/src/screens/LandingScreen.tsx:63`).
- The GitHub Actions setup: "Your site, your AI key and the report stay with you." (`packages/wizard/src/screens/ConnectionScreen.tsx:64`).

With AI on (the default), page facts (page titles, element names, visible text, form fields) go into prompts sent to the AI Provider the person chose (ADR 0016, `docs/adr/0016-evidence-redaction.md:8-10`; `plan/ai-planner.ts`, `plan/journeys.ts`). With a free model, `PRIVACY.md:19` itself says the provider "may keep what is sent". So "nothing leaves your machine" is only true when the plan is written without AI.

`PRIVACY.md` also stops at Check-ups. It says nothing about the Google sign-in for owners and Helpers (Firebase Authentication, `screens/audit/saved/firebase-sign-in.ts:3-9`; the runner's session cookie holds the email and Google account id for at most 8 hours, `packages/runner/src/helpers/helper-session.ts:1-14`), Website Audits saved on the hosted copy (Page Content, screenshots, the Shortlist with notes, Shared Links; kept in a Cloud Storage bucket until the owner deletes the audit, ADR 0036), or scheduled Check-ups (ADR 0039). `grep -n -i "firebase\|google sign\|audit\|schedul" PRIVACY.md` finds nothing. And `PRIVACY.md:7` says of a self-hosted copy "Nothing is sent to the project's authors", which is true but leaves out the AI Provider.

## Owner decision (open)

How should the claim read?

- **A. Name the AI Provider, and offer the fully local way (recommended default).** FAQ ending: "To check a site on your own computer or network, run Release check-up yourself. Nothing leaves your machine except what you send to the AI you choose; skip AI to keep everything local." Landing row: "Everything stays on your machine, except what you send to the AI you choose." GitHub Actions: "Your AI key and the report stay in your own repository. Page text goes only to the AI you choose." `PRIVACY.md` gets the sections in the Change below.
- **B. Other wording.** The owner writes the sentences; the files, the `PRIVACY.md` sections and the tests stay as below.

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`.

- `grep -n "nothing leaves your machine" packages/wizard/src/lib/faq.ts packages/wizard/index.html` finds `faq.ts:17` and `index.html:137`.
- `grep -n "Everything stays on your machine" packages/wizard/src/screens/LandingScreen.tsx` finds `:63`.
- `grep -n "stay with you" packages/wizard/src/screens/ConnectionScreen.tsx` finds `:64`.
- `PRIVACY.md` sections today: "Two ways to use it", "Free AI models", "What we do not do", "Your choices", "Questions", "Changes" (39 lines).

## Change

1. `faq.ts:17`: replace the last sentence of the answer with option A's FAQ ending. `index.html:137`: the same text in the JSON-LD `"text"`, so the two stay word for word the same (the comment at `faq.ts:1-5` asks for that).
2. `LandingScreen.tsx:63`: `where: 'Everything stays on your machine, except what you send to the AI you choose.'`.
3. `ConnectionScreen.tsx:64`: replace "Your site, your AI key and the report stay with you." with "Your AI key and the report stay in your own repository. Page text goes only to the AI you choose." Do not add a command name (`tests/sources-screens.test.tsx:380-384` keeps `pnpm start` out of this screen).
4. `PRIVACY.md`:
   - `:7` (own copy): after "Nothing is sent to the project's authors." add "If you use AI, the page text the plan needs is sent to the AI Provider you choose (see Free AI models). Planning without AI keeps everything on your machine."
   - New section "## Signing in with Google (owners and Helpers)" after the shared-copy list: Google sign-in runs through Firebase Authentication in a pop-up; the page hands the sign-in token to the runner once and keeps nothing in the browser's storage; the runner sets one cookie holding the Google account's email and account id, signed, for at most 8 hours; a Helper's access to a Website Audit is stored with that audit.
   - New section "## Website Audits on the shared online copy": what is kept (Page Content, screenshots, Audit Documents and edits, the Shortlist entry and its notes, Shared Links, Helper grants); where (one Google Cloud Storage bucket in `us-central1` that only the runner can reach); how long (until the owner deletes the Website Audit; deleting removes all of it and cannot be undone; a Shared Link expires 30 days after it is made and can be revoked).
   - New section "## Scheduled Check-ups": the schedule list (each address, its hour and options) is stored in the same bucket until the schedule is deleted; scheduled Check-ups run without AI and only look (read-only, ADR 0039). Do not say who may manage schedules on the shared copy: that is being changed by T-298.
   - Keep sentences short and plain. Do not use claim words (ADR 0018: no "secure", "safe", "compliant").
5. `pnpm exec prettier --write` on the changed source files and `PRIVACY.md`.

## Tests

New file `packages/wizard/tests/privacy-wording.test.ts` (unit; reads files as text):

- `'no claim that nothing leaves the machine without naming the AI'`: in `src/lib/faq.ts`, `index.html`, `src/screens/LandingScreen.tsx` and `src/screens/ConnectionScreen.tsx`, every line matching `/nothing leaves your machine|everything stays on your machine|stay with you/i` also contains `AI` (each of these texts sits on one source line).
- `'the FAQ structured data matches the visible FAQ'`: parse the `application/ld+json` blocks of `index.html`, find the `FAQPage`, and expect each `HOME_FAQ` answer to equal the JSON-LD answer with the same question (import `HOME_FAQ` from `../src/lib/faq`).
- `'PRIVACY.md covers Google sign-in, Website Audits and schedules'`: `PRIVACY.md` (repo root) contains the headings `## Signing in with Google (owners and Helpers)`, `## Website Audits on the shared online copy` and `## Scheduled Check-ups`, and the words `30 days` and `8 hours`.

Run: `pnpm exec vitest run packages/wizard/tests/privacy-wording.test.ts packages/wizard/tests/sources-screens.test.tsx packages/wizard/tests/landing-audit.test.tsx packages/wizard/tests/no-banned-words.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -rn "nothing leaves your machine" packages/wizard/src packages/wizard/index.html` shows only sentences that name the AI.
- [ ] `grep -n "^## " PRIVACY.md` lists the three new sections.
- [ ] The new test and the wizard unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M46 (audit of 11 Nov 2026 on `d225418`).
- The optional landing counter (`lib/counter.ts`, off unless `VITE_COUNTER_URL` is set at build time) is not set by `deploy.yml`, so "We do not add analytics or tracking" (`PRIVACY.md:24`) still holds for the hosted site. If the owner turns the counter on later, that line must change.
- Once T-298 settles who owns a schedule on the shared copy, add one sentence about it to the "Scheduled Check-ups" section.
- `index.html` is not edited by T-366 (it fills `%ORIGIN%` at build time), so the two do not clash.
