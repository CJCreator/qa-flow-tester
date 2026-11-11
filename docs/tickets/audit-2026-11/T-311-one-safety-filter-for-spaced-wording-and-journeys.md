# T-311: One Safety Filter that reads spaced wording, applied to AI journeys too

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/discovery/action-words.ts` (new)
- `packages/core/src/discovery/safety-filter.ts`
- `packages/core/src/discovery/deterministic-spider.ts`
- `packages/core/src/live-site.ts`
- `packages/core/src/ai/providers/mock.ts`
- `packages/core/src/discovery/test-planner.ts`
- `packages/core/tests/action-words.test.ts` (new)
- `packages/core/tests/journey-sensitive-steps.test.ts` (new)

**Do not build in parallel with:** T-310 (edits `test-planner.ts`).

## Problem

ADR 0003 promises that the AI never presses a payment, deletion or messaging control without a person's say-so: the Safety Filter is deterministic, and what it catches becomes a Plan Review question whose safe answer is "Don't press it". The filter misses common wording:

- `SafetyFilter.isSensitive` (`packages/core/src/discovery/safety-filter.ts:30`, `:42`, `:54`) only knows the hyphenated forms of two-word actions: `cancel-account`, `buy-now`, `credit-card`, `send-email`, `send-sms`. A button that says "Send email" or "Cancel account" is not caught (`\bsend-email\b` never matches a space). "Place order", "Close account", "Deactivate", "Transfer", "Withdraw", "Donate" and "Upgrade" are in no list. Selectors such as `#placeOrderBtn` are not split into words either.
- Four separate word lists disagree: the Safety Filter, `RISKY_TO_CLICK` (`packages/core/src/discovery/deterministic-spider.ts:197-199`, what the Spider never clicks while exploring), `CHANGES_SOMETHING` (`packages/core/src/live-site.ts:109-111`, what makes a journey need a Test Copy) and the test AI's own list (`packages/core/src/ai/providers/mock.ts:38`).
- AI journeys are only checked against what the Spider flagged. `TestPlanner` drops a step only when its selector was answered "skip" in a Spider question (`packages/core/src/discovery/test-planner.ts:43-49`, `:76-81`); the Plan validator checks that selectors exist, not what they do (`packages/core/src/discovery/plan-validator.ts:106-151`). The Spider only asks about buttons and links (`deterministic-spider.ts:1262-1270`), so a journey step on a control the Spider did not classify, or whose wording the filter missed, is pressed on a Test Copy with no question.

## Current code

Branch from `main`.

`packages/core/src/discovery/safety-filter.ts` (`grep -n "Regex = " packages/core/src/discovery/safety-filter.ts`):

```ts
    const deleteRegex = /\b(delete|remove|destroy|purge|erase|drop|truncate|cancel-account)\b/i;
    const paymentRegex = /\b(pay|payment|charge|checkout|purchase|subscribe|buy-now|credit-card|invoice-pay)\b/i;
    const commsRegex = /\b(send-email|email-blast|notify-users|broadcast|send-sms)\b/i;
```

`packages/core/src/discovery/deterministic-spider.ts` (`grep -n "export const RISKY_TO_CLICK" -A 1 packages/core/src/discovery/deterministic-spider.ts`), a substring match (no word boundaries, so "Display" counts as "pay"):

```ts
export const RISKY_TO_CLICK =
  /reset|delete|remove|destroy|clear|cancel|pay|purchase|buy|place order|subscribe|send|submit|finish|confirm|save|apply|upload|download|print|share|invite|deactivate|close/i;
```

It is used in this file (`grep -n "RISKY_TO_CLICK.test" packages/core/src/discovery/deterministic-spider.ts`) and imported by `discovery/page-sweep.ts` and `plan/ai-planner.ts`, all as `RISKY_TO_CLICK.test(el.name)`.

`packages/core/src/live-site.ts` (`grep -n "const CHANGES_SOMETHING" -A 1 packages/core/src/live-site.ts`):

```ts
const CHANGES_SOMETHING =
  /\b(save|submit|send|delete|remove|pay|buy|purchase|order|subscribe|register|sign ?up|create|publish|comment|confirm|finish|upload|invite|reserve|book now|add to (?:cart|basket|bag)|check ?out|place order|update)\b/i;
```

`packages/core/src/ai/providers/mock.ts` (`grep -n "trigger/i" packages/core/src/ai/providers/mock.ts`):

