# T-181: Landing page: restore the free-beta pricing section

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | todo |

**Files you may edit (no others):**
- `packages/wizard/src/screens/LandingScreen.tsx`
- `docs/GTM_AND_PRICING.md`
- `packages/wizard/tests/landing-audit.test.tsx`

**Do not build in parallel with:** none.

## Problem

Commit `df1a17f` replaced the pricing section with three paid-tier cards ($0 Community, $49 Pro Continuous, $199 Team & Enterprise). No billing exists, both paid buttons lead to the free form, and the features listed (hosted execution, SSO, VPC peering, dedicated support) are not built. The rest of the product still says the tool is free during the beta: the hero badge, `lib/faq.ts`, the JSON-LD in `index.html` (`"price":"0"`), `public/llms.txt` and `lib/title.ts`. A visitor reads two contradicting offers on one page.

Owner decision (10 Nov 2026): restore the previous free-beta copy. The tiers are not live.

## Current code

`packages/wizard/src/screens/LandingScreen.tsx:383-461` (branch `worktree-audit-cleanup`). The block starts at:

```tsx
        <section id="pricing" aria-labelledby="pricing-title" className={`${SECTION} scroll-mt-16`}>
          <SectionTitle
            id="pricing-title"
            lead="Free check-ups for developers and open-source teams, with transparent hosted tiers for continuous release monitoring."
          >
            Transparent, developer-first pricing
          </SectionTitle>
          <p className="mt-3 max-w-prose text-ink-soft leading-relaxed">
            The AI that writes your plan uses your own AI key (a free key works, or a paid key from your provider), or
            you can skip AI and let fixed deterministic rules write the entire plan.
          </p>

          <div className="mt-8 grid gap-6 sm:grid-cols-3">
```

and the three-card grid ends just before this line (currently line 462), which must stay:

```tsx
          <div
            tabIndex={0}
            role="region"
            aria-label="Where it runs"
```

`docs/GTM_AND_PRICING.md:3-4`:

```md
**Document Reference:** G28, G30, G43, G44  
**Status:** Approved & Active
```

## Change

1. In `LandingScreen.tsx`, replace everything from `<SectionTitle` (line 384) up to, but not including, the `<div tabIndex={0} role="region" aria-label="Where it runs"` line with exactly:

```tsx
          <SectionTitle
            id="pricing-title"
            lead="Free check-ups, nothing to pay today. Paid plans are planned for heavier use, and we’ll say so well before anything is charged."
          >
            Free while we’re in beta
          </SectionTitle>
          <p className="mt-3 max-w-prose text-ink-soft leading-relaxed">
            The AI that writes your plan uses your own AI key (a free one works, or a paid one from the service you
            pick), or you can skip AI and let fixed rules write the plan.
          </p>
```

   This deletes the whole `<div className="mt-8 grid gap-6 sm:grid-cols-3">…</div>` grid (the three cards). Keep the `<section id="pricing" …>` opening line and everything after the grid.
2. Do not remove `const contact = contactLinks();` (line 255): the footer still uses it.
3. In `docs/GTM_AND_PRICING.md`, change line 4 to:

```md
**Status:** Draft. Not live: no paid tier is built or charged. The product is free during the beta.
```

## Tests

Edit `packages/wizard/tests/landing-audit.test.tsx` (it already renders `LandingScreen` with `renderToStaticMarkup`; copy the render call from its first test). Add one case:

- name: `the pricing section offers no paid tier`
- render the landing page to a string `html`
- `expect(html).toContain('Free while we’re in beta')`
- `expect(html).not.toContain('$49')`
- `expect(html).not.toContain('$199')`
- `expect(html).not.toContain('Start Pro check-up')`

Run: `pnpm exec vitest run packages/wizard/tests/landing-audit.test.tsx packages/wizard/tests/style-tokens.test.ts packages/wizard/tests/no-banned-words.test.ts`

## Done when

- [ ] The pricing section shows "Free while we’re in beta" and no price cards.
- [ ] `$49`, `$199`, "Start Pro check-up", "VPC peering" appear nowhere in `LandingScreen.tsx`.
- [ ] `docs/GTM_AND_PRICING.md` says Draft, not live.
- [ ] The three test files above pass.

## Notes

- Do not touch `lib/faq.ts`, `index.html`, `public/llms.txt`: they already say free during the beta.
- Do not delete `docs/GTM_AND_PRICING.md`; only its status line changes.
- The apostrophes in the copy are the typographic `’` (U+2019), as in the rest of the file.
