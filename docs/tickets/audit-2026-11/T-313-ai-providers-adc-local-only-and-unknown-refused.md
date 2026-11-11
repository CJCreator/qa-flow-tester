# T-313: AI providers: Google sign-in (ADC) only on a local runner, unknown provider names refused, error bodies trimmed

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/ai/error-text.ts` (new)
- `packages/core/src/ai/gemini-models.ts`
- `packages/core/src/ai/ai-provider.ts`
- `packages/core/src/ai/providers/gemini.ts`
- `packages/core/src/ai/providers/anthropic.ts`
- `packages/core/src/ai/providers/openai.ts`
- `packages/core/src/audit/ai/stage-ai.ts`
- `packages/runner/src/server.ts`
- `packages/runner/src/session/checkup-run.ts`
- `docs/CONFIGURATION.md`
- `packages/core/tests/ai-provider-guards.test.ts` (new)
- `packages/core/tests/gemini-adc-fallback.test.ts`
- `packages/core/tests/ai-provider-timeout.test.ts`
- `packages/runner/tests/beta.test.ts`

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-300, T-301, T-302, T-303, T-308, T-329, T-331, T-357 (all edit `server.ts`); T-296, T-308, T-312, T-331, T-355, T-358, T-360 (all edit `checkup-run.ts`); T-298 (edits `beta.test.ts`); T-300, T-301, T-302, T-373 (all edit `CONFIGURATION.md`).

## Problem

Three gaps in the AI Provider layer, all reachable from a shared copy (`RUNNER_BETA=1`):

1. **Google sign-in (ADC) is not limited to the owner's computer.** `GeminiProvider` treats the key `adc` (or a `ya29.` token) as "use this machine's Google sign-in" (`packages/core/src/ai/providers/gemini.ts:163`, Vertex branch `:202-213`), and falls back to the machine's sign-in whenever an AI Studio key is refused (`:238`). ADR 0042 says "A beta copy never uses the host's credentials", and the Website Audit honours it (`packages/runner/src/routes/index.ts:121` passes `hasAdc` only when `wiring.localRun`). The Check-up path does not: a tester on a shared copy can save `adc` as their Gemini key (`server.ts:2829-2852`; `pickGemini` at `:2737` only skips the model pick for it), or send `apiKey: 'adc'` in the run body, and every Gemini request then uses the operator's credentials file. On Cloud Run there is no such file, so it fails closed there. A self-hosted shared runner with `gcloud` signed in spends the operator's Vertex AI project. The model id is also put into the Vertex and AI Studio URLs as is (`gemini.ts:106`, `:216`), so a run-body `aiModel` such as `../../x` changes the path that the operator's token is sent to.
2. **An unknown provider name becomes the test AI.** `createAIProvider` ends with `case 'mock': default: return new MockAIProvider();` (`packages/core/src/ai/ai-provider.ts:63-65`). The shared copy refuses the test AI only for the exact name `'mock'` (`server.ts:3181`, `:3340`). A run body with `aiProvider: 'Mock'` (or any other unknown name) and any `apiKey` gets made-up journeys on a shared copy, the thing that rule exists to stop.
3. **Provider errors carry the whole upstream body.** `Anthropic API error (${status}): ${errorText}` (`anthropic.ts:84`), the same in `openai.ts:115` and `gemini.ts:239`, `:244`, `:255`. The body can be many kilobytes of JSON and can echo request details; it reaches logs and the run's error text. `gemini-models.ts:65-80` already has the right helper (Google's message only, key removed, 300 characters at most).

## Current code

Branch from `main`.

`packages/core/src/ai/ai-provider.ts` (`grep -n "case 'mock'" packages/core/src/ai/ai-provider.ts`):

```ts
    case 'gemini':
      return new GeminiProvider(apiKey, defaultModel);
    case 'mock':
    default:
      return new MockAIProvider();
```

`packages/core/src/ai/providers/gemini.ts` (`grep -n "isAdc\|aiStudioKeyUnusable(res.status\|Gemini API error" packages/core/src/ai/providers/gemini.ts`):

```ts
    const isAdc = this.apiKey === 'adc' || this.apiKey.startsWith('ya29.');
...
          const adc = aiStudioKeyUnusable(res.status, studioText) ? await resolveAdcToken(signal) : null;
          if (!adc || !adc.projectId) throw new Error(`Gemini API error (${res.status}): ${studioText}`);
```

`packages/core/src/ai/gemini-models.ts` (`grep -n "function scrub\|function summarize" packages/core/src/ai/gemini-models.ts`):

```ts
function scrub(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[key]') : text;
}