```ts
              !/delete|remove|pay|buy|sign ?out|log ?out|reset|trigger/i.test(c.name)
```

## Change

1. New file `packages/core/src/discovery/action-words.ts`: one vocabulary, three questions.

```ts
import type { SensitiveAction } from '@qa/types';

/**
 * Wording is matched on normalised text: camelCase split, lower case, every run of anything that is not a
 * letter or digit becomes one space. "Buy-Now", "buy_now", "BuyNow" and "buy  now" all read "buy now".
 */
export function actionText(...parts: string[]): string {
  return parts
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Phrases in normalised words; `(x )?` marks an optional word.
const DELETION = ['delete', 'remove', 'destroy', 'purge', 'erase', 'drop', 'truncate', 'wipe', 'deactivate', 'terminate',
  'revoke', 'unsubscribe', '(cancel|close) (my )?account', 'cancel (my )?(subscription|membership|plan)'];
const PAYMENT = ['pay', 'pay now', 'payment', 'charge', 'checkout', 'purchase', 'subscribe', 'buy', 'credit card',
  'place (my )?order', 'order now', 'reorder', '(confirm|complete|submit) (my )?order', 'donate', 'transfer',
  'withdraw', 'top up', 'upgrade', 'invoice pay'];
const MESSAGING = ['(re)?send (an )?(email|e mail|sms|text|message|invite|invitation|code)', 'resend', 'email blast',
  'notify (all )?users', 'broadcast', 'invite'];
/** Changes data but is not a Sensitive Action: a journey with it needs a Test Copy (today's CHANGES_SOMETHING). */
const CHANGES = ['save', 'submit', 'send', 'order', 'register', 'sign up', 'create', 'publish', 'comment', 'confirm',
  'finish', 'upload', 'reserve', 'book now', 'add to (cart|basket|bag)', 'check out', 'update'];
/** Today's RISKY_TO_CLICK words. Matched anywhere in the text, as today, so "Display" still counts as "pay". */
const NOT_WHILE_EXPLORING = ['reset', 'delete', 'remove', 'destroy', 'clear', 'cancel', 'pay', 'purchase', 'buy',
  'place order', 'subscribe', 'send', 'submit', 'finish', 'confirm', 'save', 'apply', 'upload', 'download', 'print',
  'share', 'invite', 'deactivate', 'close'];

const asWords = (list: string[]) => new RegExp(`\\b(?:${list.join('|')})\\b`);
const KINDS: Array<[SensitiveAction['type'], RegExp]> = [
  ['deletion', asWords(DELETION)],
  ['payment', asWords(PAYMENT)],
  ['external_communication', asWords(MESSAGING)],
];
const CHANGES_WORDS = asWords(CHANGES);
const RISKY_ANYWHERE = new RegExp(`(?:${NOT_WHILE_EXPLORING.join('|')})`);

/** The kind of Sensitive Action the wording names, or null. */
export function sensitiveKind(...parts: string[]): SensitiveAction['type'] | null {
  const text = actionText(...parts);
  return KINDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** True when pressing it saves, sends, pays for or deletes something. */
export function changesData(...parts: string[]): boolean {
  return sensitiveKind(...parts) !== null || CHANGES_WORDS.test(actionText(...parts));
}

/** Never clicked while exploring: today's list, plus every Sensitive Action. */
export function riskyToClick(name: string): boolean {
  return RISKY_ANYWHERE.test(actionText(name)) || sensitiveKind(name) !== null;
}
```

2. `safety-filter.ts`: import `actionText` and `sensitiveKind`. Keep the forbidden-actions block, comparing `actionText(combined)` with `actionText(forbidden)` (it already treats `-` as a space). Replace the three regex blocks with `const kind = sensitiveKind(elementText, selector, actionType || '');` and return the same `SensitiveAction` objects as today for `deletion`, `payment` and `external_communication`, with the same `reason` strings, so question wording does not change.

3. `deterministic-spider.ts`: replace the regex with

```ts
/** Never clicked while exploring: they change or send things (the shared classifier, action-words.ts). */
export const RISKY_TO_CLICK: { test(name: string): boolean } = { test: riskyToClick };
```

   Its uses here and in `page-sweep.ts` and `ai-planner.ts` call `.test(el.name)` and keep working without edits. If `pnpm build` shows another use that needs a real `RegExp`, switch that use to `riskyToClick` and name the file in the PR.

4. `live-site.ts`: delete `CHANGES_SOMETHING`; use `changesData(name)` in its two places in `needsTestCopy`.

