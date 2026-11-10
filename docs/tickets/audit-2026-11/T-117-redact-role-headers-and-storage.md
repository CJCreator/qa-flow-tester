# T-117: The Redactor hides a Role's header values and stored entries

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | core | security | todo |

**Files you may edit (no others):**
- `packages/core/src/redact.ts`
- `packages/core/tests/redaction.test.ts`

**Do not build in parallel with:** none.

## Problem

A Role can carry secrets in four places: `password`, `token`, `headers` (for example
`{ 'X-Api-Key': 'k-9f3a...' }`) and `localStorageEntries` (for example `{ authToken: 'eyJ...' }`). The
`Redactor` scrubs only `password`, `token` and email usernames. A header value or stored entry that shows up in
a log line, a Finding, evidence or a streamed event is written out in the clear.

## Current code

`packages/core/src/redact.ts:88-95` (branch `worktree-audit-cleanup`)

```ts
  constructor(credentials: Array<Partial<RoleCredential>> = [], opts: RedactorOptions = {}) {
    const minLength = opts.minSecretLength ?? DEFAULT_MIN_SECRET_LENGTH;
    const values = new Set<string>();
    for (const c of credentials) {
      for (const secret of [c.password, c.token]) if (secret && secret.length >= minLength) values.add(secret);
      if (c.username && c.username.includes('@')) values.add(c.username);
    }
```

## Change

1. Add a constant above `export class Redactor` (below `DEFAULT_MIN_SECRET_LENGTH`):

```ts
/** Header values and stored entries shorter than this are too ordinary to scrub ("true", "en", "1"). */
const MIN_EXTRA_SECRET_LENGTH = 8;
```

2. Replace the loop body with:

```ts
    for (const c of credentials) {
      for (const secret of [c.password, c.token]) if (secret && secret.length >= minLength) values.add(secret);
      if (c.username && c.username.includes('@')) values.add(c.username);
      // A Role's headers and stored entries are secrets too (an API key, a session token).
      const extras = [...Object.values(c.headers ?? {}), ...Object.values(c.localStorageEntries ?? {})];
      for (const extra of extras) {
        if (typeof extra !== 'string') continue;
        // "Bearer abc": hide the token part as well, so it is caught wherever it appears on its own.
        const bare = extra.replace(/^(Bearer|Basic|Token)\s+/i, '');
        for (const v of [extra, bare]) if (v.length >= Math.max(minLength, MIN_EXTRA_SECRET_LENGTH)) values.add(v);
      }
    }
```

3. Update the class doc comment's first sentence to end with
   `..., a Role's header values and stored entries when they are 8 characters or longer, and the values of secret-looking URL parameters.`

## Tests

Edit `packages/core/tests/redaction.test.ts`. Inside `describe('Redactor', ...)` add (copy the way the first
test builds a `Redactor` and calls `.text(...)`):

```ts
  it('hides a Role’s header values and stored entries, and leaves short ordinary values', () => {
    const redactor = new Redactor([
      {
        role: 'member',
        headers: { 'X-Api-Key': 'k-9f3a77c2aa', Authorization: 'Bearer tok-1234567890', 'X-Lang': 'en' },
        localStorageEntries: { authToken: 'eyJhbGciOi.abc.def', theme: 'dark' },
      },
    ]);
    const out = redactor.text('key k-9f3a77c2aa bearer tok-1234567890 jwt eyJhbGciOi.abc.def lang en theme dark');
    expect(out).not.toContain('k-9f3a77c2aa');
    expect(out).not.toContain('tok-1234567890');
    expect(out).not.toContain('eyJhbGciOi.abc.def');
    expect(out).toContain('lang en');
    expect(out).toContain('theme dark');
  });
```

Command: `pnpm exec vitest run packages/core/tests/redaction.test.ts`

## Done when

- [ ] The new test passes and every existing test in the file still passes
- [ ] `pnpm build` passes

## Notes

Owner decision recorded here: the 8-character floor. A lower floor would blank out ordinary words in reports.
