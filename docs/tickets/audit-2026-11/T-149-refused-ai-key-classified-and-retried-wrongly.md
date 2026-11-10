# T-149: A refused AI key is classified two ways and asked again for every page

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core/audit | inconsistency | built |

**Files you may edit (no others):**
- `packages/core/src/audit/ai/stage-ai.ts`
- `packages/core/tests/audit-ai-stage.test.ts`

**Do not build in parallel with:** T-151 (edits `stage-ai.ts`).

## Problem

1. `isKeyRefused` treats HTTP 402 and "credits depleted" as a key the provider refuses. `classifyAiError` maps the same errors to `provider-error`, so the owner reads "The AI provider returned an error" where "The AI quota was reached" is the true reason.

2. After the provider has said the key itself is invalid (401, "API key expired"), the Website Audit still sends one request per page, one for the site and one per Sample Page. Each fails the same way. That is slow and fills the log.

## Current code

`packages/core/src/audit/ai/stage-ai.ts:130` (branch `worktree-audit-cleanup`), inside `classifyAiError`

```ts
  if (
    statusNum === 429 ||
    /\b429\b/.test(raw) ||
    /quota|rate limit|too many requests|insufficient (credits|balance|quota)|billing/i.test(raw)
  ) {
    return 'quota';
  }

  return 'provider-error';
```

`packages/core/src/audit/ai/stage-ai.ts:240`, the object returned by `auditAiOn` (the function that builds an `AuditAi`)

```ts
  return {
    get provider() {
      return providerType;
    },
    async ask(stage, messages, options = {}) {
      stopIfAborted(options.signal);
      if (deps.budget && !deps.budget.take()) return { ok: false, reason: 'budget-spent' };
      const sentWith = provider;
      const sentAs = providerType;
      try {
        const { completion, model } = await send(stage, messages, options);
        return { ok: true, completion, model, claimWords: findClaimWords(completion.text) };
      } catch (err) {
        // Sent on the old provider while another request switched to Google sign-in: try the one in use now.
        // Otherwise switch only for a refused key, on a provider other than Gemini.
        const movedOn = provider !== sentWith;
        if (!movedOn) {
          const canSwitch = sentAs !== 'gemini' && hasAdc !== undefined && isKeyRefused(err);
          if (!canSwitch || !(await switchToAdc())) throw err;
        }
        stopIfAborted(options.signal);
        const { completion, model } = await send(stage, messages, options);
        return { ok: true, completion, model, claimWords: findClaimWords(completion.text) };
      }
    },
  };
```

## Change

1. `classifyAiError`, the quota branch:

```ts
  if (
    statusNum === 429 ||
    statusNum === 402 ||
    /\b(429|402)\b/.test(raw) ||
    /quota|rate limit|too many requests|insufficient (credits|balance|quota)|credits? (are )?depleted|billing/i.test(raw)
  ) {
    return 'quota';
  }
```

Also update the doc comment above `classifyAiError`: change `- 429 -> 'quota'` to `- 429, 402 or no credit left -> 'quota'`.

2. Add a helper below `isKeyRefused`:

```ts
/**
 * The key itself is invalid or expired (401, or the provider says so). Unlike a 403 or a missing credit, no
 * later request with this key can work, so the audit stops asking.
 */
function isKeyInvalid(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /\(401\)/.test(message) || /api key (expired|invalid|not valid)/i.test(message);
}
```

3. In the function that returns the `AuditAi` object, declare before the `return {`:

```ts
  /** Set once the provider said the key is invalid and no other sign-in could take over: later asks fail at once. */
  let deadKeyError: unknown = null;
```

4. In `ask`, add as the second line (after `stopIfAborted(options.signal);`, before the budget line):

```ts
      if (deadKeyError) throw deadKeyError;
```

5. In `ask`'s `catch`, replace `if (!canSwitch || !(await switchToAdc())) throw err;` with:

```ts
          if (!canSwitch || !(await switchToAdc())) {
            if (isKeyInvalid(err)) deadKeyError = err;
            throw err;
          }
```

## Tests

Edit `packages/core/tests/audit-ai-stage.test.ts`. Copy the setup of `"REQ-011 AC-1: calls the saved provider with the tool user's key"` (about line 44), which builds an `AuditAi` with a fake provider.

Add:

- `'classifyAiError: 402 and depleted credits are quota'`: `classifyAiError(new Error('Request failed (402): credits are depleted'))` is `'quota'`; `classifyAiError({ status: 402, message: 'x' })` is `'quota'`; `classifyAiError(new Error('Request failed (401)'))` is still `'key-expired'`; `classifyAiError(new Error('Request failed (500)'))` is still `'provider-error'`.
- `'an invalid key is asked once: later requests fail without a provider call'`: fake provider whose completion throws `new Error('Request failed (401): API key expired')`, no `hasAdc`. Call `ai.ask(...)` three times, each expected to reject. Expect the provider to have been called exactly once.
- `'a 429 does not stop later requests'`: provider throws `new Error('Request failed (429)')` on the first call and succeeds on the second. Expect the second `ask` to return `ok: true` and two provider calls.

Run: `pnpm exec vitest run packages/core/tests/audit-ai-stage.test.ts packages/core/tests/audit-ai-flow.test.ts packages/core/tests/audit-ai-preflight.test.ts`, then `pnpm build`.

## Done when

- [x] 402 and "credits depleted" classify as `quota`.
- [x] After a 401 with no fallback, no further request reaches the provider in that audit.
- [x] Tests and `pnpm build` pass.

## Notes

- Only an invalid key stops later requests. A 403 can be model-specific and a 402 can clear, so those keep being tried.
- If an existing test expects several provider calls after a 401, it now gets one: update its count.
- Do not change `isKeyRefused`.
