# T-259: One copy of `isInside` and one cookie reader

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | duplication | todo |

**Files you may edit (no others):**

- `packages/runner/src/fs-inside.ts` (new)
- `packages/runner/src/cookies.ts` (new)
- `packages/runner/src/server.ts`
- `packages/runner/src/ui-static.ts`
- `packages/runner/src/beta.ts`
- `packages/runner/src/helpers/helper-session.ts`
- `packages/runner/tests/shared-helpers.test.ts` (new)

**Do not build in parallel with:** T-255, T-258, T-260, T-261, T-265, T-267 (all edit `server.ts`, about 3,900 lines). Also any ticket that edits `beta.ts`, `ui-static.ts` or `helpers/helper-session.ts`.

## Problem

Two helpers exist in more than one file with the same behaviour:

1. `isInside(dir, file)` (is a file inside a folder, used to keep file serving inside the output folder): identical copies in `server.ts` and `ui-static.ts`. A security check should exist once.
2. The cookie reader: three copies, `cookieValue` in `server.ts`, `cookieValue` in `beta.ts` and `cookieFrom` in `helpers/helper-session.ts`. The server copy and the Helper copy decode the value and return `undefined` for a malformed `%` escape. The `beta.ts` copy does not decode. That difference cannot matter: it reads only the `qa_session` cookie, whose value the runner made itself with `randomBytes(18).toString('base64url')` (letters, digits, `-`, `_`), and the value is then looked up in a map of those ids. Decoding such a value changes nothing, and a hand-made cookie that does not decode finds no session either way (a new session is made).

(`report-store.ts` has a different `relativePath` helper that returns a path, not a yes/no. Leave it.)

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "function isInside\|function cookieValue\|export function cookieFrom" packages/runner/src/*.ts packages/runner/src/helpers/*.ts`.

`server.ts` and `ui-static.ts` (identical):

```ts
function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
```

`server.ts`:

```ts
/** One cookie's value from a Cookie header. */
function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const at = part.indexOf('=');
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
```

`beta.ts`:

```ts
function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
```

`helpers/helper-session.ts`:

```ts
/** The value of one cookie in a Cookie header, decoded; undefined when absent. */
export function cookieFrom(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
```

`tests/helper-session.test.ts` imports `cookieFrom` from `../src/helpers/helper-session.js` and must keep working.

## Change

1. Create `packages/runner/src/fs-inside.ts`:

```ts
import path from 'path';

/** Is `file` strictly inside the folder `dir` (not the folder itself, not a sibling, not above it)? */
export function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
```

2. Create `packages/runner/src/cookies.ts`:

```ts
/** The value of one cookie in a Cookie header, decoded; undefined when absent or not decodable. */
export function cookieFrom(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
```

3. `server.ts` and `ui-static.ts`: delete the local `isInside` and add `import { isInside } from './fs-inside.js';`. In `server.ts` also delete `cookieValue` (with its doc comment), add `import { cookieFrom } from './cookies.js';` and change its one use to `cookieFrom(req.headers.cookie, ACCESS_COOKIE)`.

4. `beta.ts`: delete `cookieValue`, add `import { cookieFrom } from './cookies.js';` and change its one use to `cookieFrom(req.headers.cookie, SESSION_COOKIE)`.

5. `helpers/helper-session.ts`: delete the local `cookieFrom` function and its comment. Add near the other imports:

```ts
import { cookieFrom } from '../cookies.js';

export { cookieFrom };
```

so the existing `readHelperSession` keeps calling it and the existing test import keeps working.

6. In each of `server.ts` and `ui-static.ts` check that `path` is still used (`grep -n "path\." file`); it is. Run `pnpm exec prettier --write` on the changed files and `pnpm build`.

## Tests

Add `packages/runner/tests/shared-helpers.test.ts` (unit):

```ts
import { describe, it, expect } from 'vitest';
import path from 'path';
import { isInside } from '../src/fs-inside.js';
import { cookieFrom } from '../src/cookies.js';
```

- `'isInside is true for a file below the folder'`: `isInside(path.resolve('/a/b'), path.resolve('/a/b/c/d.png'))` true.
- `'isInside is false for the folder itself, a sibling and a parent'`: `(/a/b, /a/b)`, `(/a/b, /a/c)`, `(/a/b, /a)` all false (each wrapped in `path.resolve`).
- `'isInside is false for a path that climbs out'`: `isInside(path.resolve('/a/b'), path.resolve('/a/b/../c'))` false.
- `'cookieFrom reads one cookie among several'`: `cookieFrom('a=1; qa_session=abc_-9; b=2', 'qa_session')` toBe `'abc_-9'`.
- `'cookieFrom keeps an = inside the value and decodes it'`: `cookieFrom('k=a%3Db', 'k')` toBe `'a=b'`; `cookieFrom('k=x=y', 'k')` toBe `'x=y'`.
- `'cookieFrom is undefined when absent, empty or not decodable'`: `cookieFrom(undefined, 'k')`, `cookieFrom('', 'k')`, `cookieFrom('j=1', 'k')`, `cookieFrom('k=%E0%A4%A', 'k')` all `undefined`.

Run: `pnpm exec vitest run packages/runner/tests/shared-helpers.test.ts packages/runner/tests/helper-session.test.ts packages/runner/tests/beta.test.ts packages/runner/tests/access-token.test.ts packages/runner/tests/single-server.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "function isInside" packages/runner/src/*.ts` shows only `fs-inside.ts`.
- [ ] `grep -n "function cookieValue\|function cookieFrom" packages/runner/src/*.ts packages/runner/src/helpers/*.ts` shows only `cookies.ts`.
- [ ] The listed tests pass and `pnpm build` passes.

## Notes

- Not in this ticket: the four "was this visit https" checks. They differ in behaviour and need an owner decision: T-261.
- `beta.test.ts`, `access-token.test.ts` and `single-server.test.ts` start a `RunnerServer` and are already in `BROWSER_TESTS` in `vitest.workspace.ts`; run them by file name as shown.
