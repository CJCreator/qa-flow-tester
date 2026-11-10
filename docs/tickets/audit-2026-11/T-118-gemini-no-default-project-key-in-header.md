# T-118: Gemini: no built-in Google Cloud project, and the API key travels in a header

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | core | security | built |

**Files you may edit (no others):**
- `packages/core/src/ai/providers/gemini.ts`
- `packages/core/src/ai/gemini-models.ts`
- `packages/core/tests/gemini-adc-fallback.test.ts`
- `packages/core/tests/gemini-models.test.ts`
- `docs/CONFIGURATION.md`

**Do not build in parallel with:** none.

## Problem

1. When Google sign-in (ADC) has no quota project and no `GOOGLE_CLOUD_PROJECT`, the provider falls back to the
   maintainer's own project id `qa-flow-tester-512310`. Anyone self-hosting then sends their Vertex AI requests
   against that project: they fail with a permission error, or are billed to it.
2. The AI Studio key is put in the address (`?key=...`). Addresses end up in proxy logs, error messages and
   stack traces. Google accepts the same key in the `x-goog-api-key` header.

## Current code

`packages/core/src/ai/providers/gemini.ts:54-55` (branch `worktree-audit-cleanup`)

```ts
    const projectId =
      creds.quota_project_id || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'qa-flow-tester-512310';
```

`gemini.ts:206-216`

```ts
      const token = this.apiKey.startsWith('ya29.') ? this.apiKey : adc!.accessToken;
      const proj = adc?.projectId || process.env.GOOGLE_CLOUD_PROJECT || 'qa-flow-tester-512310';
      ({ res, model: usedModel } = await postVertex(token, proj, model, payload, signal));
    } else {
      const postStudio = (m: string) =>
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${this.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal,
        });
```

`packages/core/src/ai/gemini-models.ts:112` and `:243`

```ts
      `${STUDIO}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000` +
...
        `${STUDIO}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
```

## Change

### A. No built-in project (`gemini.ts`)

1. Above `resolveAdcToken`, add:

```ts
/** Shown when Google sign-in is used and no project is named. Fixed wording: it is shown to the person. */
export const NO_GOOGLE_PROJECT =
  'Google sign-in needs a Google Cloud project. Set GOOGLE_CLOUD_PROJECT, or run "gcloud auth application-default set-quota-project <project>".';
```

2. Line 54-55 becomes:

```ts
    const projectId: string | undefined =
      creds.quota_project_id || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || undefined;
```

   If the type of `cachedAdc` / the returned `auth` object declares `projectId: string`, change it to
   `projectId?: string` (search for `projectId` in the file; it is declared once near the top).

3. Lines 207-208 become:

```ts
      const proj = adc?.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
      if (!proj) throw new Error(NO_GOOGLE_PROJECT);
```

4. Search the file for every other use of `.projectId` (the AI Studio to Vertex fallback path passes it to
   `postVertex`). At each one, if the project is missing, do not call Vertex: in the fallback path treat it as
   "no ADC" (keep the original AI Studio error); nowhere may the string `qa-flow-tester-512310` remain.

### B. Key in a header (`gemini.ts` and `gemini-models.ts`)

5. `gemini.ts` `postStudio`:

```ts
      const postStudio = (m: string) =>
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: payload,
          signal,
        });
```

6. `gemini-models.ts:112`: remove `key=${encodeURIComponent(apiKey)}&` from the address (it becomes
   `${STUDIO}/models?pageSize=1000` + the rest) and add `'x-goog-api-key': apiKey` to that `fetch`'s `headers`
   (create a `headers` object if the call has none).

7. `gemini-models.ts:243`: remove `?key=${encodeURIComponent(apiKey)}` and add `'x-goog-api-key': apiKey` to
   that `fetch`'s `headers`.

### C. Docs

8. `docs/CONFIGURATION.md` line 227, the `GCP_PROJECT` row: replace
   `and as the Gemini ADC project fallback` with
   `and, with GOOGLE_CLOUD_PROJECT, as the project for Gemini through Google sign-in. There is no built-in default for that: without a project, Google sign-in is refused.`

## Tests

- `packages/core/tests/gemini-adc-fallback.test.ts`: the tests stub `fetch` and the ADC file. Any test that
  relied on the built-in project must set `process.env.GOOGLE_CLOUD_PROJECT = 'test-project'` in `beforeEach`
  and delete it in `afterEach`. Add one test, copying the setup of
  `"goes straight to Vertex with the mapped model for the key 'adc'"`: ADC file **without** `quota_project_id`,
  no `GOOGLE_CLOUD_PROJECT`/`GCP_PROJECT` in the environment, key `'adc'`; expect the call to reject with
  `NO_GOOGLE_PROJECT` and `fetch` never to be called with a `aiplatform.googleapis.com` address.
- In the same file, wherever a test asserts the AI Studio address, change the expectation: the address has no
  `key=`, and the request's `headers['x-goog-api-key']` equals the key.
- `packages/core/tests/gemini-models.test.ts`: same change for the two model-list / probe requests.

Command: `pnpm exec vitest run packages/core/tests/gemini-adc-fallback.test.ts packages/core/tests/gemini-models.test.ts`, then `pnpm build`.

## Done when

- [x] `grep -rn "512310" packages/` finds nothing
- [x] `grep -rn "key=" packages/core/src/ai` finds no AI Studio address
- [x] Both test files pass; `pnpm build` passes

## Notes

- **For the owner (not for the builder):** if the hosted copy uses Google sign-in for Gemini, add
  `GOOGLE_CLOUD_PROJECT=qa-flow-tester-512310` to `--set-env-vars` in `.github/workflows/deploy.yml` and
  `scripts/deploy-cloud-run.mjs` before this ships. Mark the ticket `human` when the code is built.
- `scripts/deploy-cloud-run.mjs` keeps its own default project: it is the maintainer's deploy script.
