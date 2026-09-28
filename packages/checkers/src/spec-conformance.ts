import type { Page } from 'playwright';
import type { Finding, TestCase, StepEvidence, Breakpoint } from '@qa/types';

/** Elements sites commonly use to show a validation or error message. */
const ERROR_MESSAGE_SELECTOR = [
  '[role="alert"]',
  '[aria-live="assertive"]',
  '[aria-live="polite"]',
  '[class*="error" i]',
  '[class*="invalid" i]',
  '[data-test*="error" i]',
  '[data-testid*="error" i]',
].join(', ');

/**
 * Whether one of the addresses matches an expected page. The expectation may be a plain address
 * ("/inventory-item.html?id=4", where "?" and "." mean themselves), a wildcard ("/invoices/*"), or
 * a regular expression ("/dashboard|/account", "^/invoices/new$").
 */
export function urlMatchesPattern(pattern: string, addresses: string[]): boolean {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const asWildcard = new RegExp('^' + pattern.split('*').map(escape).join('.*') + '$');
  let asRegex: RegExp | null = null;
  try {
    asRegex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + '$');
  } catch {
    // Not a valid regular expression: the plain reading is all there is.
  }
  return addresses.some((a) => asWildcard.test(a) || !!asRegex?.test(a));
}

const GUESS_RESOLUTION =
  'This expectation is an AI guess that nobody has confirmed. Confirm or correct it in the plan review; if the site behaves as intended, mark this check as intended.';

