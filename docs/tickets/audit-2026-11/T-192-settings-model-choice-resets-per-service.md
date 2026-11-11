# T-192: Settings: the model picker starts fresh when the AI service changes

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/SettingsScreen.tsx`
- `packages/wizard/tests/report-settings-text.test.ts`

**Do not build in parallel with:** T-195, T-200 (edit `SettingsScreen.tsx`).

## Problem

`ModelChoice` copies `setup.model` and `setup.visionModel` into its own state when it mounts. After the person switches the AI service (say OpenRouter to Gemini), the same component instance stays mounted, so the fields still hold the old service's model ids. Pressing Save then stores an OpenRouter model id for Gemini.

## Current code

`packages/wizard/src/screens/SettingsScreen.tsx:281` (branch `worktree-audit-cleanup`)

```tsx
                {!choosing && setup.configured && <ModelChoice setup={setup} onSaved={load} />}
```

`SettingsScreen.tsx:439-448`

```tsx
function ModelChoice({ setup, onSaved }: { setup: AiSetup; onSaved: () => void }) {
  const openRouter = (setup.provider ?? 'openrouter') === 'openrouter';
  const [models, setModels] = useState<FreeModel[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const gemini = setup.provider === 'gemini';
  const [geminiList, setGeminiList] = useState<GeminiModelList | null>(null);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [text, setText] = useState<string>(setup.chosenBy === 'person' ? (setup.model ?? '') : '');
  const [vision, setVision] = useState<string>(setup.chosenBy === 'person' ? (setup.visionModel ?? '') : '');
```

## Change

Replace line 281 with (a `key` makes React build a new `ModelChoice`, with fresh state, per service):

```tsx
                {!choosing && setup.configured && (
                  <ModelChoice key={setup.provider ?? 'openrouter'} setup={setup} onSaved={load} />
                )}
```

## Tests

Edit `packages/wizard/tests/report-settings-text.test.ts` (it already reads screen sources as text; copy its `readFileSync` pattern). Add:

```ts
it('builds a new model picker for each AI service, so one service’s model id is never saved for another', () => {
  const settings = readFileSync(resolve(__dirname, '../src/screens/SettingsScreen.tsx'), 'utf8');
  expect(settings).toMatch(/<ModelChoice key=\{setup\.provider \?\? 'openrouter'\}/);
});
```

If the file has no `readFileSync` / `resolve` imports, add `import { readFileSync } from 'node:fs';` and `import { resolve } from 'node:path';`.

Run: `pnpm exec vitest run packages/wizard/tests/report-settings-text.test.ts packages/wizard/tests/settings-gemini-model.test.tsx` then `pnpm build`.

## Done when

- [x] `ModelChoice` has `key={setup.provider ?? 'openrouter'}`.
- [x] After switching service, the model fields are empty or show that service's saved model.
- [x] Tests and `pnpm build` pass.

## Notes

- Do not move state out of `ModelChoice` or add an effect that resets it; the `key` is the whole fix.
