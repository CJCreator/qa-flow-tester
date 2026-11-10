# T-115: Repro scripts escape every value taken from the site

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | core | security | built |

**Files you may edit (no others):**
- `packages/core/src/repro-generator.ts`
- `packages/core/tests/repro-generator.test.ts`

**Do not build in parallel with:** none.

## Problem

`ReproScriptGenerator.generate` writes a TypeScript file the person is told to run (`npx tsx ...`). Selectors,
step values, the base address, the start page and the page path are pasted between single quotes with no
escaping. Expected/actual escape `'` only (not `\` or newlines). The title sits in a block comment and can
contain `*/`.

Scenarios:
- A selector `[aria-label='Close']` produces `page.locator('[aria-label='Close']')`: the script does not parse.
- Text read from the checked site (a title, an expected value) containing `'); require('child_process')...`
  becomes code in a script the person runs.

## Current code

`packages/core/src/repro-generator.ts:17-31` (branch `worktree-audit-cleanup`)

```ts
    const stepsCode =
      testCase?.steps
        .map((s) => {
          if (s.action === 'click') {
            return `  // Step: ${s.name}\n  await page.locator('${s.selector}').click();`;
          }
          if (s.action === 'fill') {
            return `  // Step: ${s.name}\n  await page.locator('${s.selector}').fill('${s.value || ''}');`;
          }
          if (s.action === 'navigate') {
            return `  // Step: ${s.name}\n  await page.goto('${s.value}');`;
          }
          return `  // Step: ${s.name}\n  await page.waitForTimeout(500);`;
        })
        .join('\n\n') || `  // Finding reproduced on page\n  await page.goto('${finding.where.urlPath}');`;
```

and in the template below it:

```ts
 * Standalone Playwright Reproduction Script for Finding ${finding.id}
 * Title: ${finding.title}
 * Severity: ${finding.severity}
 * Checker: ${finding.checker}
...
    baseURL: '${baseUrl}',
...
  console.log('Navigating to initial page: ${testCase?.startPage || finding.where.urlPath}');
  await page.goto('${testCase?.startPage || finding.where.urlPath}');
...
  console.log('Expected: ${finding.expectedVsActual.expected.replace(/'/g, "\\'")}');
  console.log('Actual:   ${finding.expectedVsActual.actual.replace(/'/g, "\\'")}');
```

## Change

1. Above `export class ReproScriptGenerator`, add two helpers:

```ts
/** A value as a single-quoted JavaScript string literal, quotes included. */
function js(value: unknown): string {
  const text = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029');
  return `'${text}'`;
}

/** Text that is safe inside a comment: one line, and it cannot close a block comment. */
function comment(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n  ]+/g, ' ')
    .replace(/\*\//g, '* /');
}
```

2. Rewrite `stepsCode` so every quoted value goes through `js(...)` and every step name through `comment(...)`:

```ts
    const stepsCode =
      testCase?.steps
        .map((s) => {
          const label = `  // Step: ${comment(s.name)}\n`;
          if (s.action === 'click') return `${label}  await page.locator(${js(s.selector)}).click();`;
          if (s.action === 'fill') return `${label}  await page.locator(${js(s.selector)}).fill(${js(s.value || '')});`;
          if (s.action === 'navigate') return `${label}  await page.goto(${js(s.value)});`;
          return `${label}  await page.waitForTimeout(500);`;
        })
        .join('\n\n') || `  // Finding reproduced on page\n  await page.goto(${js(finding.where.urlPath)});`;
```

3. In the template:
   - Header: `Finding ${comment(finding.id)}`, `Title: ${comment(finding.title)}`,
     `Severity: ${comment(finding.severity)}`, `Checker: ${comment(finding.checker)}`.
   - `baseURL: ${js(baseUrl)},` (no surrounding quotes in the template any more).
   - Add before the template: `const startPage = testCase?.startPage || finding.where.urlPath;`
   - `console.log(${js(`Navigating to initial page: ${startPage}`)});`
   - `await page.goto(${js(startPage)});`
   - `console.log(${js(`Expected: ${finding.expectedVsActual.expected}`)});`
   - `console.log(${js(`Actual:   ${finding.expectedVsActual.actual}`)});`

4. The file name uses `finding.id`. Make it safe:
   `const filename = `repro-${finding.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.ts`;`

## Tests

Edit `packages/core/tests/repro-generator.test.ts`. The existing test must pass unchanged (it expects
`await page.locator('#amount').fill('500');`, `await page.locator('#save-btn').click();`, and `http://localhost:3050`).

Add `it('escapes quotes, backslashes, newlines and comment ends', ...)`. Copy `mockFinding`/`mockTestCase` from
the first test and change:

- `title: 'Ends a comment */ here'`
- `expectedVsActual: { expected: "it's fine\nsecond line", actual: 'a\\b' }`
- steps: `[{ action: 'click', selector: "[aria-label='Close']", name: 'Close\nthe dialog' }]`

Expect the file content:
- to contain `await page.locator('[aria-label=\\'Close\\']').click();`
- to contain `'Expected: it\\'s fine\\nsecond line'`
- to contain `'Actual:   a\\\\b'`
- not to contain `*/ here`
- to contain `// Step: Close the dialog`

Then prove it parses: `expect(() => new Function(fileContent.replace(/^import .*$/m, '').replace(/await /g, ''))).not.toThrow();`
(strips the import and `await` so `new Function` can parse a plain script; it is never executed).

Command: `pnpm exec vitest run packages/core/tests/repro-generator.test.ts`

## Done when

- [x] No `'${` remains in `repro-generator.ts`
- [x] Both tests pass
- [x] `pnpm build` passes

## Notes

Do not change what the script does, only how values are written into it.
