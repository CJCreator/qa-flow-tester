# T-373: `VITE_SIGNUP_URL` either shows its email-updates control or goes away

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | wizard | dead-code | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/contact.ts`
- `packages/wizard/tests/contact.test.ts`
- `packages/runner/tests/config-docs.test.ts`
- `packages/runner/Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `docs/CONFIGURATION.md`
- `docs/DEPLOYMENT.md`
- `CHANGELOG.md`

**Do not build in parallel with:** T-277, T-376, T-377, T-383 (all edit `Dockerfile`); T-376, T-383 (all edit `DEPLOYMENT.md`); T-382 (edits `docker-compose.yml`); T-301 (edits `.env.example`); T-300, T-301, T-302, T-313 (all edit `CONFIGURATION.md`); T-343 (edits `CHANGELOG.md`).

## Problem

`VITE_SIGNUP_URL` is documented as the "https form-post endpoint for the email-updates control" (`docs/CONFIGURATION.md:198`, `.env.example:110-111`, `docs/DEPLOYMENT.md:55-56`, `CHANGELOG.md:61`) and is wired through as a Docker build argument (`packages/runner/Dockerfile:27`, `:30`; `docker-compose.yml:9`). The wizard reads it and validates it into `signupAction` (`packages/wizard/src/lib/contact.ts:29-51`), but nothing renders an email-updates control: the landing page uses only `contact.contactHref` and `contact.feedbackHref` (`screens/LandingScreen.tsx:520`, `:529`), and `grep -rn "signupAction" packages/wizard/src` finds only `contact.ts`.

So an owner who sets the variable, as the docs say, gets nothing and no warning. It is configuration and code that do nothing.

## Owner decision (open)

What should happen to the email-updates setting?

- **A. Remove it (recommended default).** Delete `signupUrl`, `signupAction` and `validSignupUrl` from `contact.ts`, the build argument, the compose line, the example line and the docs rows, and list it as retired so it cannot come back unnoticed. This follows the standing rule to delete unused code. If an email list is wanted later, it comes back with its control and a test.
- **B. Render the control.** Add a small form to the landing footer that posts an email address to `signupAction` when it is set (and the "Send feedback" link when it is not), with a label, a privacy line, and a unit test of the markup. Needs wording, a `PRIVACY.md` line (T-367) and a change to the static site's CSP: `form-action 'self'` (`site/nginx.conf:23`, report-only today, enforced by T-304) would block a post to a third-party endpoint.

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`.

`packages/wizard/src/lib/contact.ts:8-19` and `:41-53`:

```ts
export interface ContactEnv {
  email?: string;
  signupUrl?: string;
}

export interface ContactLinks {
  contactHref: string;
  contactIsEmail: boolean;
  /** Form-post endpoint for the email control, or null (then the page offers a feedback link). */
  signupAction: string | null;
  feedbackHref: string;
}
...
export function contactLinks(
  env: ContactEnv = {
    email: import.meta.env.VITE_CONTACT_EMAIL as string | undefined,
    signupUrl: import.meta.env.VITE_SIGNUP_URL as string | undefined,
  }
): ContactLinks {
```

`grep -rn "VITE_SIGNUP_URL" --include=* . | grep -v node_modules` lists `.env.example:111`, `docker-compose.yml:9`, `docs/CONFIGURATION.md:198`, `docs/DEPLOYMENT.md:56`, `CHANGELOG.md:61`, `packages/runner/Dockerfile:27,30` and `contact.ts:44`.

`packages/runner/tests/config-docs.test.ts:14`: `const RETIRED = ['QA_CHECKUP_PORT', 'HUB_API_URL'];` (retired names must not appear in `.env.example`, `package.json`, `scripts/start.mjs`, `scripts/smoke.mjs` or any package source).

## Change

Option A:

1. `contact.ts`: remove `signupUrl` from `ContactEnv`, `signupAction` from `ContactLinks`, the `validSignupUrl` function and the `signupUrl:` line of the default env. Change the file's first comment to "Contact targets for the landing page (T-13). Public values set at build time."
2. `tests/contact.test.ts`: remove the `signupAction` assertion in the first test and the whole "accepts only an https sign-up endpoint without credentials" test.
3. `packages/runner/Dockerfile`: remove `ARG VITE_SIGNUP_URL=` (`:27`) and the `VITE_SIGNUP_URL=$VITE_SIGNUP_URL` line of the `ENV` (`:30`); end the `ENV` at `VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL` (drop the trailing backslash).
4. `docker-compose.yml:9`: remove the `VITE_SIGNUP_URL` build arg.
5. `.env.example:110-111`: remove the comment line and `# VITE_SIGNUP_URL=`.
6. `docs/CONFIGURATION.md:198`: remove the row. `docs/DEPLOYMENT.md:55-56`: "The two `VITE_COUNTER_URL` and `VITE_CONTACT_EMAIL` build args set the landing values." Then `pnpm exec prettier --write docs/CONFIGURATION.md docs/DEPLOYMENT.md`.
7. `CHANGELOG.md`, under `## [Unreleased]` → `### Removed`: "- `VITE_SIGNUP_URL`: it fed an email-updates control that was never built (T-373)". Leave the old "Added" line at `:61` as history.
8. `config-docs.test.ts:14`: add `'VITE_SIGNUP_URL'` to `RETIRED`.

## Tests

- `packages/wizard/tests/contact.test.ts`: the remaining tests still pass; add `expect(Object.keys(contactLinks({}))).toEqual(['contactHref', 'contactIsEmail', 'feedbackHref'])`.
- `packages/runner/tests/config-docs.test.ts`: the `RETIRED` test now also proves `VITE_SIGNUP_URL` is gone from `.env.example`, the scripts and every package source; the `.env.example` vs `CONFIGURATION.md` tests still pass.

Run: `pnpm exec vitest run packages/wizard/tests/contact.test.ts packages/runner/tests/config-docs.test.ts packages/wizard/tests/landing-audit.test.tsx`, then `pnpm exec vitest run --project unit packages/wizard/tests packages/runner/tests/config-docs.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -rn "VITE_SIGNUP_URL\|signupAction\|signupUrl" --include=*.ts --include=*.tsx --include=*.md --include=*.yml --include=Dockerfile --include=.env.example . | grep -v node_modules | grep -v docs/tickets` finds only `CHANGELOG.md` (the old Added line and the new Removed line) and `config-docs.test.ts` (`RETIRED`).
- [ ] The two test files and the wizard unit tests pass; `pnpm build` passes.

## Notes

- Audit finding L13 (part) (audit of 11 Nov 2026 on `d225418`).
- `packages/runner/Dockerfile` is also edited by T-277 and T-377, and `docker-compose.yml` by T-382. T-277's proposed Dockerfile still lists `VITE_SIGNUP_URL`; whichever of T-277 and this ticket lands second removes it there.
- Under option B the file list changes: `LandingScreen.tsx`, a new markup test, `PRIVACY.md` and `site/nginx.conf` (`form-action`) instead of the removals.
