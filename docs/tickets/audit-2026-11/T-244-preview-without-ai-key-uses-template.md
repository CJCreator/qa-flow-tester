# T-244: The improved-homepage preview works without an AI key (template text)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/routes/audit-preview.ts`
- `packages/runner/tests/audit-preview-routes.test.ts`
- `docs/API.md`

**Do not build in parallel with:** T-218, T-233 (both edit `docs/API.md`).

## Problem

ADR 0042 says: "Without a working key, the Proposal, the Pitch Glimpse, the Owner Audit and the AI preview use template text filled from the findings. ... A failed AI step never leaves an Audit Document empty and never returns a bare 502."

Core already does this. `generatePreview` in `packages/core/src/audit/preview/generate.ts` falls back to `buildTemplateHtml` when `options.ai` is missing, when the AI fails, or when the AI keeps using claim words. But the route `POST /api/audits/:id/preview` answers `409 ERR_NO_AI_KEY` before it ever calls the generator, so the template path is unreachable when no key is saved. The "AI could not write the preview" `502` can only come from a thrown error now.

## Current code

Branch from `main`. `packages/runner/src/routes/audit-preview.ts`, in `createPreview` (`grep -n "NO_AI_KEY" packages/runner/src/routes/audit-preview.ts`):

```ts
export const NO_AI_KEY = 'Add an AI key to write the improved homepage preview.';
```

```ts
const resolved = await deps.resolveAi();
if (!resolved.ok) return refuse(res, 409, 'ERR_NO_AI_KEY', NO_AI_KEY);
```

and a little below:

```ts
generated = await deps.generate(
  { result, home, edits, language },
  { ai: resolved.ai, fetchImage, timeoutMs: deps.aiTimeoutMs }
);
```

`AuditAiResolution` is `{ ok: true; ai: AuditAi } | { ok: false; reason: 'no-ai-key' }`. `GeneratePreviewOptions.ai` is optional.

The existing test in `packages/runner/tests/audit-preview-routes.test.ts`: `'without an AI key: 409 ERR_NO_AI_KEY, no AI request, nothing stored'`.

`docs/API.md`, the preview row: `Writes the improved homepage with AI; \`409 ERR_NO_AI_KEY\` without a key.`

## Change

1. In `audit-preview.ts` delete the `export const NO_AI_KEY = ...` line (check first: `grep -rn "NO_AI_KEY" packages/runner/tests packages/runner/src/routes/audit-preview.ts` shows no other user of this name; the same name in `audit-ai.ts` is a separate constant).

2. Replace the two lines with the key check by:

```ts
// No key is not a refusal: the preview is then written from template text (ADR 0042).
const resolved = await deps.resolveAi();
```

3. Replace the `deps.generate(...)` call with:

```ts
generated = await deps.generate(
  { result, home, edits, language },
  { ...(resolved.ok ? { ai: resolved.ai } : {}), fetchImage, timeoutMs: deps.aiTimeoutMs }
);
```

4. Update the `resolveAi` comment in `AuditPreviewRouteDeps` so it ends "No key: `{ ok: false }`, and the preview is written from template text."

5. `docs/API.md`: change the preview row text to `Writes the improved homepage: AI wording when a key works, template text when it does not.` Keep the table's column padding: run `pnpm exec prettier --write docs/API.md`.

6. Run `pnpm exec prettier --write packages/runner/src/routes/audit-preview.ts packages/runner/tests/audit-preview-routes.test.ts`, then `pnpm build`.

## Tests

In `packages/runner/tests/audit-preview-routes.test.ts` replace the test `'without an AI key: 409 ERR_NO_AI_KEY, no AI request, nothing stored'` with:

```ts
it('without an AI key: 200, template preview stored, no AI request', async () => {
  hasKey = false;
  const generate = vi.fn<PreviewGenerator>(generatePreview);
  const res = await call(auditPreviewRoutes(deps({ generate })), 'createPreview', auditId, {
    body: JSON.stringify({ version: 1, language: 'en' }),
  });
  expect(res.statusCode).toBe(200);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][1].ai).toBeUndefined();
  expect(providerCalls).toHaveLength(0);
  const page = new TextDecoder().decode((await storedPreview())!);
  expect(page).toContain('<html lang="en"');
});
```

Run: `pnpm exec vitest run packages/runner/tests/audit-preview-routes.test.ts packages/core/tests/audit-preview.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "ERR_NO_AI_KEY" packages/runner/src/routes/audit-preview.ts` prints nothing.
- [ ] `grep -n "ERR_NO_AI_KEY" docs/API.md` no longer lists the preview row (the rewrite row keeps it).
- [ ] The two test files pass; `pnpm build` passes.

## Notes

- Not in this ticket: the wizard. `PreviewShareScreen.tsx` still has a `noAiKey` branch for `ERR_NO_AI_KEY`. It is never reached now and is harmless. A later wizard ticket may say on the preview "written from template text" when no key is set. The preview file does not record which path made it, so the screen cannot tell yet.
- The `502 ERR_AI_FAILED` branch stays for a thrown error (store failure and similar). `generatePreview` itself no longer returns `{ ok: false }` for the AI failing.
