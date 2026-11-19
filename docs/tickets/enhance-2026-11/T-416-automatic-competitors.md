# T-416: Automatic competitors

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | L | core, runner, types | feature | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/competitors/` (new: `discover.ts`, `light-crawl.ts`, `compare.ts`, `index.ts`)
- `packages/runner/src/routes/audit-competitors.ts` (new), `packages/runner/src/routes/index.ts`
- `packages/types/src/website-audit.ts`
- `docs/API.md`, `SECURITY.md` (outbound requests to sites the user did not name)
- tests

**Depends on:** T-398 and T-412.

## Change

Competitors are a step the user starts from the Improved version screen, after the audit. They are not a pipeline stage, so `pipeline.ts` is not touched.

- **Discover:**
  - One AI call with the user's key, given the audit's Page Content summary (business type, location, language, services).
  - It names 3 similar public websites with a one-line reason each. There is no search API.
  - Each address goes through the same public-address checks as an audit start (`safe-net.ts`); private addresses are refused.
  - The user sees the 3 and can remove any of them before the crawl.
- **Light crawl:** the homepage plus up to 10 key pages each, chosen from the menu (pricing, services, about, contact, product).
  - GET only, with the same pacer and robots rules as the audit.
  - No forms, no sign-in. Blocked sites become "not read" with a reason.
  - On the hosted copy, competitor pages count toward the 200-page cap.
- **Compare (deterministic):** per page type, show the sections, calls to action, trust signals, contact options and speed (the browser timing value), side by side with the audited site.

## Tests

- The mock AI names 3 sites; a private address is refused.
- The light crawl reads at most 11 pages per site and honours robots.txt.
- On the hosted copy, the cap includes competitor pages.

## Done when

The tests pass, and an audit of techgramam.com lists 3 competitors with their comparison.
