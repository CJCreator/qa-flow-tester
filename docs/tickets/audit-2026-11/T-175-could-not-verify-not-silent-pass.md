# T-175: a design or security check that could not run reads as a pass

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | checkers | inconsistency | built |

**Files you may edit (no others):**
- `packages/checkers/src/could-not-verify.ts`
- `packages/checkers/src/design-standards.ts`
- `packages/checkers/src/security.ts`
- `packages/checkers/tests/design-ux-checkers.test.ts`
- `packages/checkers/tests/security.test.ts`

**Do not build in parallel with:** T-162, T-177 (same file `security.ts`).

## Problem
`could-not-verify.ts` states the rule: "A check that could not run is reported as 'Could not verify', never as passed." Two checkers break it:
- `DesignStandardsChecker.check` swallows any error from its page read and returns no findings: the design tokens look as if they matched.
- `SecurityChecker.checkPage` turns a failed page read into "nothing found" three times (`.catch(() => false)`, `.catch(() => [])`, `.catch(() => null)`): the password-form, insecure-resource and stack-trace checks look as if they passed.

Scenario: the page navigates away while the checks run. `page.evaluate` throws. The report shows no security or design finding for that page and counts it as checked.

## Current code
`packages/checkers/src/could-not-verify.ts:7-12` (branch `worktree-audit-cleanup`)
```ts
export function couldNotVerifyFinding(
  checker: 'performance' | 'seo' | 'ux-quality',
  what: string,
  context: { testCaseId?: string; flowId?: string; role: string; breakpoint: Breakpoint; urlPath: string },
  categoryTag?: Finding['categoryTag']
): Finding {
```
`packages/checkers/src/design-standards.ts:207-212`
```ts
    } catch {
      // Ignore evaluation errors
    }

    return findings;
  }
```
`packages/checkers/src/security.ts`, inside `checkPage` (three places):
```ts
    const hasGetPasswordForm = await page
      .evaluate(() =>
        ...
      )
      .catch(() => false);
```
```ts
    const insecureResources = await page
      .evaluate(() => {
        ...
      })
      .catch(() => []);
```
```ts
    const exposedStackTrace = await page
      .evaluate((patternStr) => {
        ...
      }, STACK_TRACE_PATTERN.source)
      .catch(() => null);
```
End of `checkPage` (`:284-287`):
```ts
    }

    return findings;
  }
```

## Change
1. `could-not-verify.ts`: widen the first parameter's type:
```ts
  checker: 'performance' | 'seo' | 'ux-quality' | 'design-standards' | 'security',
```
2. `design-standards.ts`: add the import under the existing imports:
```ts
import { couldNotVerifyFinding } from './could-not-verify.js';
```
   and replace the `catch` shown above with:
```ts
    } catch {
      // The page could not be read: say so, never read as a match.
      findings.push(couldNotVerifyFinding('design-standards', 'whether the page matches the design tokens', context));
    }
```
3. `security.ts`: add the same import. At the top of `checkPage`, right after `const findings: Finding[] = [];`, add:
```ts
    // Set when a page read fails: the check did not run, which is not the same as nothing found.
    let unverified = false;
    const failedWith =
      <T>(fallback: T) =>
      (): T => {
        unverified = true;
        return fallback;
      };
```
   Replace the three catches:
   - `.catch(() => false);` on `hasGetPasswordForm` becomes `.catch(failedWith(false));`
   - `.catch(() => []);` on `insecureResources` becomes `.catch(failedWith([] as Array<{ tag: string; src: string }>));`
   - `.catch(() => null);` on `exposedStackTrace` becomes `.catch(failedWith(null));`

   Do not change the `.catch(() => [])` calls on `page.context().cookies(...)` or the catch inside `checkCsrf`.
   Just before the final `return findings;` of `checkPage`, add:
```ts
    if (unverified) {
      findings.push(couldNotVerifyFinding('security', 'the page-level security checks', context));
    }
```

## Tests
Both test files are in the `browser` tier (real Chromium is launched in the file), so run them with `--project browser`.

1. `packages/checkers/tests/design-ux-checkers.test.ts`: add a test next to the other `DesignStandardsChecker` tests. Build the checker the way the file does, pass tokens `{ colors: { primary: '#ff0000' } }`, a page `{ evaluate: async () => { throw new Error('boom'); } } as never`, and a context copied from a neighbouring test. Expect exactly one finding with `title` `Could not verify: whether the page matches the design tokens`, `needsConfirmation` true, `checker` `'design-standards'`.
2. `packages/checkers/tests/security.test.ts`: add a test. Page:
```ts
      const mockPage = {
        url: () => 'https://shop.test/',
        evaluate: async () => {
          throw new Error('boom');
        },
        context: () => ({ cookies: async () => [] }),
      } as unknown as Page;
```
   Call `checker.checkPage(mockPage, { ...base })` (the file's existing `base` context; if it has no `urlPath`, add `urlPath: '/'`). Expect one finding with `title` `Could not verify: the page-level security checks` and `needsConfirmation` true, and exactly one such finding (not three).
3. Run:
   `pnpm exec vitest run --project browser packages/checkers/tests/design-ux-checkers.test.ts packages/checkers/tests/security.test.ts`
   Install Chromium first if needed: `pnpm --filter @qa/core exec playwright install chromium`.
4. `pnpm build`

If an existing test now gets the extra "Could not verify" finding, its mock page throws inside `evaluate` by accident. Fix the mock so `evaluate` resolves (`async () => []` or `async () => false`); do not remove the new finding.

## Done when
- [x] Both new tests pass; all other tests in the two files pass.
- [x] `pnpm build` passes.

## Notes
- The finding is `Suggestion` with `needsConfirmation: true`: it is listed, and never counts toward the grades or the Release Verdict.
- Wording rule (ADR 0018): never write that a page "is secure" or "passes".
- Out of scope: `security-depth.ts` (its per-step catch), `checkCsrf`, and the accessibility scan failure in `ux-quality.ts`, which is deliberately a counted Major.