5. `mock.ts`: replace the inline regex with `!(sensitiveKind(c.name) || /sign ?out|log ?out|reset|trigger/i.test(c.name))`. The test AI keeps its own extra words and gains only the new sensitive wording, so tests that read its plans do not change.

6. `test-planner.ts`: apply the filter to AI journey steps. In `plan()`, build `allowedSensitive`: the `targetElement` of each question with `category === 'sensitive_action'` whose `selectedAnswer` is set and is not a skip answer (`isSkipAnswer`). Build a selector → element name map from `draft.pages[].elements`. In the `activeSteps` filter, also drop a `click` step when `sensitiveKind(step.name, elementName ?? '', step.selector ?? '')` is not null and `step.selector` is not in `allowedSensitive`. That is what already happens to a step whose element was answered "Don't press it".

7. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/core/tests/action-words.test.ts` (unit tier), table tests with real button wording:

- `sensitiveKind` is `payment` for: `Place order`, `Place-order`, `place_order`, `#placeOrderBtn`, `Buy now`, `Buy Now →`, `Pay $25.00`, `Complete purchase`, `Confirm my order`, `Upgrade plan`, `Donate`, `Transfer funds`, `Withdraw`, `Proceed to checkout`, `Subscribe`.
- `deletion` for: `Delete account`, `Close account`, `Close my account`, `Cancel account`, `cancel-account`, `Cancel my subscription`, `Deactivate`, `Unsubscribe`, `Remove item`.
- `external_communication` for: `Send email`, `send-email`, `Send SMS`, `Resend code`, `Send invitation`, `Invite teammates`, `Notify all users`.
- `null` for: `Save invoice`, `Display settings`, `Payroll report`, `Order history`, `Close` (a dialog), `Dropdown`, `Learn more`, `View invoice`, `Next`.
- `changesData`: true for `Sign up`, `sign-up`, `Add to basket`, `Book now`, `Post comment`, `Place order`; false for `View invoice`, `Next`, `Learn more`.
- `riskyToClick`: true for `Print`, `Share`, `Download PDF`, `Close`, `Display options` (as today), `Transfer funds`, `Resend code`; false for `Next`, `Learn more`, `Open menu`.

`packages/core/tests/safety-filter.test.ts` must pass unchanged (it checks `Delete Invoice`, `Pay Now ($500)`, a forbidden `drop-database`, `Save Invoice` and the question text).

New file `packages/core/tests/journey-sensitive-steps.test.ts` (unit tier): a minimal `DiscoveryDraft` with one page whose elements include `{ role: 'button', name: 'Place order', selector: '#place-order' }` and `{ role: 'textbox', name: 'Email', selector: '#email' }`, and one flow: `fill #email`, then `click #place-order` (step name `Press “Place order”`); no questions.

- `new TestPlanner().plan(draft)`: the journey's test case keeps the fill step and has no click on `#place-order`.
- With a `sensitive_action` question for `#place-order` answered `SENSITIVE_ANSWERS.allow`: the click step is kept.
- A click on an element named `Continue` whose AI step name is `Delete the invoice` is dropped (the step's own wording counts).

The existing `live-site.test.ts`, `ai-planner-sources.test.ts`, `intent-question.test.ts`, `plan-sources-live-site.test.ts`, `rejects-gating.test.ts` and `selector-order.test.ts` must pass unchanged.

Run: `pnpm exec vitest run packages/core/tests/action-words.test.ts packages/core/tests/journey-sensitive-steps.test.ts packages/core/tests/safety-filter.test.ts packages/core/tests/live-site.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "buy-now\|send-email\|cancel-account" packages/core/src/discovery/safety-filter.ts` prints nothing.
- [ ] `grep -n "CHANGES_SOMETHING" packages/core/src/live-site.ts` prints nothing.
- [ ] `grep -n "sensitiveKind" packages/core/src/discovery/test-planner.ts packages/core/src/ai/providers/mock.ts` finds both.
- [ ] The new tests and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding H9 (audit of 11 Nov 2026 on `d225418`).
- Wider wording means more Plan Review questions and fewer controls pressed. That is the safe direction (ADR 0003); it loosens nothing, so no new ADR.
- English wording only, as today. Other languages are a separate decision.
- The browser-tier Spider tests (`element-inventory`, `form-selectors`, `small-fixes`) may press fewer controls on their `setContent` pages; check them in the nightly run.
- T-310 also edits `test-planner.ts` (safe ids).
