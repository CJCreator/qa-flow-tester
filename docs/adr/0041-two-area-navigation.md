# 0041: Two-Area Navigation

Status: Accepted, 2026-11-05 (UI redesign, Phase 1 plan "Navigation" approved by the owner). Builds on the Certificate design system (`packages/wizard/DESIGN.md`, "Concept: a check-up"). Routes are unchanged ([0037](0037-route-access-levels.md) still applies).

## Context
The app holds two products: the Check-up (Release check-up) and the Website Audit ([0033](0033-website-audit-entry-point.md)). The top bar listed both in one flat row (New check-up, Past check-ups, Website Audit, Settings), and a "More" menu mixed the rest of both (Visual Baselines, Compare with another site, Shortlist, Website Audit settings). Nothing showed which product a screen belonged to. A second row held either the step bar or a breadcrumb whose first crumb, "Home", went to the marketing page and so left the app. On phones, Menu listed eight places with no grouping.

## Decision
- **Top bar:** the brand (the mark, cobalt) links to `/check`. Two areas: **Check-ups** (`/check`; current on new, scan, plan, testing, reports, report, visibility, baselines, benchmark; it keeps the in-progress dot) and **Website Audits** (`/audits`; current on every audit route, hidden on the shared beta copy). **Settings** sits on the right. No "More" menu. The developer shortcut buttons (Commands, ?) stay, shown only with a fine pointer from 640px.
- **Area row (`AreaNav`)** under the top bar, the same width and gutter as the step bar:
  - Check-ups: New check-up, Past check-ups, Visual baselines, Compare sites.
  - Website Audits: Audits (current on the list, the start form and every per-audit screen), Shortlist, Audit settings.
  - None on the landing page, Settings, Helper sign-in or Page not found.
- **Step bar** only on scan, plan, testing and report; it replaces the area row there. The new check-up screen shows the Check-ups row.
- **No breadcrumb row.** Deep audit pages carry their own back link and tabs. The app never links to the marketing page from inside.
- **Phones:** Menu (reads Close when open, `aria-expanded`, Esc closes and returns focus) lists the same places grouped under Check-ups, Website Audits (not on beta) and Settings.
- **Command palette** uses the same names and lists only keys that something handles.

## Consequences
- No route or address changes, so no redirects. `tests/router.test.ts` pins every one of the 23 route kinds to the screen it opened before.
- `CRUMB_LABELS`, `crumbTrail` and `navItems` are gone (only tests used them). The area model lives in `components/AreaNav.tsx` and feeds the top bar, the row and the phone menu.
- Labels change: "Visual Baselines" is "Visual baselines", "Compare with another site" in navigation is "Compare sites", "Website Audit settings" is "Audit settings". Screen titles may keep their longer names.
- A new place in either area is added once, in `AreaNav.tsx`.
