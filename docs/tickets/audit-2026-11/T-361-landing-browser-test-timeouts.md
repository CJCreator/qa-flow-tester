# T-361: The landing page browser test finds the theme button again (3 timeouts)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | broken | todo |

**Files you may edit (no others):**

- `packages/wizard/tests/landing-audit-browser.test.ts`

**Do not build in parallel with:** none.

## Problem

Three tests in the browser tier fail on `main` (local run on 11 Nov, Nightly E2E on 9 and 10 Nov), each with `TimeoutError` after 30000 ms on `locator.click` or `locator.getAttribute`:

- "Light theme button sets data-theme=light on `<html>`, survives reload, switching back removes it"
- "app screens (/check) stay dark"
- "landing has no serious or critical axe violations (light)"

The cause is the test, not the page. Commit `2902365` ("feat(wizard): Certificate design tokens replace Blueprint", 5 Nov) changed the theme model on purpose (`packages/wizard/DESIGN.md:156-163`, Theming):

1. Light is the default. With no saved choice the page follows the device, and `data-theme` is absent.
2. The toggle is now labelled **Dark theme**, and `aria-pressed` means "dark is on screen" (`packages/wizard/src/screens/LandingScreen.tsx:93-112`). The test still looks for `getByRole('button', { name: 'Light theme' })`, which no longer exists, so every click waits 30 s.
3. A saved choice now applies on every page, the app screens included: `main.tsx:15` calls `applyTheme(readTheme(), ...)` on every route, and the toggle's old cleanup that forced dark on unmount was removed. So "app screens stay dark" is no longer the rule.
4. Pressing the toggle twice saves `light`, so `data-theme` becomes `light`, not absent.

The same commit updated the unit test (`landing-audit.test.tsx`, "has a Dark theme button that starts unpressed") but not this browser test, which only runs in the nightly browser tier, so the change merged green.

A fourth test hides a gap: "landing has no serious or critical axe violations (dark)" still passes, but it now checks the **light** palette. It asserts `data-theme` is null and runs axe, and Playwright's context defaults to `colorScheme: 'light'`. The dark palette has had no axe pass in a browser since 5 Nov.

## Current code

Branch from `main`.

`grep -n "Light theme" packages/wizard/tests/landing-audit-browser.test.ts` finds six uses, for example:

```ts
  it('Light theme button sets data-theme=light on <html>, survives reload, switching back removes it', async () => {
    await openLanding();
    expect(await theme()).toBeNull();
    const toggle = page.getByRole('button', { name: 'Light theme' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
```

`grep -n "function ThemeToggle" -A20 packages/wizard/src/screens/LandingScreen.tsx`:

```tsx
    <button
      type="button"
      aria-pressed={effectiveTheme(theme) === 'dark'}
      ...
    >
      Dark theme
    </button>
```

`packages/wizard/src/lib/theme.ts:11`: `export const THEME_KEY = 'qa-color-theme';`

## Change

Only the test changes. Do not change the page, the theme module or the palette.

1. Import the key: `import { THEME_KEY } from '../src/lib/theme';`. Add `beforeEach` to the vitest import.
2. Add a helper next to `theme`: `const darkToggle = (on: Page = page) => on.getByRole('button', { name: 'Dark theme' });`.
3. Add a `beforeEach` inside the `describe`, so no test depends on the choice another test saved (they share one context):

```ts
  beforeEach(async () => {
    await page.goto(`${toolUrl}/`);
    await page.evaluate((key) => localStorage.removeItem(key), THEME_KEY);
  });
```

4. Replace the first test with "Dark theme button saves dark on `<html>`, survives reload, and pressing it again saves light":
   - `openLanding()`; `theme()` is null; `darkToggle()` has `aria-pressed="false"`.
   - Click it: `theme()` is `'dark'`, `aria-pressed` is `'true'`.
   - Reload and wait for the h1: `theme()` is still `'dark'`.
   - Click `darkToggle()` again: `theme()` is `'light'`. Reload: still `'light'`.
5. Add "follows a dark device until a choice is saved": `await page.emulateMedia({ colorScheme: 'dark' })`, then in `try`: `openLanding()`; `theme()` is null; `darkToggle()` has `aria-pressed="true"`; click it; `theme()` is `'light'`. In `finally`: `await page.emulateMedia({ colorScheme: 'light' })`.
6. Replace "app screens (/check) stay dark" with "app screens (/check) use the theme chosen on the landing page": `openLanding()`, click `darkToggle()`, `theme()` is `'dark'`; `page.goto(\`${toolUrl}/check\`)`, wait for the first h1 (as now); `theme()` is still `'dark'`.
7. Rename the axe tests and make each check the palette its name says:
   - "landing has no serious or critical axe violations (light, the default)": `openLanding()`, `theme()` is null, `seriousViolations()` is `[]`.
   - "landing has no serious or critical axe violations (dark)": `openLanding()`, click `darkToggle()`, `theme()` is `'dark'`, `seriousViolations()` is `[]`.
   - Remove the trailing "put it back" clicks: `beforeEach` resets the choice now.
8. Leave the 375 px test and the "asks nobody but the tool itself" test as they are.
9. Update the file's top comment: "the light/dark toggle (light by default)".
10. `pnpm exec prettier --write packages/wizard/tests/landing-audit-browser.test.ts`.

## Tests

The file is already in `BROWSER_TESTS` (`vitest.workspace.ts`, `wizard: ['landing-audit-browser']`), so it launches Chromium and runs in the browser tier only.

Run: `pnpm exec vitest run --project browser packages/wizard/tests/landing-audit-browser.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

If the new dark axe test reports a real serious or critical violation (the dark palette has not been checked in a browser since 5 Nov), do not change colours here. Record the violation in the ticket's Notes and report it, so it gets its own ticket.

## Done when

- [ ] `grep -n "Light theme" packages/wizard/tests/landing-audit-browser.test.ts` finds nothing.
- [ ] `grep -n "emulateMedia" packages/wizard/tests/landing-audit-browser.test.ts` finds the dark-device test.
- [ ] The browser test file passes, including the dark axe test with `theme()` equal to `'dark'`.
- [ ] `pnpm build` passes.

## Notes

- Audit finding H12 (part) (audit of 11 Nov 2026 on `d225418`). The other part of H12, the refusal rule browser tests, is T-337.
- Cause found with `git log -S"Dark theme" -- packages/wizard/src` and `git show 2902365 -- packages/wizard/src/screens/LandingScreen.tsx`. `df7b9d2` (same day) then renamed the storage key to `qa-color-theme`.
- Out of scope: running browser tests on pull requests that touch wizard code, which would have caught this on 5 Nov. That is T-379.
