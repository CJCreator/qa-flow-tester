# T-319: The Playwright export types the Role password only into password fields

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/playwright-export.ts`
- `packages/core/tests/playwright-export.test.ts`

**Do not build in parallel with:** T-243 (edits `playwright-export.test.ts`).

## Problem

The Playwright export turns each Plan step into test code. For a `fill` step it decides whether the value is the Role's password, and if so writes `process.env["QA_<ROLE>_PASSWORD"]!` instead of the Plan's value (`packages/core/src/plan/playwright-export.ts:126-131`). The test is a loose substring match on the selector and the step name:

```ts
const SECRET_NAME = /pass(word)?|secret|token|otp|card|cvv/i;
```

(`:34`). "Passport number", "Passenger name", "Gift card message", "Card holder", "Coupon token" and "OTP" fields all match. The exported test then types the Role's real password into those fields, and a form that saves them (a booking with a passport field, a gift message) sends the password to the site as ordinary data. The test also fails, because the field gets the wrong value.

The export must still keep a password out of the code: the existing tests use `#password` with a literal value and a step named "Fill password" on `#pw`, and expect the literal never to appear (`packages/core/tests/playwright-export.test.ts:215`, `:433`, `:470`).

## Current code

Branch from `main`. `packages/core/src/plan/playwright-export.ts` (`grep -n "SECRET_NAME" packages/core/src/plan/playwright-export.ts`):

```ts
const SECRET_NAME = /pass(word)?|secret|token|otp|card|cvv/i;
...
      if (/\{\{\s*username\s*\}\}/i.test(value)) expr = `process.env[${JSON.stringify(`QA_${envOf(role)}_USERNAME`)}]!`;
      else if (/\{\{\s*password\s*\}\}/i.test(value) || SECRET_NAME.test(selector) || SECRET_NAME.test(step.name))
        expr = `process.env[${JSON.stringify(`QA_${envOf(role)}_PASSWORD`)}]!`;
      else expr = q(value);
```

## Change

1. Replace `SECRET_NAME` with a word-based check:

   ```ts
   /** Words that name a password field. "Passport", "Passenger" and "Gift card" are not among them. */
   const PASSWORD_WORDS = new Set(['password', 'passwd', 'pwd', 'pw', 'passcode', 'passphrase']);

   /**
    * True for a field that takes the Role's password: an `input[type=password]` selector, or a selector or step name
    * with a password word in it (`#newPassword`, `confirm_password`, `#pw`, "Fill password").
    */
   export function isPasswordField(selector: string, name: string): boolean {
     if (/type\s*=\s*["']?password\b/i.test(selector)) return true;
     const words = `${selector} ${name}`
       .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
       .toLowerCase()
       .split(/[^a-z0-9]+/);
     return words.some((w) => PASSWORD_WORDS.has(w) || (/pass(word|wd)/.test(w) && !w.includes('passwordless')));
   }
   ```

2. In `mapStep`'s `fill` case: `else if (/\{\{\s*password\s*\}\}/i.test(value) || isPasswordField(selector, step.name))`. Every other field gets its Plan value through `q(value)`, as any other field does.
3. Run `pnpm exec prettier --write packages/core/src/plan/playwright-export.ts packages/core/tests/playwright-export.test.ts`, then `pnpm build`.

## Tests

`packages/core/tests/playwright-export.test.ts`, new `describe('isPasswordField')`:

- `it.each` true: `['#password', '']`, `['#pw', '']`, `['input[type="password"]', '']`, `["input[type=password]", '']`, `['[name=confirm_password]', '']`, `['#newPassword', '']`, `['#userpassword', '']`, `['#x', 'Fill password']`, `['#x', 'Enter passcode']`.
- `it.each` false: `['#passport', '']`, `['#x', 'Fill passport number']`, `['#passengerName', '']`, `['#gift-card-message', 'Gift card message']`, `['#card-number', 'Card number']`, `['#otp', 'One-time code']`, `['#coupon-token', '']`, `['#email', 'Email for passwordless sign-in']`.

And one export case: a Role test with steps `{ action: 'fill', selector: '#passport', value: 'X1234567', name: 'Fill passport number' }` and `{ action: 'fill', selector: '#password', value: 'pw-FAKE-123', name: 'Fill password' }`. The spec file contains `.fill("X1234567")` and `process.env["QA_ADMIN_PASSWORD"]!` once, and does not contain `pw-FAKE-123`.

The existing cases at `:215` and `:433`/`:470` keep passing unchanged.

Run: `pnpm exec vitest run packages/core/tests/playwright-export.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "SECRET_NAME" packages/core/src/plan/playwright-export.ts` prints nothing.
- [ ] `grep -n "isPasswordField(selector, step.name)" packages/core/src/plan/playwright-export.ts` finds the `fill` case.
- [ ] The new and existing export tests pass; the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding L17 (part) (audit of 11 Nov 2026 on `d225418`).
- Behaviour change to expect: fields named token, OTP, card or CVV now get their Plan value in the export, like any other field. Plans hold test data there; sign-in values never reach a Plan (placeholders, ADR 0016), so no real secret is written that was not already in the Plan.
- The other L17 parts are T-313 (unknown AI provider names) and T-320 (address classifier).
