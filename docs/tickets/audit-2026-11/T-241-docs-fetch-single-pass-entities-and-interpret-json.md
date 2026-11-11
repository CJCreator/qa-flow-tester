# T-241: Docs entity decoding in one pass, and `interpret.ts` reads AI JSON like the planner

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/discovery/docs-fetch.ts`
- `packages/core/src/discovery/interpret.ts`
- `packages/core/tests/docs-fetch.test.ts`
- `packages/core/tests/interpret-json.test.ts` (new)

**Do not build in parallel with:** T-240 (edits `docs-fetch.ts`).

## Problem

1. `decodeEntities` in `docs-fetch.ts` runs three `.replace` calls one after another. The output of the first is the input of the next, so text is decoded twice. The page text `&#38;lt;b&#62;` (which a browser shows as the letters `&lt;b>`) becomes `<b>`. The other copy in `docx-to-markdown.ts` and the one in `audit/preview/sanitize.ts` decode in one pass.
2. `parseJson` in `interpret.ts` only strips code fences. `parseJsonAnswer` in `plan/ai-planner.ts` (used by every other AI answer) also cuts the object out of chatter around it and forgives a comma before a closing bracket. A small free model that answers `Sure! {"understood": true,}` makes "turn a sentence into a test" fail with "I couldn't work out what to do".

## Current code

Branch from `main`.

`packages/core/src/discovery/docs-fetch.ts` (`grep -n "function decodeEntities" packages/core/src/discovery/docs-fetch.ts`):

```ts
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}
```

`packages/core/src/discovery/interpret.ts` (`grep -n "function parseJson" packages/core/src/discovery/interpret.ts`):

````ts
function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(
      text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim()
    ) as T;
  } catch {
    return null;
  }
}
````

`packages/core/src/plan/ai-planner.ts` exports `parseJsonAnswer(text: string): any` (throws when it cannot parse).

## Change

1. `docs-fetch.ts`: replace `decodeEntities` with one pass (keep `ENTITIES`):

```ts
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(Math.min(code, 0x10ffff));
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
```

2. `interpret.ts`: add `import { parseJsonAnswer } from '../plan/ai-planner.js';` after the existing imports, and replace `parseJson` with:

```ts
function parseJson<T>(text: string): T | null {
  try {
    const value: unknown = parseJsonAnswer(text);
    return value && typeof value === 'object' ? (value as T) : null;
  } catch {
    return null;
  }
}
```

3. Run `pnpm exec prettier --write` on the two source files and `pnpm build`.

## Tests

In `packages/core/tests/docs-fetch.test.ts`, inside `describe('htmlToDoc', ...)`, add:

```ts
it('decodes each entity once', () => {
  expect(htmlToDoc('<p>&#38;lt;b&#62; and &amp;amp;</p>')).toBe('&lt;b> and &amp;');
});
```

New file `packages/core/tests/interpret-json.test.ts`:

````ts
import { describe, it, expect } from 'vitest';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { interpretRule } from '../src/discovery/interpret.js';

const answering = (text: string): AIProvider =>
  ({ providerType: 'mock', generateText: async () => text }) as unknown as AIProvider;

const ask = (text: string) =>
  interpretRule({
    sentence: 'Nothing should break',
    flow: { name: 'Journey', startPage: '/', steps: [] } as never,
    draft: { pages: [] },
    ai: answering(text),
  });

describe('interpretRule reads the AI answer like the planner does', () => {
  it('finds the object inside chatter and forgives a trailing comma', async () => {
    const out = await ask(
      'Sure! Here it is:\n{"checkable": true, "expected": {"kind": "nothing-breaks"},}\nHope that helps.'
    );
    expect(out).toMatchObject({ ok: true, rule: { checkable: true } });
  });
  it('still reads a fenced answer', async () => {
    const out = await ask('```json\n{"checkable": true, "expected": {"kind": "nothing-breaks"}}\n```');
    expect(out).toMatchObject({ ok: true, rule: { checkable: true } });
  });
  it('keeps the rule as a note for a person when the answer is not JSON', async () => {
    const out = await ask('I cannot help with that.');
    expect(out).toMatchObject({ ok: true, rule: { checkable: false } });
  });
});
````

Run: `pnpm exec vitest run packages/core/tests/docs-fetch.test.ts packages/core/tests/interpret-json.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -c "replace(/&#" packages/core/src/discovery/docs-fetch.ts` prints 0.
- [ ] `grep -n "JSON.parse" packages/core/src/discovery/interpret.ts` prints nothing.
- [ ] The two test files pass; `pnpm build` passes.

## Notes

- Not in this ticket: merging the three `decodeEntities` copies (`docs-fetch.ts`, `docx-to-markdown.ts`, `audit/preview/sanitize.ts`). Their tables and clamping differ, so merging changes output and needs its own review.
- `docs-fetch.test.ts` starts a loopback server (port 0). It stays a unit test.
