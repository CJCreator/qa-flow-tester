import type { Page } from 'playwright';

/**
 * Self-healing selector suggestion engine (ADR 0013 / G22).
 * When an intended selector fails to match, inspects candidate DOM elements to propose
 * resilient alternatives (role, test-id, aria-label, text) requiring human approval before persisting.
 */

export interface SelectorHealingSuggestion {
  originalSelector: string;
  suggestedSelector: string;
  strategy: 'role-name' | 'test-id' | 'aria-label' | 'text-content';
  confidence: number;
  snippet?: string;
  humanApproved?: boolean;
}

export class SelfHealingEngine {
  /**
   * Proposes alternative resilient selectors for a broken target.
   */
  async suggestAlternatives(
    page: Page,
    brokenSelector: string,
    targetIntent?: { role?: string; text?: string; testId?: string }
  ): Promise<SelectorHealingSuggestion[]> {
    const suggestions: SelectorHealingSuggestion[] = [];

    try {
      // 1. Try target intent test-id
      if (targetIntent?.testId) {
        const testIdSel = `[data-testid="${targetIntent.testId}"], [data-test="${targetIntent.testId}"]`;
        if (
          (await page
            .locator(testIdSel)
            .count()
            .catch(() => 0)) > 0
        ) {
          suggestions.push({
            originalSelector: brokenSelector,
            suggestedSelector: testIdSel,
            strategy: 'test-id',
            confidence: 0.95,
          });
        }
      }

      // 2. Try role and accessible name
      if (targetIntent?.role && targetIntent?.text) {
        const roleLocator = page.getByRole(targetIntent.role as any, { name: targetIntent.text });
        if ((await roleLocator.count().catch(() => 0)) > 0) {
          suggestions.push({
            originalSelector: brokenSelector,
            suggestedSelector: `role=${targetIntent.role}[name="${targetIntent.text}"]`,
            strategy: 'role-name',
            confidence: 0.9,
          });
        }
      }

      // 3. Try visible text content
      if (targetIntent?.text) {
        const textLocator = page.getByText(targetIntent.text, { exact: false });
        if ((await textLocator.count().catch(() => 0)) > 0) {
          suggestions.push({
            originalSelector: brokenSelector,
            suggestedSelector: `text="${targetIntent.text}"`,
            strategy: 'text-content',
            confidence: 0.8,
          });
        }
      }
    } catch {
      // Non-blocking suggestion recovery
    }

    return suggestions;
  }
}
