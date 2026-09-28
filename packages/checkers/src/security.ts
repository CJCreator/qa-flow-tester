import type { Page } from 'playwright';
import type { Breakpoint, Finding, StepEvidence } from '@qa/types';

/** URL parameter names whose values are secrets. Shared with the report redaction. */
export const SECRET_PARAM_NAMES =
  'pass|password|passwd|pwd|pin|otp|token|access_token|refresh_token|id_token|auth|secret|client_secret|api_key|apikey|key|session|sessionid|sid|ssn|cvv|card';
const SECRET_PARAM_NAME = new RegExp(`^(?:${SECRET_PARAM_NAMES})$`, 'i');
const PASSWORD_PARAM_NAME = /^(?:pass|password|passwd|pwd|pin)$/i;

/** True when a URL carries a non-empty value in a parameter that looks like a secret. */
export function urlHasSecretParam(url: string, onlyPasswords = false): boolean {
  try {
    const parsed = new URL(url, 'http://placeholder');
    const names = onlyPasswords ? PASSWORD_PARAM_NAME : SECRET_PARAM_NAME;
    return [...parsed.searchParams.entries()].some(([name, value]) => names.test(name) && value !== '');
  } catch {
    return false;
  }
}

interface SecurityContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
}

const PASSWORD_IN_ADDRESS = 'The sign-in form sends passwords in the page address';
const PASSWORD_IN_ADDRESS_FIX =
  'Send the form with method="post". A password in the address is kept in browser history, server and proxy logs, and analytics, and can leak to other sites through the Referer header.';

/**
 * Passive security checks: they only read what a normal visit produced, and never probe or attack.
 * Phase 2 adds headers, cookies and mixed content; this first rule catches passwords in addresses.
 */
export class SecurityChecker {
  /**
   * Pages the run passed through with a password in their address. The problem is placed on the
   * page the step started from, where the sign-in form is, so it joins the form check's finding.
   */
  checkEvidence(stepEvidenceList: StepEvidence[], context: SecurityContext): Finding[] {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const step of stepEvidenceList) {
      if (!step.urlAfter || !urlHasSecretParam(step.urlAfter, true)) continue;
      // Still in the address from an earlier step: already recorded where it first appeared.
      if (seen.size > 0 && step.urlBefore && urlHasSecretParam(step.urlBefore, true)) continue;
      const formPath = safePath(step.urlBefore || step.urlAfter);
      if (seen.has(formPath)) continue;
      seen.add(formPath);
      findings.push(
        this.finding(`F-SEC-${context.testCaseId || 'GEN'}-URL-${findings.length + 1}`, context, formPath, {
          expected: 'Passwords are never part of a page address',
          actual: `After "${step.stepName}", the address of ${safePath(step.urlAfter)} contained the password`,
          screenshotPath: step.screenshotPath,
          steps: [`Go to ${step.urlBefore}`, `Perform "${step.stepName}"`, 'Look at the address bar'],
        })
      );
    }
    return findings;
  }

  /**
   * Sign-in forms on the current page that would send their password in the address: ones that
   * say method="get", or name a page to send to without saying how. A form with neither is usually
   * sent by the page's own script (a single-page app), which the markup can't tell us about;
   * checkEvidence catches it if the password does end up in an address.
   */
  async checkPage(page: Page, context: SecurityContext & { urlPath: string }): Promise<Finding[]> {
    const getForms = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('form'))
          .filter((f) => f.querySelector('input[type="password"]'))
          .filter((f) => {
            const method = f.getAttribute('method')?.trim().toLowerCase();
            return method === 'get' || (!method && !!f.getAttribute('action')?.trim());
          }).length
      )
      .catch(() => 0);
    if (getForms === 0) return [];
    return [
      this.finding(`F-SEC-${context.testCaseId || 'GEN'}-FORM`, context, context.urlPath, {
        expected: 'A form with a password field is sent with method="post"',
        actual: 'The form uses GET (or names a page to send to with no method, which means GET), so the password goes into the address',
        steps: [`Go to ${context.urlPath}`, 'Inspect the sign-in form: it has no method="post"'],
      }),
    ];
  }

  private finding(
    id: string,
    context: SecurityContext,
    urlPath: string,
    detail: { expected: string; actual: string; steps: string[]; screenshotPath?: string }
  ): Finding {
    return {
      id,
      testCaseId: context.testCaseId,
      flowId: context.flowId,
      severity: 'Major',
      checker: 'security',
      title: PASSWORD_IN_ADDRESS,
      where: { urlPath, role: context.role, breakpoint: context.breakpoint },
      expectedVsActual: { expected: detail.expected, actual: detail.actual },
      stepsToReproduce: detail.steps,
      evidence: { screenshotPath: detail.screenshotPath },
      resolution: PASSWORD_IN_ADDRESS_FIX,
      verifyCommand: `qa-test verify ${id}`,
    };
  }
}

function safePath(url: string): string {
  try {
    return new URL(url, 'http://placeholder').pathname;
  } catch {
    return url;
  }
}
