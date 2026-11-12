import type { SensitiveAction, AmbiguityQuestion } from '@qa/types';
import { actionText, sensitiveKind } from './action-words.js';
import { sensitiveQuestion } from './questions.js';

export class SafetyFilter {
  private forbiddenActions: string[];

  constructor(forbiddenActions: string[] = []) {
    this.forbiddenActions = forbiddenActions.map((a) => a.toLowerCase());
  }

  isSensitive(elementText: string, selector: string, actionType?: string): SensitiveAction | null {
    const combined = `${elementText} ${selector} ${actionType || ''}`.toLowerCase();

    // 1. Check against explicit profile forbidden actions
    for (const forbidden of this.forbiddenActions) {
      const forbiddenText = actionText(forbidden);
      if (forbiddenText && actionText(combined).includes(forbiddenText)) {
        return {
          type: 'admin_setting',
          elementSelector: selector,
          elementText,
          urlPath: '',
          reason: `Matches forbidden action keyword: "${forbidden}"`,
        };
      }
    }

    const kind = sensitiveKind(elementText, selector, actionType || '');
    if (kind === 'deletion') {
      return {
        type: 'deletion',
        elementSelector: selector,
        elementText,
        urlPath: '',
        reason: 'Potential destructive data removal action',
      };
    }
    if (kind === 'payment') {
      return {
        type: 'payment',
        elementSelector: selector,
        elementText,
        urlPath: '',
        reason: 'Financial transaction or payment trigger',
      };
    }
    if (kind === 'external_communication') {
      return {
        type: 'external_communication',
        elementSelector: selector,
        elementText,
        urlPath: '',
        reason: 'External notification or messaging trigger',
      };
    }

    return null;
  }

  createAmbiguityQuestion(sensitive: SensitiveAction, index: number): AmbiguityQuestion {
    return sensitiveQuestion(sensitive, index);
  }
}
