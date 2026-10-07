import type { Page } from 'playwright';
import axePlaywright from '@axe-core/playwright';
import type { Finding, Breakpoint } from '@qa/types';

// Support both ESM default and CJS named export
const AxeBuilder =
  (axePlaywright as unknown as { default?: typeof axePlaywright; AxeBuilder?: typeof axePlaywright }).default ||
  (axePlaywright as unknown as { AxeBuilder?: typeof axePlaywright }).AxeBuilder ||
  axePlaywright;

/** WCAG 2.2 AA 2.5.8 Target Size (Minimum). */
const WCAG_MIN_TARGET_PX = 24;

interface AxeRule {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl?: string;
  description: string;
  tags: string[];
  nodes: { target: unknown[]; failureSummary?: string }[];
}

const WCAG_NAMES: Record<string, string> = {
  '1.1.1': 'Non-text Content',
  '1.3.1': 'Info and Relationships',
  '1.4.1': 'Use of Color',
  '1.4.3': 'Contrast (Minimum)',
  '1.4.4': 'Resize Text',
  '1.4.10': 'Reflow',
  '2.1.1': 'Keyboard',
  '2.4.1': 'Bypass Blocks',
  '2.4.2': 'Page Titled',
  '2.4.4': 'Link Purpose (In Context)',
  '2.4.7': 'Focus Visible',
  '2.5.8': 'Target Size (Minimum)',
  '3.1.1': 'Language of Page',
  '3.3.2': 'Labels or Instructions',
  '4.1.2': 'Name, Role, Value',
};

/** Turns axe tags such as `wcag143` into "WCAG 1.4.3 Contrast (Minimum)". */
export function wcagCriteria(tags: string[] = []): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (!m) continue;
    const num = `${m[1]}.${m[2]}.${m[3]}`;
    out.push(WCAG_NAMES[num] ? `WCAG ${num} ${WCAG_NAMES[num]}` : `WCAG ${num}`);
  }
  return out;
}

