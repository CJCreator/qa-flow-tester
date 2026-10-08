# T-13: Analytics counter, PNG share image, contact and sign-up

## Goal
Analytics counter, PNG share image, contact and sign-up.

## Gaps covered
G29, G40, G41, G42

## In scope
`packages/wizard` landing, static assets, docs.

## Out of scope
Choosing success metrics (HUMAN).

## Acceptance criteria
- [ ] A privacy-respecting, cookie-free counter records landing view, start-check-up click and completed check-up; reading it is documented. Provider choice noted in the ticket at build time.
- [ ] `og:image` and `twitter:image` point to a 1200x630 PNG; the SVG is no longer referenced.
- [ ] Landing has a contact link and an email sign-up or feedback control; the target address or service is an env placeholder listed in HUMAN_TODO.
- [ ] Wording follows `CONTEXT.md` and the landing spec.
- [ ] Wizard bundle has no Node-only imports.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm --filter @qa/wizard build
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Third-party script weight; keep it small and optional.

## Notes
Provider chosen: GoatCounter (pixel/fetch only, no script). See `docs/LANDING_MEASUREMENT.md`.
Env: `VITE_COUNTER_URL`, `VITE_CONTACT_EMAIL`, `VITE_SIGNUP_URL` (build-time; Vercel and Render).

## Status
built (tests written, not run)