/** Google's own message from an error body, without the JSON around it. */
function summarize(body: string, apiKey: string): string {
```

`packages/runner/src/server.ts` (`grep -n "createAIProvider(provider, apiKey, undefined, model)" packages/runner/src/server.ts`):

```ts
    this.makeAIProvider =
      options.createAIProvider || ((provider, apiKey, model) => createAIProvider(provider, apiKey, undefined, model));
```

The other callers of `createAIProvider`: `packages/runner/src/session/checkup-run.ts:755` (the default `prepareAI`, used only by the CI check-up `checkup.ts`) and `packages/core/src/audit/ai/stage-ai.ts:189`, `:212` (`deps.createProvider ?? createAIProvider`).

## Change

1. New file `packages/core/src/ai/error-text.ts` (pure, no imports). Move `scrub` and `summarize` here from `gemini-models.ts` and export them as `scrubKey(text, apiKey)` and `summarizeApiError(body, apiKey)`. Extend `summarizeApiError` for the other providers' shapes: take `error.message` (all three use it), append `error.metadata.raw` when it is a string (OpenRouter puts "temporarily rate-limited upstream" there, and `plan/ai-budget.ts:264` reads that wording to switch models), then `[status]` when present. Key removed, whitespace collapsed, 300 characters at most, as today. In `gemini-models.ts` import both from `./error-text.js` and delete the local copies.
2. Use it for every upstream body in an error message:
   - `anthropic.ts:84` → `` `Anthropic API error (${res.status}): ${summarizeApiError(errorText, this.apiKey)}` ``
   - `openai.ts:115` → the same with `errorText ?? (await res.text())`.
   - `gemini.ts:239`, `:244` (both bodies) and `:255` → the same with `this.apiKey`.
   Keep the `(status)` part unchanged: `isKeyRefused` in `stage-ai.ts` and `ai-budget.ts` read it.
3. `ai-provider.ts`: add

   ```ts
   export interface CreateAIProviderOptions {
     /** Gemini may use this computer's Google sign-in (ADC). Only a runner bound to this computer, or the CI check-up (ADR 0042). */
     allowAdc?: boolean;
   }
   ```

   as a fifth parameter `options: CreateAIProviderOptions = {}` of `createAIProvider`. Pass `{ allowAdc: options.allowAdc === true }` to `new GeminiProvider(apiKey, defaultModel, ...)`. Split the switch: `case 'mock': return new MockAIProvider();` and `default: throw new Error(`Unknown AI provider "${String(type).slice(0, 40)}".`);`.
4. `gemini.ts`: constructor `(apiKey: string, defaultModel?: string, opts: { allowAdc?: boolean } = {})`, keep `private allowAdc: boolean` (default false). In `send`:
   - Right after `model` is chosen: `if (!/^[\w.-]+$/.test(model)) throw new Error('The Gemini model name is not valid.');` (before any fetch).
   - `if (isAdc && !this.allowAdc) throw new Error('Google sign-in works only on a runner on your own computer. Add a Gemini API key in Settings.');` (before `resolveAdcToken`, so the credentials file is never read).
   - The AI Studio fallback: `const adc = this.allowAdc && aiStudioKeyUnusable(...) ? await resolveAdcToken(signal) : null;`.
5. `stage-ai.ts`: replace both `deps.createProvider ?? createAIProvider` with one helper:

   ```ts
   /** Google sign-in only where the runner allowed it: it passes `hasAdc` on a local runner only (ADR 0042). */
   function providerFactory(deps: ResolveAuditAiDeps): (type: AIProviderType, apiKey: string) => AIProvider {
     return deps.createProvider ?? ((type, apiKey) => createAIProvider(type, apiKey, undefined, undefined, { allowAdc: deps.hasAdc !== undefined }));
   }
   ```

   `auditAiOn` takes `deps` already; call `providerFactory(deps)` there too.
6. `server.ts`:
   - Add a field `private readonly localRun: boolean;` (doc: "Not a shared copy and bound to this computer (ADR 0042): Google sign-in and private addresses are allowed."). In the constructor, before `this.makeAIProvider = ...`, set `this.localRun = !this.beta && isLoopbackBindHost(this.host);` (`this.host` and `this.beta` are set above it). Pass `{ allowAdc: this.localRun }` as the fifth argument of `createAIProvider` there, and use `localRun: this.localRun` in the `wiring` object, so there is one rule.
   - `POST /api/ai/settings`: after `const apiKey = body.apiKey?.trim();`, when `provider === 'gemini'`, the key is `adc` or starts with `ya29.`, and `!this.localRun`, answer 400 `{ saved: false, reason: 'Google sign-in works only on a runner on your own computer. Add a Gemini API key.' }`.
   - Run start, next to the shared-copy test-AI check (`grep -n "body.aiProvider === 'mock'" packages/runner/src/server.ts`): for every caller, refuse a `body.aiProvider` that is neither `'mock'` nor in `AI_PROVIDERS` with 400 `{ error: 'This AI provider is not known. Choose one in Settings.', code: 'ERR_NO_AI_KEY' }`.
7. `checkup-run.ts:755` (the CI check-up's default `prepareAI`): pass `{ allowAdc: true }`. The CI check-up runs on the person's own machine or CI runner, where `GOOGLE_APPLICATION_CREDENTIALS` is theirs.
8. `docs/CONFIGURATION.md` "How ADC is used": say that saving `adc` as the key and Gemini's own fallback work only on a runner bound to this computer (and in the CI check-up); the hosted copy and any runner reachable from other machines refuse `adc` and never fall back.
9. Run `pnpm exec prettier --write` on every edited file, then `pnpm build`.

## Tests

New file `packages/core/tests/ai-provider-guards.test.ts` (stub `globalThis.fetch` with a recorder; restore it in `afterEach`):

- `createAIProvider('Mock' as AIProviderType, 'k')` and `createAIProvider('nope' as AIProviderType, 'k')` throw `/Unknown AI provider/`; `createAIProvider('mock', 'none').providerType` is `'mock'`.
- `new GeminiProvider('adc').complete(...)` rejects with `/your own computer/` and the fetch recorder is empty (no oauth2, no Vertex call).
- With `GOOGLE_APPLICATION_CREDENTIALS` stubbed to a temp file holding fake `authorized_user` creds (same shape as `gemini-adc-fallback.test.ts`), `new GeminiProvider('studio-key')` whose AI Studio call answers 402 rejects with `Gemini API error (402)` and no recorded URL starts with `https://oauth2.googleapis.com/` or `https://aiplatform.googleapis.com/`.
- `new GeminiProvider('studio-key', '../../v1/projects/x')` rejects with `/model name is not valid/` and nothing was fetched.
- Error bodies: Anthropic answering 400 with a 5,000-character JSON body `{"error":{"type":"x","message":"<long text> test-key-123 ..."}}` rejects with a message of at most 340 characters that contains `(400)` and not `test-key-123`. The same for OpenAI and Gemini.
- OpenRouter 429 body `{"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"vendor/m:free is temporarily rate-limited upstream. Please retry shortly"}}}` gives a message that matches `/temporarily rate.?limited/` and `/\(429\)/` (the switch in `ai-budget.ts` still works).

`packages/core/tests/gemini-adc-fallback.test.ts`: the `ask` helper builds `new mod.GeminiProvider(key, model, { allowAdc: true })`; every existing case keeps its expectation (plain-text bodies summarise to the same text).

`packages/core/tests/ai-provider-timeout.test.ts`: the ADC timeout case uses `new GeminiProvider('adc', undefined, { allowAdc: true })`.

`packages/runner/tests/beta.test.ts` (the shared-copy server), two new cases:

- `POST /api/ai/settings { provider: 'gemini', apiKey: 'adc' }` answers 400 and `saved: false`.
- `POST /api/runner/run { targetUrl: 'https://example.com/', useAI: true, aiProvider: 'Mock', apiKey: 'x' }` answers 400 with code `ERR_NO_AI_KEY`.

`packages/runner/tests/ai-gemini-models.test.ts` already saves `adc` on a `localhost` runner; it must keep passing unchanged.

Run: `pnpm exec vitest run packages/core/tests/ai-provider-guards.test.ts packages/core/tests/gemini-adc-fallback.test.ts packages/core/tests/ai-provider-timeout.test.ts packages/core/tests/ai-provider.test.ts packages/core/tests/gemini-models.test.ts packages/core/tests/audit-ai-stage.test.ts packages/runner/tests/beta.test.ts packages/runner/tests/ai-gemini-models.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "default:" packages/core/src/ai/ai-provider.ts` shows a `throw`, not the mock.
- [ ] `grep -n "allowAdc" packages/core/src/ai/providers/gemini.ts packages/runner/src/server.ts packages/core/src/audit/ai/stage-ai.ts packages/runner/src/session/checkup-run.ts` finds the option in all four files.
- [ ] `grep -n "API error (\${res.status}): \${errorText}" packages/core/src/ai/providers/*.ts` prints nothing.
- [ ] `grep -n "function summarize\|function scrub" packages/core/src/ai/gemini-models.ts` prints nothing (moved to `error-text.ts`).
- [ ] The tests above and the core and runner unit tests pass; `pnpm build` passes.

## Notes

- Audit findings M4 and L17 (part) (audit of 11 Nov 2026 on `d225418`).
- Behaviour change to expect: a runner bound to `0.0.0.0` (Docker, a team machine) no longer uses Google sign-in for Check-ups, the same rule the Website Audit already follows (ADR 0042, "on a runner bound to this computer only"). Say so in the PR.
- A `ya29.` bearer token is refused on a shared copy too: the Vertex branch reads the operator's credentials file for the project id before it uses the token.
- `packages/core/src/audit/ai/preflight.ts` calls `createAIProvider` without the option on its key-only paths, so it never uses Google sign-in. The runner always passes `resolveAi`, which goes through `stage-ai.ts`, so nothing the person sees changes.
- Size raised from S to M: ten source and doc files across core and runner, though each change is small.
- Related: T-242 (UX gap synthesizer checks the provider type) does not touch these files.
