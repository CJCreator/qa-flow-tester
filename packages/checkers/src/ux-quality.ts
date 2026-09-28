import type { Page } from 'playwright';
import axePlaywright from '@axe-core/playwright';
import type { Finding, Breakpoint } from '@qa/types';

// Support both ESM default and CJS named export
const AxeBuilder = (axePlaywright as unknown as { default?: typeof axePlaywright; AxeBuilder?: typeof axePlaywright }).default ||
  (axePlaywright as unknown as { AxeBuilder?: typeof axePlaywright }).AxeBuilder ||
  axePlaywright;

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

        for (const violation of axeResults.violations) {
          const firstNode = violation.nodes[0];
          findings.push({
            id: `F-A11Y-${context.testCaseId || 'GEN'}-${counter++}`,
            testCaseId: context.testCaseId,
            severity: violation.impact === 'critical' ? 'Blocker' : violation.impact === 'serious' ? 'Major' : 'Minor',
            checker: 'ux-quality',
            title: `WCAG Violation: ${violation.help} (${violation.id})`,
            where: {
              urlPath: context.urlPath,
              role: context.role,
              breakpoint: context.breakpoint,
              cssSelector: firstNode?.target.join(' > '),
            },
            expectedVsActual: {
              expected: `Meets WCAG standard: ${violation.description}`,
              actual: firstNode?.failureSummary || violation.help,
            },
            stepsToReproduce: [
              `Navigate to ${context.urlPath} at breakpoint ${context.breakpoint}`,
              `Inspect element: ${firstNode?.target.join(' > ')}`,
            ],
            evidence: {
              domSnapshotPath: undefined,
            },
            resolution: `${violation.helpUrl ? `See ${violation.helpUrl}. ` : ''}Remediation: ${violation.help}.`,
            verifyCommand: `qa-test verify F-A11Y-${context.testCaseId || 'GEN'}-${counter - 1}`,
          });
        }
      } catch {
        // Ignore if axe cannot inject (e.g. non-HTML response)
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
                visible: rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none',
              };
            })
            .filter((item) => item.visible && (item.width < 44 || item.height < 44));
        });

        // Smallest first, so a tiny button isn't crowded out by ordinary text links; the same
        // element on several pages is merged later, so reporting more doesn't mean more noise.
        const smallestFirst = [...smallTargets].sort((a, b) => a.width * a.height - b.width * b.height);
        for (const target of smallestFirst.slice(0, 10)) {
          const label = target.text || target.ariaLabel || target.testId || `unlabeled <${target.tagName}>`;
          findings.push({
            id: `F-UX-TARGET-${context.testCaseId || 'GEN'}-${counter++}`,
            testCaseId: context.testCaseId,
            severity: 'Minor',
            checker: 'ux-quality',
            title: `Touch target too small: ${label} (${Math.round(target.width)}x${Math.round(target.height)}px)`,
            where: {
              urlPath: context.urlPath,
              role: context.role,
              breakpoint: context.breakpoint,
              dataTestId: target.testId || undefined,
              // Which element, so the same header link on every page is reported once.
              cssSelector: target.testId ? undefined : `${target.tagName}:has-text("${label}")`,
            },
            expectedVsActual: {
              expected: 'Interactive touch targets should be at least 44x44px on mobile screens',
              actual: `Element measures ${Math.round(target.width)}x${Math.round(target.height)}px`,
            },
            stepsToReproduce: [
              `Navigate to ${context.urlPath} on 375px mobile viewport`,
              `Inspect button or link "${target.text || target.testId}"`,
            ],
            evidence: {},
            resolution: 'Increase min-height and min-width to at least 44px or add padding for mobile viewports.',
            verifyCommand: `qa-test verify F-UX-TARGET-${context.testCaseId || 'GEN'}-${counter - 1}`,
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
          stepsToReproduce: [
            `Navigate directly to ${context.urlPath}`,
            `Observe lack of navigation options`,
          ],
          evidence: {},
          resolution: 'Add a persistent top navigation bar or back-button link to the page layout.',
          verifyCommand: `qa-test verify F-UX-DEADEND-${context.testCaseId || 'GEN'}-${counter - 1}`,
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
          verifyCommand: `qa-test verify F-UX-OVERFLOW-${context.testCaseId || 'GEN'}-${counter - 1}`,
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

