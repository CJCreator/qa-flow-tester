import { describe, it, expect } from 'vitest';
import type { StepEvidence } from '@qa/types';
import { BugDetectionChecker } from '../src/bug-detection';

const step = (overrides: Partial<StepEvidence>): StepEvidence => ({
  stepIndex: 1,
  stepName: 'Navigate to entry page',
  action: 'navigate',
  urlBefore: 'https://www.w3.org/WAI/demos/bad/before/home.html',
  urlAfter: 'https://www.w3.org/WAI/demos/bad/before/home.html',
  consoleErrors: [],
  failedRequests: [],
  durationMs: 0,
  passed: true,
  ...overrides,
});

const context = { role: 'visitor', breakpoint: '1440px' as const, urlPath: '/' };
const checker = new BugDetectionChecker();

describe('One problem, one finding', () => {
  it('reports a missing file once, listing every sign of it', () => {
    const piwik = 'https://www.w3.org/analytics/piwik/piwik.js';
    const findings = checker.check(
      [
        step({
          consoleErrors: [
            {
              type: 'error',
              text: 'Failed to load resource: the server responded with a status of 404 ()',
              url: piwik,
              timestamp: 1,
            },
          ],
          failedRequests: [
            { url: piwik, method: 'GET', status: 404, timestamp: 1 },
            { url: piwik, method: 'GET', status: 0, timestamp: 2 },
          ],
        }),
      ],
      context
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe(`HTTP 404 on GET ${piwik}`);
    expect(findings[0].expectedVsActual.actual).toContain('Failed to load resource');
    expect(findings[0].evidence.networkLogs).toHaveLength(2);
  });

  it('treats a blocked insecure script from another site as one minor third-party problem', () => {
    const jquery = 'http://ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js';
    const findings = checker.check(
      [
        step({
          urlBefore: 'https://books.toscrape.com/',
          urlAfter: 'https://books.toscrape.com/',
          consoleErrors: [
            {
              type: 'error',
              text: `Mixed Content: The page at 'https://books.toscrape.com/' was loaded over HTTPS, but requested an insecure script '${jquery}'. This request has been blocked.`,
              url: 'https://books.toscrape.com/',
              timestamp: 1,
            },
          ],
          failedRequests: [{ url: jquery, method: 'GET', status: 0, timestamp: 1 }],
        }),
      ],
      context
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'Minor', thirdParty: true });
    expect(findings[0].expectedVsActual.actual).toContain('Mixed Content');
  });

  it('rates an error thrown inside another site’s script as minor', () => {
    const findings = checker.check(
      [
        step({
          consoleErrors: [
            { type: 'error', text: 'Widget init failed', url: 'https://widgets.example.net/chat.js', timestamp: 1 },
          ],
        }),
      ],
      context
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'Minor', thirdParty: true });
  });

  it('does not report steps skipped after an earlier failure as failures of their own', () => {
    const findings = checker.check(
      [
        step({ stepIndex: 1, stepName: 'Open menu', passed: false, error: 'locator.waitFor: Timeout 4000ms exceeded' }),
        step({
          stepIndex: 2,
          stepName: 'Choose settings',
          passed: false,
          error: 'Blocked: Previous step "Open menu" failed',
        }),
      ],
      context
    );
    expect(findings.map((f) => f.title)).toEqual(['Step failed: "Open menu"']);
  });
});

describe('Steps of an unconfirmed AI plan', () => {
  // saucedemo: the AI planned "remove from cart" starting on an empty cart page.
  const missingRemove = step({
    stepName: 'Click remove button',
    action: 'click',
    urlBefore: 'https://www.saucedemo.com/cart.html',
    urlAfter: 'https://www.saucedemo.com/cart.html',
    passed: false,
    error:
      'locator.waitFor: Timeout 4000ms exceeded.\nCall log:\n  - waiting for locator(\'[data-test="remove-sauce-labs-backpack"]\') to be visible\n',
  });

  it('turn a control that never showed up into "Could not verify", not a failure of the site', () => {
    const [finding] = checker.check([missingRemove], { ...context, breakpoint: '375px', planIsGuess: true });
    expect(finding).toMatchObject({ severity: 'Suggestion', needsConfirmation: true });
    expect(finding.title).toBe(
      'Could not verify: “Click remove button” couldn’t be done on /cart.html, because what it needs wasn’t there. The journey may need earlier steps, or it may not show at 375px.'
    );
  });

  it('still fail the site when a control was there but broke, or when someone confirmed the plan', () => {
    const brokeWhenClicked = { ...missingRemove, error: 'locator.click: Target closed' };
    expect(checker.check([brokeWhenClicked], { ...context, planIsGuess: true })[0].severity).toBe('Blocker');
    expect(checker.check([missingRemove], context)[0]).toMatchObject({
      severity: 'Blocker',
      title: 'Step failed: "Click remove button"',
    });
  });
});