export class SpecConformanceChecker {
  async check(
    page: Page,
    testCase: TestCase,
    stepEvidenceList: StepEvidence[],
    context: {
      role: string;
      breakpoint: Breakpoint;
      baseUrl: string;
      /** Receives what the site was seen doing, such as the error message it showed. */
      onObservation?: (observation: string) => void;
    }
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    let counter = 1;
    const currentUrl = page.url();

    // An AI guess that doesn't match can't fail the site: it becomes "Could not verify".
    const isGuess = testCase.expectations.origin === 'ai-guess';
    const asGuess = (finding: Finding, plainTitle: string): Finding =>
      isGuess
        ? { ...finding, severity: 'Suggestion', needsConfirmation: true, title: plainTitle, resolution: GUESS_RESOLUTION }
        : finding;

    // 0. Behaviour check for a guessed validation rule: some error must appear, in any wording.
    if (testCase.expectations.validationError) {
      const { field, selector, description } = testCase.expectations.validationError;
      const fieldState = selector
        ? await page
            .locator(selector)
            .first()
            .evaluate((el) => {
              const input = el as HTMLInputElement;
              const invalid = (input.validity ? !input.validity.valid : false) || el.getAttribute('aria-invalid') === 'true';
              return { invalid, message: input.validationMessage || '' };
            }, undefined, { timeout: 2000 })
            .catch(() => ({ invalid: false, message: '' }))
        : { invalid: false, message: '' };
      const shownMessages = await page
        .evaluate((errorSelector) => {
          const out: string[] = [];
          for (const node of Array.from(document.querySelectorAll(errorSelector))) {
            const el = node as HTMLElement;
            const rect = el.getBoundingClientRect();
            const text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
            if (text && rect.width > 0 && rect.height > 0 && !out.includes(text)) out.push(text);
          }
          return out.slice(0, 5);
        }, ERROR_MESSAGE_SELECTOR)
        .catch(() => [] as string[]);

      if (shownMessages.length > 0 || fieldState.invalid) {
        const shown = shownMessages[0] || fieldState.message || 'the field is marked as invalid';
        context.onObservation?.(`Leaving "${field}" empty shows: "${shown}"`);
      } else {
        findings.push(
          asGuess(
            {
              id: `F-SPEC-${testCase.id}-${counter++}`,
              testCaseId: testCase.id,
              flowId: testCase.flowId,
              severity: 'Major',
              checker: 'spec-conformance',
              title: `No error appeared after leaving "${field}" empty`,
              where: {
                urlPath: new URL(currentUrl, context.baseUrl).pathname,
                role: context.role,
                breakpoint: context.breakpoint,
                cssSelector: selector,
              },
              expectedVsActual: {
                expected: description || `An error appears when "${field}" is left empty`,
                actual: 'No error message or invalid-field marker appeared',
              },
              stepsToReproduce: [
                `Navigate to ${testCase.startPage}`,
                ...testCase.steps.map((s) => `Execute "${s.name}"`),
                `Look for an error message about "${field}"`,
              ],
              evidence: {
                screenshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.screenshotPath,
                domSnapshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.domSnapshotPath,
              },
              resolution: `Show an error next to "${field}" when it is left empty.`,
              verifyCommand: `qa-test verify F-SPEC-${testCase.id}-${counter - 1}`,
            },
            `Could not verify: no error appeared after leaving "${field}" empty. Confirm whether it should be required.`
          )
        );
      }
    }

    // 1. URL Pattern Check
    if (testCase.expectations.url) {
      const pattern = testCase.expectations.url.pattern;
      const landed = new URL(currentUrl, context.baseUrl);
      const urlPath = landed.pathname;

      if (!urlMatchesPattern(pattern, [urlPath, urlPath + landed.search, currentUrl])) {
        findings.push(asGuess({
          id: `F-SPEC-${testCase.id}-${counter++}`,
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          severity: 'Blocker',
          checker: 'spec-conformance',
          title: `URL did not match expected pattern: "${pattern}"`,
          where: {
            urlPath,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `URL matches pattern: ${pattern} (${testCase.expectations.url.description || ''})`,
            actual: `Current URL is ${urlPath}`,
          },
          stepsToReproduce: [
            `Navigate to ${testCase.startPage}`,
            ...testCase.steps.map((s) => `Perform "${s.name}" (${s.action})`),
            `Assert URL matches ${pattern}`,
          ],
          evidence: {
            screenshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.screenshotPath,
          },
          resolution: `Check routing or navigation logic after executing "${testCase.steps[testCase.steps.length - 1]?.name}".`,
          verifyCommand: `qa-test verify F-SPEC-${testCase.id}-${counter - 1}`,
        }, `Could not verify: expected to end on a page matching "${pattern}", but ended on "${urlPath}".`));
      }
    }

    // 2. Visible Text Check (the page title counts: AIs often quote it)
    if (testCase.expectations.text) {
      const { contains, notContains, description } = testCase.expectations.text;
      const pageText = `${await page.title().catch(() => '')}\n${await page.innerText('body').catch(() => '')}`;

      if (contains && !pageText.includes(contains)) {
        findings.push(asGuess({
          id: `F-SPEC-${testCase.id}-${counter++}`,
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          severity: 'Major',
          checker: 'spec-conformance',
          title: `Expected text not found: "${contains}"`,
          where: {
            urlPath: new URL(currentUrl).pathname,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `Page contains "${contains}" (${description || ''})`,
            actual: `Text "${contains}" was absent from the page body`,
          },
          stepsToReproduce: [
            `Navigate to ${testCase.startPage}`,
            ...testCase.steps.map((s) => `Execute "${s.name}"`),
            `Check page content for "${contains}"`,
          ],
          evidence: {
            screenshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.screenshotPath,
            domSnapshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.domSnapshotPath,
          },
          resolution: `Verify UI notification, success banner, or component rendering logic.`,
          verifyCommand: `qa-test verify F-SPEC-${testCase.id}-${counter - 1}`,
        }, `Could not verify: expected the page to say "${contains}".`));
      }

      if (notContains && pageText.includes(notContains)) {
        findings.push(asGuess({
          id: `F-SPEC-${testCase.id}-${counter++}`,
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          severity: 'Major',
          checker: 'spec-conformance',
          title: `Disallowed text appeared: "${notContains}"`,
          where: {
            urlPath: new URL(currentUrl).pathname,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `Page does NOT contain "${notContains}" (${description || ''})`,
            actual: `Text "${notContains}" was present in the page body`,
          },
          stepsToReproduce: [
            `Navigate to ${testCase.startPage}`,
            ...testCase.steps.map((s) => `Execute "${s.name}"`),
            `Verify page does not show "${notContains}"`,
          ],
          evidence: {
            screenshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.screenshotPath,
          },
          resolution: `Remove error state or unauthorized content for role "${context.role}".`,
          verifyCommand: `qa-test verify F-SPEC-${testCase.id}-${counter - 1}`,
        }, `Could not verify: expected the page not to say "${notContains}".`));
      }
    }

    // 3. API Call expectation
    if (testCase.expectations.apiCall) {
      const { method, path: apiPath, status } = testCase.expectations.apiCall;
      const allNetwork = stepEvidenceList.flatMap((s) => s.failedRequests); // plus recorded
      // Check if matched
      const matched = stepEvidenceList.some((s) =>
        s.failedRequests.some(
          (r) => r.method === method && r.url.includes(apiPath) && r.status === status
        )
      );
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
          stepsToReproduce: [
            `Navigate to ${testCase.startPage}`,
            ...testCase.steps.map((s) => `Execute "${s.name}"`),
          ],
          evidence: {
            networkLogs: [failedMatch],
          },
          resolution: `Inspect API endpoint handler for ${method} ${apiPath}.`,
          verifyCommand: `qa-test verify F-SPEC-${testCase.id}-${counter - 1}`,
        });
      }
    }

    return findings;
  }
}
