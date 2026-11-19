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

/** Words that, as a path segment or query key, mark an address whose GET may change something (T-427). */
const SIDE_EFFECT_WORDS = new Set([
  'logout',
  'logoff',
  'signout',
  'delete',
  'remove',
  'unsubscribe',
  'cancel',
  'confirm',
  'activate',
  'deactivate',
  'reset',
]);
const SIDE_EFFECT_PAIRS = new Set(['log out', 'log off', 'sign out']);

/** True when a segment or key is one of the words, or made of them: `sign-out`, `delete_item`, `logout.php`. */
function namesSideEffect(part: string): boolean {
  let decoded = part;
  try {
    decoded = decodeURIComponent(part);
  } catch {
    // keep the raw text
  }
  const words = decoded
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((w) => SIDE_EFFECT_WORDS.has(w))) return true;
  for (let i = 0; i + 1 < words.length; i++) {
    if (SIDE_EFFECT_PAIRS.has(`${words[i]} ${words[i + 1]}`)) return true;
  }
  return false;
}

/**
 * An address a crawler must not open with a plain GET because the visit itself may change something:
 * `/logout?confirm`, `/delete?id=1`, `/unsubscribe?token=...`. Matches path segments and query keys, never
 * the page's text, so `/blog/how-we-deleted-it` and `/confirmation-policy` are ordinary pages.
 */
export function isSideEffectAddress(url: URL): boolean {
  if (url.pathname.split('/').some((segment) => segment && namesSideEffect(segment))) return true;
  for (const key of url.searchParams.keys()) {
    if (namesSideEffect(key)) return true;
  }
  return false;
}
