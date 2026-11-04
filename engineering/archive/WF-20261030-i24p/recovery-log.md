# Recovery log

> **Append-only.** Entries are written by `aieos recovery` and `aieos check run` when a check linked to an
> open recovery item is re-run. At most 3 correction attempts per failure. The third failed attempt marks
> the item, its task and the workflow `BLOCKED` until a developer intervenes.

## Open items

<!-- ai-eos:begin open -->
| ID | Status | Check | Category | Tasks | Responsible | Attempts | Last evidence |
|---|---|---|---|---|---|---|---|
| REC-002 | OPEN | CHK-NODE-UNIT | test | QA-003 | qa-engineer | 0/3 | EV-0006 |
<!-- ai-eos:end open -->

## Log

### REC-001 · opened · 2026-10-31T06:36:24.492Z
- Check: CHK-SECRETS (security) · Category: security
- Tasks: BE-011 · Requirements: REQ-041 · Responsible: backend-engineer
- Failing evidence: EV-0007 (exit code 1; } · Node.js v24.1.0)
- Attempt budget: 3
- Failure excerpt:

```text
node:internal/modules/cjs/loader:1408
  throw err;
  ^

Error: Cannot find module 'C:\Users\HP\OneDrive\Desktop\Projects\AntiGravity - Google - Projects\QA Tool\scripts\scan-commit-secrets.mjs'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1405:15)
    at defaultResolveImpl (node:internal/modules/cjs/loader:1061:19)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1066:22)
    at Module._load (node:internal/modules/cjs/loader:1215:37)
    at TracingChannel.traceSync (node:diagnostics_channel:322:14)
    at wrapModuleLoad (node:internal/modules/cjs/loader:235:24)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:152:5)
    at node:internal/main/run_main_module:33:47 {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v24.1.0
```

### REC-002 · opened · 2026-10-31T10:01:16.500Z
- Check: CHK-NODE-UNIT (unit) · Category: test
- Tasks: QA-003 · Requirements: — · Responsible: qa-engineer
- Failing evidence: EV-0006 (exit code 1; Test Files  29 failed | 219 passed (248))
- Attempt budget: 3
- Failure excerpt:

```text
starts a clean signed-in scan with the first check-up’s specs, and stopping keeps the form
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Go deeper: test the signed-in pages' })

 ❯ packages/wizard/tests/wizard-e2e.test.ts:768:85
    766|   it('Go deeper starts a clean signed-in scan with the first check-up’…
    767|     await page.goto(`${toolUrl}/reports/${secondRunId}`);
    768|     await page.getByRole('button', { name: 'Go deeper: test the signed…
       |                                                                                     ^
    769|     await page.getByLabel('Email or username').fill('manager@example.c…
    770|     await page.getByLabel('Password').fill('manager-password');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[39/68]⎯

 FAIL  packages/wizard/tests/wizard-e2e.test.ts > Release check-up end to end, on the one server > Settings: the key in use, and replacing it
TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
Call log:
  - waiting for getByText('✓ Saved') to be visible

 ❯ packages/wizard/tests/wizard-e2e.test.ts:814:37
    812|     await page.waitForURL(`${toolUrl}/settings`);
    813|     await expect.poll(() => heading(page)).toBe('Settings');
    814|     await page.getByText('✓ Saved').waitFor();
       |                                     ^
    815|     await page.getByText(FREE_MODEL.id).waitFor();
    816|     expectPlain(await plainText(page), 'settings');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[40/68]⎯
```

#### REC-001 · attempt 1/3 · PASS · EV-0011 · 2026-10-31T12:22:24.580Z
- Result: exit code 0; Scanned 449 file(s) that would be committed (300 left out by the .gitleaks.toml allowlist, 1 {{...}} placeholder(s) ignored): 0 finding(s). Values are not printed.

#### REC-001 · RESOLVED · 2026-10-31T12:22:24.580Z
- Re-run related regression checks before completing (aieos gate lists them).
