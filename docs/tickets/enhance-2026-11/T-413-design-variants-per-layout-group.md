# T-413: Design variants per Layout Group

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | L | core, runner, wizard, types | feature | todo |

**Files you may edit (no others):**
- core: `packages/core/src/audit/improve/` (new: `variants.ts`, `brand.ts`, `index.ts`); `packages/core/src/audit/preview/prompt.ts`, `generate.ts`, `template.ts` (generalised from homepage to any page)
- runner: `packages/runner/src/routes/audit-preview.ts` → `audit-improve.ts`
- types: `packages/types/src/website-audit.ts` (`AUDIT_API` rows, variant types)
- wizard: `packages/wizard/src/screens/audit/improved/ImprovedVersionScreen.tsx`
- `docs/API.md`
- tests

**Depends on:** T-412 and T-398 (budget).

## Problem

The preview covers only the homepage, with at most 8 findings (`preview/prompt.ts:2,52`). The prompt asks for "an improved version of one website homepage" (`:143`).

## Change

- **Pages:** the homepage plus one Sample Page per Layout Group, listed on the screen with a tick box on each.
- **Variants:** the user picks 1 to 5 per page.
- **Cost:** before starting, the screen shows the number of AI calls (pages × variants) and an estimated cost from `model-prices.ts`. The calls count toward the AI Request Budget.
- **Brand** (`brand.ts`): the site's logo and main colours come from the stored Page Content and CSS facts, with no new requests to the site. The prompt requires them.
- **Variant styles:** each variant gets a different design direction from a fixed list ("clean", "bold", "trust-first", "content-first", "conversion-first") so the variants actually differ.
- **Reused as is:** sanitizer, claim-word stripping, menu links kept, image inlining through `makeOutboundFetch` (`preview/generate.ts`).
- **Storage:** `audits/<id>/v<n>/improved/<page-key>/<variant>.html`, plus a `variants.json` index.
- **Routes:**
  - `POST /api/audits/:id/improve` (pages and variants)
  - `GET /api/audits/:id/improve` (list)
  - `GET /api/audits/:id/improve/:page/:variant` (the HTML)
- **Language:** the language chosen at the audit's start.

## Tests

- 2 pages × 3 variants make 6 AI calls (mock provider), and store 6 sanitized pages, each carrying the brand colours.
- The estimate equals the calls actually made.

## Done when

The tests pass. On techgramam.com, the screen shows 3 variants for the homepage and each Layout Group.