export class UXQualityChecker {
  async check(
    page: Page,
    context: {
      testCaseId?: string;
      role: string;
      breakpoint: Breakpoint;
      urlPath: string;
      enableAxe?: boolean;
      /** The page the review started on. It needs no way back, like a one-screen app. */
      entryPath?: string;
    }
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    let counter = 1;

    // 1. Accessibility Check via axe-core
    if (context.enableAxe !== false) {
      try {
        const axeResults = await new (AxeBuilder as any)({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        for (const violation of axeResults.violations as AxeRule[]) {
          const firstNode = violation.nodes[0];
          const targets = violation.nodes.map((n) => n.target.join(' > '));
          const criteria = wcagCriteria(violation.tags);
          const criteriaLabel = criteria.length ? ` [${criteria.join(', ')}]` : '';
          findings.push({
            id: `F-A11Y-${context.testCaseId || 'GEN'}-${counter++}`,
            testCaseId: context.testCaseId,
            severity: violation.impact === 'critical' ? 'Blocker' : violation.impact === 'serious' ? 'Major' : 'Minor',
            checker: 'ux-quality',
            title: `${criteria.length ? criteria.join(', ') : 'WCAG'} violation: ${violation.help} (${violation.id})`,
            where: {
              urlPath: context.urlPath,
              role: context.role,
              breakpoint: context.breakpoint,
              cssSelector: targets[0],
            },
            expectedVsActual: {
              expected: `Meets WCAG 2.2 AA${criteriaLabel}: ${violation.description}`,
              actual:
                targets.length > 1
                  ? `Violated by ${targets.length} elements on this page: ${targets
                      .slice(0, 5)
                      .map((t) => `\`${t}\``)
                      .join(
                        ', '
                      )}${targets.length > 5 ? `, and ${targets.length - 5} more` : ''}. First: ${firstNode?.failureSummary || violation.help}`
                  : firstNode?.failureSummary || violation.help,
            },
            stepsToReproduce: [
              `Navigate to ${context.urlPath} at breakpoint ${context.breakpoint}`,
              `Inspect element: ${targets[0]}`,
            ],
            evidence: {
              domSnapshotPath: undefined,
              allTargets: targets.length > 1 ? targets : undefined,
            },
            resolution: `${violation.helpUrl ? `See ${violation.helpUrl}. ` : ''}Remediation: ${violation.help}.`,
          });
        }

        // "Incomplete" means axe could not decide. It is not a pass and not a failure, so it is
        // listed as something a person must look at, once per rule.
        for (const item of ((axeResults.incomplete ?? []) as AxeRule[]).slice(0, 10)) {
          if (!item.nodes.length) continue;
          const targets = item.nodes.map((n) => n.target.join(' > '));
          const criteria = wcagCriteria(item.tags);
          findings.push({
            id: `F-A11Y-REVIEW-${context.testCaseId || 'GEN'}-${counter++}`,
            testCaseId: context.testCaseId,
            severity: 'Suggestion',
            checker: 'ux-quality',
            title: `Needs human review${criteria.length ? ` (${criteria.join(', ')})` : ''}: ${item.help} (${item.id})`,
            where: {
              urlPath: context.urlPath,
              role: context.role,
              breakpoint: context.breakpoint,
              cssSelector: targets[0],
            },
            expectedVsActual: {
              expected: 'A person confirms this meets the standard',
              actual: `The automatic check could not decide for ${targets.length} element${targets.length === 1 ? '' : 's'}: ${item.nodes[0].failureSummary || item.description}`,
            },
            stepsToReproduce: [`Open ${context.urlPath} at ${context.breakpoint}`, `Check element: ${targets[0]}`],
            evidence: { allTargets: targets.length > 1 ? targets : undefined },
            resolution: `Review by hand. ${item.helpUrl ? `See ${item.helpUrl}.` : ''}`.trim(),
          });
        }
      } catch (err) {
        // A scan that did not run must never read as a clean pass.
        const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
        findings.push({
          id: `F-A11Y-SCAN-FAILED-${context.testCaseId || 'GEN'}-${counter++}`,
          testCaseId: context.testCaseId,
          severity: 'Major',
          checker: 'ux-quality',
          title: 'Accessibility scan could not run on this page',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'The accessibility scan completes and reports its results',
            actual: `The scan failed, so this page has not been checked for accessibility: ${reason}`,
          },
          stepsToReproduce: [`Open ${context.urlPath} at ${context.breakpoint}`, 'Run an axe-core scan'],
          evidence: {},
          resolution:
            'Check whether a strict Content-Security-Policy or a non-HTML response blocked the scan, then run it again. Until then, treat this page as unchecked.',
        });
      }
    }

    // 2. Rule: Mobile Tap Target Size (< 44x44px on mobile)
    if (context.breakpoint === '375px') {
      try {
        const smallTargets = await page.evaluate(() => {
          const interactive = Array.from(
            document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')
          );
          return interactive
            .filter((el) => {
              if (el.classList.contains('sr-only') || el.closest('.sr-only')) return false;
              if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) return false;
              if (el.closest('details:not([open])')) return false;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
              if (
                typeof el.checkVisibility === 'function' &&
                !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
              )
                return false;
              return true;
            })
            .map((el) => {
              const rect = el.getBoundingClientRect();
              const testId = el.getAttribute('data-testid');
              const text = (el.textContent || '').trim().substring(0, 30);
              const ariaLabel = el.getAttribute('aria-label');
              return {
                width: rect.width,
                height: rect.height,
                testId,
                text,
                ariaLabel,
                tagName: el.tagName.toLowerCase(),
                visible: rect.width > 0 && rect.height > 0,
              };
            })
            .filter((item) => item.visible && (item.width < 44 || item.height < 44));
        });

        // Smallest first, so a tiny button isn't crowded out by ordinary text links; the same
        // element on several pages is merged later, so reporting more doesn't mean more noise.
        const smallestFirst = [...smallTargets].sort((a, b) => a.width * a.height - b.width * b.height);
        for (const target of smallestFirst.slice(0, 10)) {
          const label = target.text || target.ariaLabel || target.testId || `unlabeled <${target.tagName}>`;
          // WCAG 2.2 AA (2.5.8) asks for 24x24px. 44x44px is the AAA / platform guidance level.
          const belowAA = target.width < WCAG_MIN_TARGET_PX || target.height < WCAG_MIN_TARGET_PX;
          findings.push({
            id: `F-UX-TARGET-${context.testCaseId || 'GEN'}-${counter++}`,
            testCaseId: context.testCaseId,
            severity: belowAA ? 'Minor' : 'Suggestion',
            checker: 'ux-quality',
            // A tap target is about using the site on a phone.
            aspect: 'Fast and mobile',
            title: belowAA
              ? `Touch target below WCAG 2.5.8 minimum: ${label} (${Math.round(target.width)}x${Math.round(target.height)}px)`
              : `Touch target smaller than recommended: ${label} (${Math.round(target.width)}x${Math.round(target.height)}px)`,
            where: {
              urlPath: context.urlPath,
              role: context.role,
              breakpoint: context.breakpoint,
              dataTestId: target.testId || undefined,
              // Which element, so the same header link on every page is reported once.
              cssSelector: target.testId ? undefined : `${target.tagName}:has-text("${label}")`,
            },
            expectedVsActual: {
              expected: belowAA
                ? 'WCAG 2.2 AA (2.5.8 Target Size, Minimum) asks for targets of at least 24x24px, unless they have enough space around them or sit inside a sentence'
                : 'Recommended mobile ergonomics (WCAG AAA 2.5.5 and Apple/Google guidance): targets of at least 44x44px. This is not an AA failure',
              actual: `Element measures ${Math.round(target.width)}x${Math.round(target.height)}px`,
            },
            stepsToReproduce: [
              `Navigate to ${context.urlPath} on 375px mobile viewport`,
              `Inspect button or link "${target.text || target.testId}"`,
            ],
            evidence: {},
            resolution: 'Increase min-height and min-width to at least 44px or add padding for mobile viewports.',
          });
        }
      } catch {
        // Ignore evaluation errors
      }
    }

    // 3. Rule: Dead End Page Detection
    try {
      const { hasNavigation, hasControls } = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href], button'));
        const hasNavigation = links.some((el) => {
          const text = (el.textContent || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          return (
            text.includes('back') ||
            text.includes('home') ||
            aria.includes('back') ||
            el.getAttribute('href') === '/' ||
            el.closest('nav, header') !== null
          );
        });
        const hasControls = Array.from(
          document.querySelectorAll('button, input:not([type="hidden"]), select, textarea, [role="button"]')
        ).some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        return { hasNavigation, hasControls };
      });

      // A one-screen app (a to-do list opened at its start page) has things to do and needs no
      // way out. A page with no way out and nothing to do is a dead end wherever it is.
      const isOneScreenApp = context.urlPath === context.entryPath && hasControls;
      if (!hasNavigation && context.urlPath !== '/' && !isOneScreenApp) {
        findings.push({
          id: `F-UX-DEADEND-${context.testCaseId || 'GEN'}-${counter++}`,
          testCaseId: context.testCaseId,
          severity: 'Major',
          checker: 'ux-quality',
          title: `Dead End Page: No back button or header navigation detected`,
          where: {
            urlPath: context.urlPath,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: 'Every page should provide a clear path back or breadcrumbs/navigation',
            actual: 'Page lacks back link, header, or primary navigation',
          },
          stepsToReproduce: [`Navigate directly to ${context.urlPath}`, `Observe lack of navigation options`],
          evidence: {},
          resolution: 'Add a persistent top navigation bar or back-button link to the page layout.',
        });
      }
    } catch {
      // Ignore
    }

    // 4. Rule: Horizontal Scroll Overflow
    try {
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 2;
      });

      if (hasOverflow) {
        findings.push({
          id: `F-UX-OVERFLOW-${context.testCaseId || 'GEN'}-${counter++}`,
          testCaseId: context.testCaseId,
          severity: 'Major',
          checker: 'ux-quality',
          title: `Horizontal page overflow detected (${context.breakpoint})`,
          where: {
            urlPath: context.urlPath,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `Page content fits within viewport width (${context.breakpoint}) without horizontal scrolling`,
            actual: 'Page triggers horizontal scrollbar (scrollWidth > innerWidth)',
          },
          stepsToReproduce: [
            `Navigate to ${context.urlPath} at ${context.breakpoint}`,
            `Check for horizontal scrollbar`,
          ],
          evidence: {},
          resolution: 'Ensure broad containers use max-w-full and overflow-x-hidden.',
        });
      }
    } catch {
      // Ignore
    }

    return findings;
  }

  /**
   * Deduplicates findings discovered across multiple steps on the same page route.
   */
  deduplicateFindings(findings: Finding[]): Finding[] {
    const seen = new Set<string>();
    return findings.filter((f) => {
      const key = `${f.checker}|${f.where.urlPath}|${f.title}|${f.where.dataTestId || f.where.cssSelector || ''}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
