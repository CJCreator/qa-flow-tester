# T-234: the CSRF check and the security-depth checks that could not run read as a pass

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | checkers | inconsistency | todo |

**Files you may edit (no others):**

- `packages/checkers/src/security.ts`
- `packages/checkers/src/security-depth.ts`
- `packages/checkers/tests/security.test.ts`
- `packages/checkers/tests/security-depth.test.ts`

**Do not build in parallel with:** nothing.

## Problem

`could-not-verify.ts` states the rule: a check that could not run is reported as "Could not verify", never as passed. T-175 fixed this for the three page reads in `SecurityChecker.checkPage`, and left two places out of scope. Both are real:

1. `SecurityChecker.checkCsrf` reads the page's forms with `.catch(() => [])`. If the read fails (the page navigated away), the check reports nothing, as if every form had a CSRF token.
2. `SecurityDepthChecker.checkPage` runs its checks one by one inside `try { ... } catch { /* adds nothing */ }`. If the page read for the integrity-attribute check (SRI) or the source-map check throws, the report shows nothing for it, as if the page was clean.

## Current code

Find them with `grep -n "catch(() => \[\])" packages/checkers/src/security.ts` and `grep -n "const steps" -A30 packages/checkers/src/security-depth.ts`.

`packages/checkers/src/security.ts`, in `checkCsrf`:

```ts
      }, CSRF_TOKEN_NAME.source)
      .catch(() => []);
    if (!Array.isArray(raw) || raw.length === 0) return [];
```

`packages/checkers/src/security-depth.ts`, in `checkPage`:

```ts
const steps: Array<() => Promise<Finding[]> | Finding[]> = [
  async () => this.checkSri(page, context, await tags()),
  () => this.checkCsp(context.cspHeader, context),
  () => this.checkTls(page.url(), context),
];
if (onTarget && fetchFn) {
  steps.push(
    async () => this.checkSourceMaps(page, context, fetchFn, await tags()),
    () => this.checkSecurityTxt(fetchFn, context, pageOrigin)
  );
} else if (onTarget) {
  // No safe fetch was given (ADR 0031): no request at all, and the checks say so instead of passing.
  steps.push(() => this.notChecked(context, pageOrigin));
}
for (const step of steps) {
  try {
    findings.push(...(await step()));
  } catch {
    // A check that cannot run adds nothing; the others still report.
  }
}
return findings;
```

`couldNotVerifyFinding(checker, what, context, categoryTag?)` is in `packages/checkers/src/could-not-verify.ts` and already accepts `'security'`. It builds the id `F-UNVERIFIED-security-GEN-<testCaseId>`, the same for every call with the same test, so two of them for one page would share an id.

`security.ts` already imports `couldNotVerifyFinding`. `security-depth.ts` does not.

## Change

### security.ts

1. In `checkCsrf`, replace `.catch(() => []);` (the one directly after `}, CSRF_TOKEN_NAME.source)`) with `.catch(() => null);`, and replace the next line with:

```ts
if (raw === null) {
  // The forms could not be read: say so, never read as "every form has a token".
  return [
    {
      ...couldNotVerifyFinding('security', 'whether forms carry a CSRF token', context),
      id: `F-UNVERIFIED-security-CSRF-${context.testCaseId || 'GEN'}`,
    },
  ];
}
if (!Array.isArray(raw) || raw.length === 0) return [];
```

Do not change the `.catch(() => [])` on the cookie read below it.

### security-depth.ts

2. Add `import { couldNotVerifyFinding } from './could-not-verify.js';` under the existing imports.

3. Replace the `const steps ... for (const step of steps) { ... }` block shown above with:

```ts
const steps: Array<{ key: string; what: string; run: () => Promise<Finding[]> | Finding[] }> = [
  {
    key: 'SRI',
    what: 'whether scripts and stylesheets from other sites carry an integrity attribute',
    run: async () => this.checkSri(page, context, await tags()),
  },
  { key: 'CSP', what: 'the Content-Security-Policy', run: () => this.checkCsp(context.cspHeader, context) },
  { key: 'TLS', what: 'the connection to the page', run: () => this.checkTls(page.url(), context) },
];
if (onTarget && fetchFn) {
  steps.push(
    {
      key: 'SOURCEMAP',
      what: 'whether the site’s own scripts expose source maps',
      run: async () => this.checkSourceMaps(page, context, fetchFn, await tags()),
    },
    {
      key: 'TXT',
      what: 'the security.txt file',
      run: () => this.checkSecurityTxt(fetchFn, context, pageOrigin),
    }
  );
} else if (onTarget) {
  // No safe fetch was given (ADR 0031): no request at all, and the checks say so instead of passing.
  steps.push({
    key: 'NOTCHECKED',
    what: 'security.txt and source maps',
    run: () => this.notChecked(context, pageOrigin),
  });
}
for (const step of steps) {
  try {
    findings.push(...(await step.run()));
  } catch {
    // A check that cannot run is said so, never read as a pass. One finding per check, with its own id.
    findings.push({
      ...couldNotVerifyFinding('security', step.what, context),
      id: `F-UNVERIFIED-security-${step.key}-${context.testCaseId || 'GEN'}`,
    });
  }
}
return findings;
```

