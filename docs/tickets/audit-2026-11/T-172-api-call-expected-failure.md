# T-172: an API call expected to be refused gives no finding when it is accepted or never made

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | todo |

**Files you may edit (no others):**
- `packages/checkers/src/spec-conformance.ts`
- `packages/checkers/tests/spec-denial.test.ts` (or a new `packages/checkers/tests/spec-api-call.test.ts` if that file's set-up does not fit)

**Do not build in parallel with:** T-179 (same source file).

## Problem
A Test can state an API expectation: `expectations.apiCall = { method, path, status }` (only hand-written spec files set it). The check reads only the failed requests of the steps (answers of 400 and above). It reports a mismatch only when a failed request for that method and path exists with a different status.

When the expectation is that the call is refused (`status` 401, 403, 422...) and the App accepts it (200) or never makes it, there is no failed request at all, so nothing is reported. An App that lets through what it should refuse passes silently.

## Current code
`packages/checkers/src/spec-conformance.ts:546-578` (branch `worktree-audit-cleanup`)
```ts
    // 3. API Call expectation
    if (testCase.expectations.apiCall) {
      const { method, path: apiPath, status } = testCase.expectations.apiCall;
      // If the expected API call failed with a different status
      const failedMatch = stepEvidenceList
        .flatMap((s) => s.failedRequests)
        .find((r) => r.method === method && r.url.includes(apiPath));

      if (failedMatch && failedMatch.status !== status) {
        findings.push({
          id: `F-SPEC-${testCase.id}-${counter++}`,
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          severity: 'Blocker',
          checker: 'spec-conformance',
          title: `API call status mismatch: ${method} ${apiPath} returned ${failedMatch.status}`,
          where: {
            urlPath: new URL(currentUrl).pathname,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `${method} ${apiPath} should return HTTP ${status}`,
            actual: `Returned HTTP ${failedMatch.status}`,
          },
          stepsToReproduce: [`Navigate to ${testCase.startPage}`, ...testCase.steps.map((s) => `Execute "${s.name}"`)],
          evidence: {
            networkLogs: [failedMatch],
          },
          resolution: `Inspect API endpoint handler for ${method} ${apiPath}.`,
        });
      }
    }
```

## Change
Add an `else if` branch to the existing `if (failedMatch && failedMatch.status !== status) { ... }`. Keep the existing branch exactly as it is. After its closing brace add:
```ts
      else if (!failedMatch && status >= 400) {
        // The call was expected to be refused, and no refused request for it was recorded: it was
        // accepted, or it was never made. Only failed requests are recorded, so the two cannot be told apart.
        findings.push({
          id: `F-SPEC-${testCase.id}-${counter++}`,
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          severity: 'Major',
          checker: 'spec-conformance',
          title: `API call was not refused: ${method} ${apiPath} did not return ${status}`,
          where: {
            urlPath: new URL(currentUrl).pathname,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `${method} ${apiPath} should return HTTP ${status}`,
            actual: `No refused ${method} request to ${apiPath} was seen during the steps: the call was accepted, or it was not made`,
          },
          stepsToReproduce: [`Navigate to ${testCase.startPage}`, ...testCase.steps.map((s) => `Execute "${s.name}"`)],
          evidence: {},
          resolution: `Check that the steps make the ${method} ${apiPath} request and that the endpoint refuses it with HTTP ${status}.`,
          needsConfirmation: true,
        });
      }
```
`needsConfirmation: true` because the checker cannot tell "accepted" from "never made". It is listed for a person to confirm and does not count toward the verdict.

## Tests
First look at `packages/checkers/tests/spec-denial.test.ts` for how `SpecConformanceChecker` is built and called (the checker class, a mock `page`, a `testCase`, a `stepEvidenceList` and a `context`). Copy that set-up into a new `describe('API call expectation', ...)`; if the set-up is hard to reuse, create `packages/checkers/tests/spec-api-call.test.ts` with the same imports. Use a Test with
`expectations: { apiCall: { method: 'POST', path: '/api/orders', status: 403 } }` and step evidence whose `failedRequests` are:

| failedRequests | expected finding |
|---|---|
| `[]` | one finding, title `API call was not refused: POST /api/orders did not return 403`, `needsConfirmation` true, severity `Major` |
| `[{ url: 'https://app.test/api/orders', method: 'POST', status: 403, timestamp: 1 }]` | no `API call` finding |
| `[{ url: 'https://app.test/api/orders', method: 'POST', status: 500, timestamp: 1 }]` | one finding, title `API call status mismatch: POST /api/orders returned 500`, severity `Blocker` (existing behaviour) |

And one more case with `status: 200` in the expectation and `failedRequests: []`: no `API call` finding (a successful call leaves no failed request; that is the normal pass).

Filter findings with `f.title.startsWith('API call')` so other checks of the Test do not disturb the assertions.

Run: `pnpm exec vitest run packages/checkers/tests/spec-denial.test.ts` (or the new file)

## Done when
- [ ] The four cases pass; existing spec tests pass unchanged.
- [ ] `pnpm build` passes.

## Notes
- `NetworkEntry` is `{ url, method, status, timestamp, ... }` (`packages/types/src/evidence-finding.ts:14`).
- Out of scope: recording every response (not only failed ones) in the step evidence. That is a core change; without it a wrong 2xx status (expected 201, got 200) cannot be detected.
