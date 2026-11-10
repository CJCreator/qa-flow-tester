import type { Page } from 'playwright';
import type { Finding, TestCase, StepEvidence, Breakpoint } from '@qa/types';
import {
  captureRefusalBaseline,
  judgeRefusal,
  readRefusal,
  type RefusalBaseline,
  type RefusalExpectation,
} from './refusal-rule.js';

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

const GUESS_RESOLUTION =
  'This expectation is an AI guess that nobody has confirmed. Confirm or correct it in the plan review; if the site behaves as intended, mark this check as intended.';

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
    // Grouped, so the anchors bind to every alternative of "/dashboard|/account".
    asRegex = new RegExp('^(?:' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + ')$');
  } catch {
    // Not a valid regular expression: the plain reading is all there is.
  }
  return addresses.some((a) => asWildcard.test(a) || !!asRegex?.test(a));
}

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
      /** The page as it was right before the submit click of a refusal test. */
      refusalBaseline?: RefusalBaseline;
    }
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    let counter = 1;
    const currentUrl = page.url();

    // An AI guess that doesn't match can't fail the site: it becomes "Could not verify".
    const isGuess = testCase.expectations.origin === 'ai-guess';
    const asGuess = (finding: Finding, plainTitle: string): Finding =>
      isGuess
        ? {
            ...finding,
            severity: 'Suggestion',
            needsConfirmation: true,
            title: plainTitle,
            resolution: GUESS_RESOLUTION,
          }
        : finding;

    // 0. Behaviour check for a guessed validation rule: some error must appear, in any wording.
    if (testCase.expectations.validationError) {
      const { field, selector, description } = testCase.expectations.validationError;
      const fieldState = selector
        ? await page
            .locator(selector)
            .first()
            .evaluate(
              (el) => {
                const input = el as HTMLInputElement;
                const invalid =
                  (input.validity ? !input.validity.valid : false) || el.getAttribute('aria-invalid') === 'true';
                return { invalid, message: input.validationMessage || '' };
              },
              undefined,
              { timeout: 2000 }
            )
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
            },
            `Could not verify: no error appeared after leaving "${field}" empty. Confirm whether it should be required.`
          )
        );
      }
    }

    // 0b. Refusal rule: a form sent with a value it should not accept must be refused.
    const refusal = (testCase.expectations as { refusal?: RefusalExpectation }).refusal;
    // A probe-only Rejects item has no submit click, so the orchestrator took no baseline: take it here,
    // before the probe is read (as the Playwright export does).
    const refusalBaseline =
      context.refusalBaseline ??
      (refusal?.probeOnly ? await captureRefusalBaseline(page).catch(() => undefined) : undefined);
    if (refusal && refusalBaseline) {
      const seen = await readRefusal(page, {
        baseline: refusalBaseline,
        message: refusal.message,
        probeOnly: refusal.probeOnly,
      }).catch(() => null);
      if (seen) {
        const judged = judgeRefusal(seen, { message: refusal.message });
        const urlPath = new URL(currentUrl, context.baseUrl).pathname;
        const last = stepEvidenceList[stepEvidenceList.length - 1];
        const base = {
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          checker: 'spec-conformance' as const,
          where: { urlPath, role: context.role, breakpoint: context.breakpoint },
          stepsToReproduce: [
            `Navigate to ${testCase.startPage}`,
            ...testCase.steps.map((s) => `Execute "${s.name}"`),
            `Look at the page`,
          ],
          evidence: { screenshotPath: last?.screenshotPath, domSnapshotPath: last?.domSnapshotPath },
        };
        if (judged.crashed) {
          findings.push({
            ...base,
            id: `F-SPEC-${testCase.id}-${counter++}`,
            severity: 'Major',
            title: `${urlPath} broke when the form was sent`,
            expectedVsActual: {
              expected: `The form at ${refusal.formPath} refuses the value and stays usable`,
              actual: 'The page showed an error page, an error status or nothing',
            },
            resolution: 'Make the form answer a value it cannot accept with a message, not a failure.',
          });
        } else if (!judged.refused) {
          findings.push(
            asGuess(
              {
                ...base,
                id: `F-SPEC-${testCase.id}-${counter++}`,
                // A Source-backed one is re-worded by withSourceWording to docSeverity ?? Major.
                severity: testCase.docSource ? 'Major' : 'Minor',
                title: `The form at ${refusal.formPath} accepted a value it should refuse`,
                expectedVsActual: {
                  expected: `The form refuses the value: it stays on the page, adds nothing, and shows an error`,
                  actual: seen.moved
                    ? 'The page moved on after the form was sent'
                    : seen.newRecord
                      ? 'A new record appeared'
                      : 'No error, invalid field or alert appeared',
                },
                resolution: 'Check the value on the server and show a message next to the field.',
              },
              `Could not verify: the form at ${refusal.formPath} seems to accept a value it should refuse. Confirm the limit.`
            )
          );
        } else if (judged.messageMatches === false) {
          findings.push({
            ...base,
            id: `F-SPEC-${testCase.id}-${counter++}`,
            severity: 'Major',
            title: `The form at ${refusal.formPath} refused with different wording`,
            expectedVsActual: {
              expected: `The message says: "${refusal.message}"`,
              actual: `The page says: "${seen.errorText ?? ''}"`,
            },
            resolution: 'Change the message to the wording in the document, or update the document.',
          });
        } else if (seen.errorText) {
          context.onObservation?.(`The form at ${refusal.formPath} refused the value: "${seen.errorText}"`);
        }
      }
    }

    // 1. URL Pattern Check
    if (testCase.expectations.url) {
      const pattern = testCase.expectations.url.pattern;
      const landed = new URL(currentUrl, context.baseUrl);
      const urlPath = landed.pathname;
      // "/docs" and "/docs/" are the same page.
      const otherSlash = urlPath.length > 1 && urlPath.endsWith('/') ? urlPath.slice(0, -1) : `${urlPath}/`;

      const matches = urlMatchesPattern(pattern, [urlPath, otherSlash, urlPath + landed.search, currentUrl]);
      if (testCase.expectations.url.negate) {
        // A Denial Plan Item for a route: it passes when the role did NOT end on the route (a redirect
        // or a refusal), and fails when the page opened.
        // A 401, 403 or 404 answer is a refusal: the page stayed on the URL but did not open.
        const navStatus = matches
          ? await page
              .evaluate(
                () =>
                  (
                    performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming & {
                      responseStatus?: number;
                    }
                  )?.responseStatus ?? 0
              )
              .catch(() => 0)
          : 0;
        const refused = navStatus === 401 || navStatus === 403 || navStatus === 404;
        if (matches && !refused) {
          findings.push(
            asGuess(
              {
                id: `F-SPEC-${testCase.id}-${counter++}`,
                testCaseId: testCase.id,
                flowId: testCase.flowId,
                severity: 'Blocker',
                checker: 'spec-conformance',
                title: `${context.role} reached ${urlPath}, which should not be open to this role`,
                where: { urlPath, role: context.role, breakpoint: context.breakpoint },
                expectedVsActual: {
                  expected: `The URL does not match ${pattern} (${testCase.expectations.url.description || ''})`,
                  actual: `Current URL is ${urlPath}`,
                },
                stepsToReproduce: [
                  `Navigate to ${testCase.startPage}`,
                  ...testCase.steps.map((s) => `Perform "${s.name}" (${s.action})`),
                  `Assert URL does not match ${pattern}`,
                ],
                evidence: { screenshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.screenshotPath },
                resolution: `Redirect or refuse ${context.role} on ${pattern}, or correct the document if this role should have access.`,
              },
              `Could not verify: ${context.role} reached "${urlPath}", which the document says is not for this role.`
            )
          );
        }
      } else if (!matches) {
        findings.push(
          asGuess(
            {
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
            },
            `Could not verify: expected to end on a page matching "${pattern}", but ended on "${urlPath}".`
          )
        );
      }
    }

    // 2. Visible Text Check (the page title counts: AIs often quote it)
    if (testCase.expectations.text) {
      const { contains, notContains, description } = testCase.expectations.text;
      const pageText = `${await page.title().catch(() => '')}\n${await page.innerText('body').catch(() => '')}`;

      if (contains && !pageText.includes(contains)) {
        findings.push(
          asGuess(
            {
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
            },
            `Could not verify: expected the page to say "${contains}".`
          )
        );
      }

      if (notContains && pageText.includes(notContains)) {
        findings.push(
          asGuess(
            {
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
            },
            `Could not verify: expected the page not to say "${notContains}".`
          )
        );
      }
    }

    // 2b. Sending a form should lead to another page, e.g. a confirmation page
    if (testCase.expectations.navigatesAway) {
      const { fromPath, description } = testCase.expectations.navigatesAway;
      const urlPath = new URL(currentUrl, context.baseUrl).pathname;
      if (urlPath === fromPath) {
        findings.push(
          asGuess(
            {
              id: `F-SPEC-${testCase.id}-${counter++}`,
              testCaseId: testCase.id,
              flowId: testCase.flowId,
              severity: 'Major',
              checker: 'spec-conformance',
              title: `Stayed on ${fromPath} instead of moving on to a confirmation page`,
              where: { urlPath, role: context.role, breakpoint: context.breakpoint },
              expectedVsActual: {
                expected: description || `After the steps, the page moves on from ${fromPath}`,
                actual: `Still on ${urlPath}`,
              },
              stepsToReproduce: [
                `Navigate to ${testCase.startPage}`,
                ...testCase.steps.map((s) => `Execute "${s.name}"`),
                `Look at which page you are on`,
              ],
              evidence: {
                screenshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.screenshotPath,
                domSnapshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.domSnapshotPath,
              },
              resolution: `After a successful send, take people to a page that confirms it.`,
            },
            `Could not verify: expected to move on from ${fromPath}, but stayed there.`
          )
        );
      }
    }

    // 2c. Sending a form should show a success message and no error
    if (testCase.expectations.successMessage) {
      const { description } = testCase.expectations.successMessage;
      const messages = await page
        .evaluate(() => {
          const read = (selector: string) =>
            Array.from(document.querySelectorAll(selector))
              .filter((el) => {
                const rect = (el as HTMLElement).getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && (el as HTMLElement).innerText.trim() !== '';
              })
              .map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 160));
          return {
            success: read(
              '[role="status"], [aria-live="polite"], [class*="success" i], [class*="toast" i], [class*="notice" i], [data-testid*="success" i]'
            ),
            error: read('[role="alert"], [class*="error" i], [class*="invalid" i], [data-testid*="error" i]'),
          };
        })
        .catch(() => ({ success: [] as string[], error: [] as string[] }));
      if (messages.success.length > 0 && messages.error.length === 0) {
        context.onObservation?.(`Sending the form shows: "${messages.success[0]}"`);
      } else {
        const urlPath = new URL(currentUrl, context.baseUrl).pathname;
        findings.push(
          asGuess(
            {
              id: `F-SPEC-${testCase.id}-${counter++}`,
              testCaseId: testCase.id,
              flowId: testCase.flowId,
              severity: 'Major',
              checker: 'spec-conformance',
              title:
                messages.error.length > 0
                  ? 'An error appeared instead of a success message'
                  : 'No success message appeared',
              where: { urlPath, role: context.role, breakpoint: context.breakpoint },
              expectedVsActual: {
                expected: description || 'A success message appears after the steps',
                actual:
                  messages.error.length > 0 ? `The page showed: "${messages.error[0]}"` : 'No success message appeared',
              },
              stepsToReproduce: [
                `Navigate to ${testCase.startPage}`,
                ...testCase.steps.map((s) => `Execute "${s.name}"`),
                `Look for a message saying it worked`,
              ],
              evidence: {
                screenshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.screenshotPath,
                domSnapshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.domSnapshotPath,
              },
              resolution: 'Show a short message saying the form was sent.',
            },
            'Could not verify: expected a success message after sending the form.'
          )
        );
      }
    }

    // 2d. The page opened and works: no error status, not blank, not a "not found" page.
    if (testCase.expectations.pageWorks) {
      const urlPath = new URL(currentUrl, context.baseUrl).pathname;
      const seen = await page
        .evaluate(() => {
          const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming & {
            responseStatus?: number;
          };
          const heading = (document.querySelector('h1') as HTMLElement | null)?.innerText || '';
          return {
            status: navigation?.responseStatus ?? 0,
            text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim(),
            title: document.title,
            heading: heading.replace(/\s+/g, ' ').trim(),
            media: document.querySelectorAll('img, svg, canvas, video').length,
          };
        })
        .catch(() => null);
      const notFoundWords = /^(404\b|page not found|not found\b|this page (could not|couldn’t|can't|cannot) be found)/i;
      const problem = !seen
        ? null
        : seen.status >= 400
          ? {
              title: `${urlPath} answered with an error (${seen.status})`,
              actual: `The page answered with HTTP ${seen.status}`,
            }
          : !seen.text && seen.media === 0
            ? { title: `${urlPath} opened blank`, actual: 'The page showed nothing' }
            : notFoundWords.test(seen.heading) || notFoundWords.test(seen.title)
              ? {
                  title: `${urlPath} says the page wasn’t found`,
                  actual: `The page says: “${seen.heading || seen.title}”`,
                }
              : null;
      if (problem) {
        findings.push({
          id: `F-SPEC-${testCase.id}-${counter++}`,
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          severity: 'Major',
          checker: 'spec-conformance',
          title: problem.title,
          where: { urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: testCase.expectations.pageWorks.description || 'The page opens and shows its content',
            actual: problem.actual,
          },
          stepsToReproduce: [
            `Navigate to ${testCase.startPage}`,
            ...testCase.steps.map((s) => `Execute "${s.name}"`),
            `Look at the page`,
          ],
          evidence: {
            screenshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.screenshotPath,
            domSnapshotPath: stepEvidenceList[stepEvidenceList.length - 1]?.domSnapshotPath,
          },
          resolution: 'Make sure the link goes to a page that exists and loads.',
        });
      }
    }

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

    return findings;
  }
}