The wording rule (ADR 0018) holds: the new titles say "Could not verify: ..." and never that anything is secure or passes.

4. Run `pnpm exec prettier --write` on the two source files and the two test files.

## Tests

1. `packages/checkers/tests/security.test.ts` (browser tier file), inside `describe('passive CORS and CSRF checks (QSP-010)', ...)`, which has `base` in scope. Add:

```ts
it('reports a CSRF check that could not read the page instead of finding nothing', async () => {
  const proxy = {
    evaluate: async () => {
      throw new Error('boom');
    },
    url: () => 'https://shop.test/',
    context: () => ({ cookies: async () => [] }),
  } as unknown as Page;
  const findings = await checker.checkCsrf(proxy, base);
  expect(findings).toHaveLength(1);
  expect(findings[0].title).toBe('Could not verify: whether forms carry a CSRF token');
  expect(findings[0].needsConfirmation).toBe(true);
  expect(findings[0].checker).toBe('security');
  expect(findings[0].id).toBe('F-UNVERIFIED-security-CSRF-GEN');
});
```

Also open the existing test `reports page-level security checks that could not run instead of a clean pass`: its page also fails the CSRF read now, so `checkPage` returns one more finding. The test filters by title and still passes; do not change it. Add one line to it: `expect(findings.filter((f) => f.title === 'Could not verify: whether forms carry a CSRF token')).toHaveLength(1);`.

2. `packages/checkers/tests/security-depth.test.ts` (unit tier), in `describe('checkPage', ...)` (`ORIGIN`, `ctx`, `spy`, `res` and `Page` are in scope). Add:

```ts
it('says so when the page read for a check fails, with one finding per check and distinct ids', async () => {
  const fetchFn = spy(async (url) => (url.endsWith('security.txt') ? res(404, '') : res(200, 'var a;')));
  const throwing = {
    url: () => `${ORIGIN}/`,
    evaluate: vi.fn().mockRejectedValue(new Error('x')),
  } as unknown as Page;
  const f = await new SecurityDepthChecker().checkPage(throwing, ctx(), fetchFn);
  const unverified = f.filter((x) => x.title.startsWith('Could not verify: '));
  expect(unverified.map((x) => x.title)).toEqual([
    'Could not verify: whether scripts and stylesheets from other sites carry an integrity attribute',
    'Could not verify: whether the site’s own scripts expose source maps',
  ]);
  expect(new Set(unverified.map((x) => x.id)).size).toBe(2);
  for (const x of unverified) {
    expect(x.needsConfirmation).toBe(true);
    expect(x.checker).toBe('security');
  }
  expectClaimWording(f);
});
```

The existing test `runs every check, tolerates a throwing one, ...` still passes: it only asserts that the `No security.txt file` finding is present.

3. Run:
   - `pnpm exec vitest run packages/checkers/tests/security-depth.test.ts`
   - `pnpm exec vitest run --project browser packages/checkers/tests/security.test.ts` (install Chromium first if needed: `pnpm --filter @qa/core exec playwright install chromium`)
   - `pnpm build`

If another existing test now sees an extra "Could not verify" finding, its mock page throws inside `evaluate` by accident. Fix the mock so `evaluate` resolves (`async () => []`); do not remove the new finding.

## Done when

- [ ] `grep -c "catch(() => \[\])" packages/checkers/src/security.ts` shows one less than before (only the cookie reads remain), and `security-depth.ts` has no empty `catch` comment saying "adds nothing".
- [ ] The three new or extended tests pass; all other tests in both files pass.
- [ ] `pnpm build` passes.

## Notes

- The finding is `Suggestion` with `needsConfirmation: true`: it is listed and never counts toward the grades or the Release Verdict.
- A page that navigates away mid-check now shows up to three "Could not verify" findings (page-level from T-175, CSRF, and one per depth check). Each is on its own id and merges across pages by title.
- Out of scope: the `.catch(() => [])` on the cookie reads (a failed cookie read only drops the cookie-flag and SameSite detail), and the inner `catch` blocks of `checkSourceMaps` and `checkSecurityTxt`, which handle one failed request each and are already reported by their own wording.
- Declined on purpose, not part of this ticket: running the `security.ts` reads with `Promise.all` (T-177: finding ids are numbered in order), and recording every API response for the `apiCall` expectation (T-172: a core change to the evidence, a feature, not a defect in this checker).
