import type { ConsoleEntry, Finding, FindingSeverity, NetworkEntry, StepEvidence, Breakpoint } from '@qa/types';

function safeOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isUncaught(c: ConsoleEntry): boolean {
  return typeof c.text === 'string' && c.text.startsWith('Uncaught Exception');
}

export function originOfConsoleEntry(c: ConsoleEntry): string | undefined {
  if (c.url) {
    return safeOrigin(c.url) ?? undefined;
  }
  if (!isUncaught(c)) {
    return undefined;
  }
  const lines = c.text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim().startsWith('at ')) continue;
    const match = line.match(/https?:\/\/[^\s)'"]+/);
    if (match) {
      const origin = safeOrigin(match[0]);
      if (origin) return origin;
    }
  }
  return undefined;
}

const withoutHash = (url: string) => url.split('#')[0];

/** Playwright's ways of saying the control never showed up (as opposed to failing once found). */
const CONTROL_NOT_FOUND =
  /waiting for (?:locator|getBy)[\s\S]*to be visible|resolved to 0 elements|element is not visible/i;

export class BugDetectionChecker {
  check(
    stepEvidenceList: StepEvidence[],
    context: {
      testCaseId?: string;
      flowId?: string;
      role: string;
      breakpoint: Breakpoint;
      urlPath: string;
      /**
       * The steps are an AI's plan that nobody has confirmed. A step whose control never showed up
       * then says more about the plan (a journey started mid-way, a control hidden at this width)
       * than about the site, so it is "Could not verify", not a failure.
       */
      planIsGuess?: boolean;
    }
  ): Finding[] {
    const findings: Finding[] = [];
    let findingCounter = 1;

    for (const step of stepEvidenceList) {
      const pageOrigin = safeOrigin(step.urlBefore || step.urlAfter || context.urlPath);
      const isThirdPartyUrl = (url: string | undefined) => {
        const origin = safeOrigin(url);
        return !!pageOrigin && !!origin && pageOrigin !== origin;
      };

      // 1. Failed requests, one finding per file however many signs point at it: the 404, a
      // "status 0" retry, and the console's "Failed to load resource" or "Mixed Content" message.
      const requestsByUrl = new Map<string, NetworkEntry[]>();
      for (const req of step.failedRequests) {
        const key = withoutHash(req.url);
        requestsByUrl.set(key, [...(requestsByUrl.get(key) || []), req]);
      }
      const attributed = new Set<ConsoleEntry>();
      // A third-party failure is minor unless the page broke with it: a crash in the same step.
      const pageBroke = step.consoleErrors.some(isUncaught);

      for (const [url, requests] of requestsByUrl) {
        const consoleSigns = step.consoleErrors.filter(
          (c) => (c.url && withoutHash(c.url) === url) || c.text.includes(url)
        );
        consoleSigns.forEach((c) => attributed.add(c));

        const status = requests.map((r) => r.status).find((s) => s > 0) ?? 0;
        const method = requests[0].method;
        const is5xx = status >= 500;
        const isThirdParty = isThirdPartyUrl(url);
        const signs = [
          `Request failed with status ${status}`,
          ...consoleSigns.map((c) => `Console: ${c.text.substring(0, 300)}`),
        ];

        findings.push({
          id: `F-HTTP-${context.testCaseId || 'GEN'}-${findingCounter++}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: isThirdParty ? (pageBroke ? 'Major' : 'Minor') : is5xx ? 'Blocker' : 'Major',
          checker: 'bug-detection',
          title: isThirdParty
            ? `Third-party request failed: HTTP ${status || 'Failed'} on ${method} ${url}`
            : `HTTP ${status || 'Failed'} on ${method} ${url}`,
          where: {
            urlPath: step.urlAfter || context.urlPath,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `HTTP 2xx or expected status response for ${method} ${url}`,
            actual: signs.join('\n'),
          },
          stepsToReproduce: [
            `Execute step "${step.stepName}" on ${step.urlBefore}`,
            `Inspect network activity for ${method} ${url}`,
          ],
          evidence: {
            screenshotPath: step.screenshotPath,
            networkLogs: requests,
            consoleLogs: consoleSigns.length > 0 ? consoleSigns : undefined,
          },
          resolution: isThirdParty
            ? 'Failure originates from a third-party domain (analytics, fonts, CDN, etc.), not this application. Confirm it is not blocking a critical user flow before prioritizing.'
            : is5xx
              ? 'Backend API error (5xx). Check server endpoint logs and database connections.'
              : 'Client request failure (4xx). Check request payload, authentication headers, or route.',
          thirdParty: isThirdParty,
          is5xx,
        });
      }

      // 2. Console errors and uncaught exceptions that aren't about a failed file
      for (const consoleLog of step.consoleErrors) {
        if (attributed.has(consoleLog)) continue;
        const isUnhandledException = isUncaught(consoleLog);
        const origin = originOfConsoleEntry(consoleLog);
        const isThirdParty = !!pageOrigin && !!origin && pageOrigin !== origin;
        const isFirstParty = !!pageOrigin && !!origin && pageOrigin === origin;

        let severity: FindingSeverity;
        let resolution: string;

        if (isThirdParty) {
          severity = 'Minor';
          resolution = `The error comes from a script on another site (${origin}). Check it doesn't break anything people use, and report it to its provider.`;
        } else if (isFirstParty) {
          severity = isUnhandledException ? 'Blocker' : 'Major';
          resolution =
            'Inspect the stack trace in console logs, ensure null checks and error boundaries are configured.';
        } else if (isUnhandledException) {
          severity = 'Major';
          resolution =
            'The address of the failing script could not be read, so it may come from a third party. Inspect the stack trace in console logs, ensure null checks and error boundaries are configured.';
        } else {
          severity = 'Minor';
          resolution =
            'Inspect the stack trace in console logs, ensure null checks and error boundaries are configured.';
        }

        findings.push({
          id: `F-BUG-${context.testCaseId || 'GEN'}-${findingCounter++}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity,
          checker: 'bug-detection',
          title: isUnhandledException
            ? `Uncaught Exception in step "${step.stepName}"`
            : `Console Error in step "${step.stepName}"`,
          where: {
            urlPath: step.urlAfter || context.urlPath,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: 'Zero unhandled errors or console exceptions in production builds',
            actual: consoleLog.text.substring(0, 300),
          },
          stepsToReproduce: [
            `Navigate to ${step.urlBefore}`,
            `Perform action: ${step.action} on "${step.stepName}"`,
            `Check browser developer console logs`,
          ],
          evidence: {
            screenshotPath: step.screenshotPath,
            domSnapshotPath: step.domSnapshotPath,
            consoleLogs: [consoleLog],
          },
          resolution,
          thirdParty: isThirdParty || undefined,
        });
      }

      // 3. Step execution failure. Steps skipped because an earlier one failed ("Blocked") are
      // not failures of their own: the first failing step already explains them. Nor are
      // optional steps that couldn't be done ("Skipped"), such as a desktop-only button on a phone.
      if (!step.passed && step.error && !/^(Blocked|Skipped):/.test(step.error)) {
        // A link check that failed is a broken link, not a control that couldn't be used.
        const brokenLink = step.action === 'check-link';
        const stepFailure: Finding = {
          id: `F-STEP-${context.testCaseId || 'GEN'}-${findingCounter++}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: brokenLink ? 'Major' : 'Blocker',
          checker: 'bug-detection',
          title: brokenLink
            ? `Broken link: ${step.stepName.replace(/^Check the link to /, '')}`
            : `Step failed: "${step.stepName}"`,
          where: {
            urlPath: step.urlBefore,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `Step "${step.stepName}" executes cleanly`,
            actual: step.error,
          },
          stepsToReproduce: [`Navigate to ${step.urlBefore}`, `Execute step "${step.stepName}" (${step.action})`],
          evidence: {
            screenshotPath: step.screenshotPath,
            domSnapshotPath: step.domSnapshotPath,
          },
          resolution: brokenLink
            ? 'Fix or remove the link: the page it points to doesn’t open.'
            : `Verify element is present in the DOM and enabled for action "${step.action}".`,
        };
        if (context.planIsGuess && CONTROL_NOT_FOUND.test(step.error)) {
          const page = step.urlBefore ? new URL(step.urlBefore, 'http://placeholder').pathname : context.urlPath;
          Object.assign(stepFailure, {
            severity: 'Suggestion',
            needsConfirmation: true,
            title: `Could not verify: “${step.stepName}” couldn’t be done on ${page}, because what it needs wasn’t there. The journey may need earlier steps, or it may not show at ${context.breakpoint}.`,
            resolution:
              'This journey is an AI plan that nobody has confirmed. Check its steps in the plan review; if the control should be there, confirm the journey and run it again.',
          });
        }
        findings.push(stepFailure);
      }
    }

    return findings;
  }
}
