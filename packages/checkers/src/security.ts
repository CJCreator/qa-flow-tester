import type { Page } from 'playwright';
import type { Breakpoint, Finding, FindingSeverity, StepEvidence } from '@qa/types';

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

export interface SecurityContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
}

const PASSWORD_IN_ADDRESS = 'The sign-in form sends passwords in the page address';
const PASSWORD_IN_ADDRESS_FIX =
  'Send the form with method="post". A password in the address is kept in browser history, server and proxy logs, and analytics, and can leak to other sites through the Referer header.';

const STACK_TRACE_PATTERN =
  /(?:at [a-zA-Z0-9_$./\\-]+\s*\([^)]+:[0-9]+:[0-9]+\)|node:internal\/|Traceback \(most recent call last\):|Exception in thread "[^"]+"|System\.[a-zA-Z0-9]+Exception:|SQLSTATE\[[0-9A-Z]+\])/i;

/**
 * Passive security checks: they only read what a normal visit produced, and never probe or attack.
 * Covers headers, cookies, mixed content, stack traces, and passwords in addresses.
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
          title: PASSWORD_IN_ADDRESS,
          severity: 'Major',
          expected: 'Passwords are never part of a page address',
          actual: `After "${step.stepName}", the address of ${safePath(step.urlAfter)} contained the password`,
          screenshotPath: step.screenshotPath,
          steps: [`Go to ${step.urlBefore}`, `Perform "${step.stepName}"`, 'Look at the address bar'],
          resolution: PASSWORD_IN_ADDRESS_FIX,
        })
      );
    }
    return findings;
  }

  /** Run page-level passive security checks. */
  async checkPage(
    page: Page,
    context: SecurityContext & {
      urlPath: string;
      baseUrl?: string;
      responseHeaders?: Record<string, string>;
    }
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    // 1. Sign-in forms on the current page that send passwords using GET: ones that
    // say method="get", or name a page to send to without saying how. A form with neither is usually
    // sent by the page's own script (a single-page app), which the markup can't tell us about;
    // checkEvidence catches it if the password does end up in an address.
    const hasGetPasswordForm = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('form')).some((f) => {
          if (!f.querySelector('input[type="password"]')) return false;
          const method = f.getAttribute('method')?.trim().toLowerCase();
          return method === 'get' || (!method && !!f.getAttribute('action')?.trim());
        })
      )
      .catch(() => false);

    if (hasGetPasswordForm) {
      findings.push(
        this.finding(`F-SEC-${context.testCaseId || 'GEN'}-FORM`, context, context.urlPath, {
          title: PASSWORD_IN_ADDRESS,
          severity: 'Major',
          expected: 'A form with a password field is sent with method="post"',
          actual:
            'The form uses GET (or names a page to send to with no method, which means GET), so the password goes into the address',
          steps: [`Go to ${context.urlPath}`, 'Inspect the sign-in form: it has no method="post"'],
          resolution: PASSWORD_IN_ADDRESS_FIX,
        })
      );
    }

    // 2. Insecure content / mixed content & insecure scripts (e.g. books.toscrape.com insecure jQuery)
    const insecureResources = await page
      .evaluate(() => {
        const results: Array<{ tag: string; src: string }> = [];
        const isHttps = window.location.protocol === 'https:';

        // Check for scripts loaded over HTTP (either mixed content on HTTPS or plain HTTP script on web)
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        for (const s of scripts) {
          const src = s.getAttribute('src') || '';
          if (src.startsWith('http://')) {
            results.push({ tag: 'script', src });
          }
        }

        // Check for mixed content images, links, or styles on HTTPS
        if (isHttps) {
          const elements = Array.from(document.querySelectorAll('link[href], img[src], iframe[src]'));
          for (const el of elements) {
            const attr = el.getAttribute('href') || el.getAttribute('src') || '';
            if (attr.startsWith('http://')) {
              results.push({ tag: el.tagName.toLowerCase(), src: attr });
            }
          }

          // Everything the page actually loaded, which also covers CSS url()/@import, fonts,
          // and fetch/XHR calls that no HTML attribute shows.
          const known = new Set(results.map((r) => r.src));
          for (const entry of performance.getEntriesByType('resource')) {
            if (entry.name.startsWith('http://') && !known.has(entry.name)) {
              known.add(entry.name);
              results.push({ tag: (entry as PerformanceResourceTiming).initiatorType || 'resource', src: entry.name });
            }
          }
        }
        return results;
      })
      .catch(() => []);

    for (const res of insecureResources) {
      findings.push(
        this.finding(`F-SEC-${context.testCaseId || 'GEN'}-MIXED-${findings.length + 1}`, context, context.urlPath, {
          title: `Insecure resource loaded over unencrypted HTTP: ${truncate(res.src, 40)}`,
          severity: 'Major',
          expected: 'All scripts, stylesheets and subresources must load over secure HTTPS',
          actual: `Loaded <${res.tag}> from unencrypted source: ${res.src}`,
          steps: [`Visit ${context.urlPath}`, `Inspect network / HTML for source ${res.src}`],
          resolution: 'Update the URL scheme to https:// or host the resource locally on your secure domain.',
        })
      );
    }

    // 3. Exposed stack traces / debug errors
    const exposedStackTrace = await page
      .evaluate((patternStr) => {
        const pattern = new RegExp(patternStr, 'i');
        const text = document.body ? document.body.innerText : '';
        const match = text.match(pattern);
        return match ? match[0] : null;
      }, STACK_TRACE_PATTERN.source)
      .catch(() => null);

    if (exposedStackTrace) {
      findings.push(
        this.finding(
          `F-SEC-${context.testCaseId || 'GEN'}-STACKTRACE-${findings.length + 1}`,
          context,
          context.urlPath,
          {
            title: 'Internal server stack trace or debug information exposed on page',
            severity: 'Major',
            expected: 'Production error pages should show generic user-friendly messages without internal stack traces',
            actual: `Page text contains exposed trace: "${truncate(exposedStackTrace, 50)}"`,
            steps: [`Visit ${context.urlPath}`, 'Observe visible error stack trace on the screen'],
            resolution: 'Disable detailed debugging in production and render custom error pages (e.g. 500.html).',
          }
        )
      );
    }

    // 4. Cookie flags (Secure, HttpOnly, SameSite)
    try {
      const cookies = await page
        .context()
        .cookies(page.url())
        .catch(() => []);
      for (const cookie of cookies) {
        const isAuthOrSession = /(?:session|auth|token|jwt|id|sid|user)/i.test(cookie.name);
        if (!cookie.secure && page.url().startsWith('https://')) {
          findings.push(
            this.finding(
              `F-SEC-${context.testCaseId || 'GEN'}-COOKIE-SECURE-${findings.length + 1}`,
              context,
              context.urlPath,
              {
                title: `Cookie "${cookie.name}" is missing the Secure flag`,
                severity: 'Major',
                expected: 'Cookies transmitted over HTTPS must have the "Secure" flag set',
                actual: `Cookie "${cookie.name}" lacks the Secure attribute and could be transmitted in cleartext`,
                steps: [`Visit ${context.urlPath}`, `Inspect cookie "${cookie.name}" in application storage`],
                resolution: 'Add "; Secure" to the Set-Cookie response header.',
              }
            )
          );
        }
        if (isAuthOrSession && !cookie.httpOnly) {
          findings.push(
            this.finding(
              `F-SEC-${context.testCaseId || 'GEN'}-COOKIE-HTTPONLY-${findings.length + 1}`,
              context,
              context.urlPath,
              {
                title: `Sensitive session cookie "${cookie.name}" is missing HttpOnly flag`,
                severity: 'Major',
                expected: 'Session and authentication cookies should have the HttpOnly flag to prevent XSS theft',
                actual: `Cookie "${cookie.name}" can be accessed via document.cookie JavaScript API`,
                steps: [`Visit ${context.urlPath}`, `Query document.cookie for "${cookie.name}"`],
                resolution: 'Set the HttpOnly flag on all session and authentication cookies.',
              }
            )
          );
        }
        const sameSite = cookie.sameSite?.toLowerCase();
        if (sameSite === 'none' && !cookie.secure) {
          // Browsers reject this combination outright, so the cookie is not stored at all.
          findings.push(
            this.finding(
              `F-SEC-${context.testCaseId || 'GEN'}-COOKIE-SAMESITE-${findings.length + 1}`,
              context,
              context.urlPath,
              {
                title: `Cookie "${cookie.name}" has SameSite=None without Secure`,
                severity: 'Major',
                expected: 'A cookie with SameSite=None must also be Secure; modern browsers reject it otherwise',
                actual: `Cookie "${cookie.name}" has SameSite=None and no Secure flag`,
                steps: [`Visit ${context.urlPath}`, `Inspect SameSite and Secure on cookie "${cookie.name}"`],
                resolution:
                  'Add "; Secure" to the cookie, or use SameSite=Lax if it is not needed in cross-site embeds.',
              }
            )
          );
        } else if (sameSite === 'none' || !sameSite) {
          findings.push(
            this.finding(
              `F-SEC-${context.testCaseId || 'GEN'}-COOKIE-SAMESITE-${findings.length + 1}`,
              context,
              context.urlPath,
              {
                title: `Cookie "${cookie.name}" has loose or missing SameSite attribute`,
                severity: isAuthOrSession && sameSite === 'none' ? 'Major' : 'Minor',
                expected:
                  'Cookies should have SameSite=Lax or SameSite=Strict to defend against Cross-Site Request Forgery',
                actual: `Cookie "${cookie.name}" has ${sameSite === 'none' ? 'SameSite=None' : 'no SameSite attribute'}`,
                steps: [`Visit ${context.urlPath}`, `Inspect SameSite property on cookie "${cookie.name}"`],
                resolution: 'Set SameSite=Lax (or Strict) on cookies unless cross-site embeds are explicitly required.',
              }
            )
          );
        }
      }
    } catch {
      // Cookies check skipped if browser context not accessible
    }

    // 5. Missing Security Headers
    if (context.responseHeaders) {
      const headerFindings = this.checkHeaders(context.responseHeaders, {
        ...context,
        isHttps: page.url().startsWith('https://'),
      });
      findings.push(...headerFindings);
    }

    return findings;
  }

  /** Check response headers for fundamental security standards. */
  checkHeaders(
    headers: Record<string, string>,
    context: SecurityContext & { urlPath: string; isHttps?: boolean }
  ): Finding[] {
    const findings: Finding[] = [];
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      normalized[k.toLowerCase()] = v;
    }

    // Content-Security-Policy
    if (!normalized['content-security-policy']) {
      findings.push(
        this.finding(`F-SEC-${context.testCaseId || 'GEN'}-CSP`, context, context.urlPath, {
          title: 'Missing Content-Security-Policy (CSP) header',
          severity: 'Major',
          expected:
            'Responses should define a Content-Security-Policy header to restrict resource loading and mitigate XSS',
          actual: 'No Content-Security-Policy header was returned in the response',
          steps: [`Request ${context.urlPath}`, 'Inspect HTTP response headers for Content-Security-Policy'],
          resolution: "Configure a Content-Security-Policy header, e.g.: default-src 'self'; script-src 'self';",
        })
      );
    }

    // X-Content-Type-Options: nosniff
    if (normalized['x-content-type-options']?.toLowerCase() !== 'nosniff') {
      findings.push(
        this.finding(`F-SEC-${context.testCaseId || 'GEN'}-NOSNIFF`, context, context.urlPath, {
          title: 'Missing or invalid X-Content-Type-Options: nosniff header',
          severity: 'Minor',
          expected: 'Response should include "X-Content-Type-Options: nosniff" to prevent MIME-type sniffing',
          actual: `Header is ${normalized['x-content-type-options'] ? `"${normalized['x-content-type-options']}"` : 'missing'}`,
          steps: [`Request ${context.urlPath}`, 'Inspect HTTP response headers for X-Content-Type-Options'],
          resolution: 'Add "X-Content-Type-Options: nosniff" to your web server or reverse proxy headers.',
        })
      );
    }

    // Clickjacking protection: X-Frame-Options or frame-ancestors
    const hasFrameAncestors = normalized['content-security-policy']?.includes('frame-ancestors');
    const xFrameOptions = normalized['x-frame-options']?.toUpperCase();
    if (
      !hasFrameAncestors &&
      (!xFrameOptions || (!xFrameOptions.includes('DENY') && !xFrameOptions.includes('SAMEORIGIN')))
    ) {
      findings.push(
        this.finding(`F-SEC-${context.testCaseId || 'GEN'}-CLICKJACK`, context, context.urlPath, {
          title: 'Missing clickjacking protection (X-Frame-Options or CSP frame-ancestors)',
          severity: 'Minor',
          expected:
            'Responses must declare X-Frame-Options: DENY/SAMEORIGIN or CSP frame-ancestors to prevent clickjacking',
          actual: 'No frame restriction headers were found',
          steps: [`Request ${context.urlPath}`, 'Check headers for X-Frame-Options or CSP frame-ancestors'],
          resolution: 'Add "X-Frame-Options: SAMEORIGIN" or CSP "frame-ancestors \'self\'" to response headers.',
        })
      );
    }

    // Referrer-Policy
    if (!normalized['referrer-policy']) {
      findings.push(
        this.finding(`F-SEC-${context.testCaseId || 'GEN'}-REFERRER`, context, context.urlPath, {
          title: 'Missing Referrer-Policy header',
          severity: 'Minor',
          expected: 'Response should set a Referrer-Policy (e.g. strict-origin-when-cross-origin)',
          actual: 'No Referrer-Policy header present; browser falls back to default behavior',
          steps: [`Request ${context.urlPath}`, 'Check response headers for Referrer-Policy'],
          resolution: 'Add "Referrer-Policy: strict-origin-when-cross-origin" to response headers.',
        })
      );
    }

    // Strict-Transport-Security (HSTS) - only checked if HTTPS
    if (context.isHttps && !normalized['strict-transport-security']) {
      findings.push(
        this.finding(`F-SEC-${context.testCaseId || 'GEN'}-HSTS`, context, context.urlPath, {
          title: 'Missing Strict-Transport-Security (HSTS) header on HTTPS site',
          severity: 'Major',
          expected: 'HTTPS websites should return Strict-Transport-Security to enforce encrypted connections',
          actual: 'Strict-Transport-Security header is missing',
          steps: [`Request ${context.urlPath} over HTTPS`, 'Inspect response headers for Strict-Transport-Security'],
          resolution: 'Add "Strict-Transport-Security: max-age=31536000; includeSubDomains" to web server headers.',
        })
      );
    }

    return findings;
  }

  private finding(
    id: string,
    context: SecurityContext,
    urlPath: string,
    detail: {
      title: string;
      severity: FindingSeverity;
      expected: string;
      actual: string;
      steps: string[];
      resolution: string;
      screenshotPath?: string;
    }
  ): Finding {
    return {
      id,
      testCaseId: context.testCaseId,
      flowId: context.flowId,
      severity: detail.severity,
      checker: 'security',
      title: detail.title,
      where: { urlPath, role: context.role, breakpoint: context.breakpoint },
      expectedVsActual: { expected: detail.expected, actual: detail.actual },
      stepsToReproduce: detail.steps,
      evidence: { screenshotPath: detail.screenshotPath },
      resolution: detail.resolution,
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

function truncate(str: string | undefined | null, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}
