import type { PlanCheck, TestCaseExpectations, TestCaseStep, ValidationRule } from '@qa/types';
import { looksTechnical } from './translate.js';

/**
 * Extracts human-readable words from a CSS or test selector.
 * E.g. '[data-testid="customer-field"]' -> 'Customer field'
 *      '#login-btn'                     -> 'Login'
 *      'role=button[name="Submit"]'     -> 'Submit'
 */
export function cleanSelectorWords(selector?: string): string | null {
  if (!selector) return null;
  const s = selector.trim();

  // Test ID attribute
  const testIdMatch = s.match(/\[data-(?:testid|test|cy|qa)\s*=\s*["']?([^"'\]]+)["']?\]/i);
  if (testIdMatch) {
    return formatTokenWords(testIdMatch[1]);
  }

  // ID attribute
  const idMatch = s.match(/^#([A-Za-z_][\w-]*)$/);
  if (idMatch) {
    return formatTokenWords(idMatch[1]);
  }

  // Name attribute
  const nameMatch = s.match(/\[name\s*=\s*["']?([^"'\]]+)["']?\]/i);
  if (nameMatch) {
    return formatTokenWords(nameMatch[1]);
  }

  // ARIA role with name
  const roleMatch = s.match(/role=[a-z]+\[name\s*=\s*"((?:[^"\\]|\\.)*)"i?\]/i);
  if (roleMatch) {
    return roleMatch[1].replace(/\\(.)/g, '$1');
  }

  // :has-text or text=
  const textMatch = s.match(/(?::has-text\(|text=)["']([^"']+)["']/i);
  if (textMatch) {
    return textMatch[1].trim();
  }

  // A single token
  if (/^[A-Za-z0-9_-]+$/.test(s)) {
    return formatTokenWords(s);
  }

  return null;
}

function formatTokenWords(token: string): string {
  // Strip common suffixes like -btn, -button, -field, -input, -link
  const stripped = token
    .replace(/[_-](btn|button)$/i, ' button')
    .replace(/[_-](field|input|txt)$/i, ' field')
    .replace(/[_-]link$/i, ' link');
  // Split on dash, underscore, or camelCase
  const words = stripped
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (!words.length) return token;
  const capitalized = words.map((w, i) =>
    i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()
  );
  return capitalized.join(' ');
}

/**
 * Cleans regex pattern characters into a plain URL path.
 * E.g. '^/invoices/new$' -> '/invoices/new'
 *      '/account/*'      -> '/account'
 *      '/*'              -> 'any page'
 */
export function cleanUrlPattern(pattern?: string): string {
  if (!pattern) return 'the expected page';
  let cleaned = pattern.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').trim();
  if (cleaned === '/*' || cleaned === '*') return 'any page';
  cleaned = cleaned.replace(/\/\.\*$/, '').replace(/\/\*$/, '');
  // Strip regex wildcards like /\d+, /.*, /[a-z]+, etc.
  cleaned = cleaned.replace(/\/(?:\\[a-zA-Z0-9+*.]+|\([^)]+\))(?:\/|$)/g, '/');
  cleaned = cleaned.replace(/\\[a-zA-Z0-9+*.]+/g, '');
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned || '/';
}

/**
 * Converts a TestCaseStep into a plain English sentence without code or selectors.
 */
export function stepToSentence(step: TestCaseStep): string {
  const stepName = step.name?.trim();
  const nameIsClean = stepName && !looksTechnical(stepName);
  const selectorWords = cleanSelectorWords(step.selector);

  // Pick target phrase
  const target = nameIsClean ? stepName : selectorWords;

  switch (step.action) {
    case 'click':
      if (target) {
        if (/^click\b/i.test(target)) return target.charAt(0).toUpperCase() + target.slice(1);
        return `Click “${target}”`;
      }
      return 'Click the button';

    case 'fill':
      if (target) {
        if (/^fill\b/i.test(target)) return target.charAt(0).toUpperCase() + target.slice(1);
        const val = step.value && !looksTechnical(step.value) && step.value.length < 30 ? ` with “${step.value}”` : '';
        return `Fill in “${target}”${val}`;
      }
      return 'Fill in the form';

    case 'select':
      if (target) {
        return `Choose an option for “${target}”`;
      }
      return 'Choose an option';

    case 'check':
      if (target) {
        return `Tick the box for “${target}”`;
      }
      return 'Tick the box';

    case 'navigate': {
      const dest = cleanUrlPattern(step.value || (nameIsClean ? stepName : undefined));
      return `Open page “${dest}”`;
    }

    case 'wait':
      return 'Wait for the page to finish loading';

    default:
      return 'Perform next action';
  }
}

/**
 * Translates candidate expectations and validation rules into plain sentences with origins.
 */
export function expectationsToChecks(
  expectations?: TestCaseExpectations,
  validationRules?: ValidationRule[]
): PlanCheck[] {
  const checks: PlanCheck[] = [];
  const defaultOrigin = expectations?.origin || 'observed';

  if (expectations?.validationError) {
    const field = expectations.validationError.field || 'the field';
    const cleanField = cleanSelectorWords(field) || field;
    checks.push({
      sentence: expectations.validationError.description || `Shows an error message if “${cleanField}” is invalid`,
      origin: defaultOrigin,
    });
  }

  if (expectations?.url) {
    const clean = cleanUrlPattern(expectations.url.pattern);
    checks.push({
      sentence: expectations.url.description || `Reaches page “${clean}”`,
      origin: defaultOrigin,
    });
  }

  if (expectations?.text) {
    if (expectations.text.contains) {
      checks.push({
        sentence: expectations.text.description || `Page mentions “${expectations.text.contains}”`,
        origin: defaultOrigin,
      });
    } else if (expectations.text.notContains) {
      checks.push({
        sentence: expectations.text.description || `Page does not mention “${expectations.text.notContains}”`,
        origin: defaultOrigin,
      });
    }
  }

  if (expectations?.apiCall) {
    checks.push({
      sentence: `Sends data to ${expectations.apiCall.path}`,
      origin: defaultOrigin,
    });
  }

  if (expectations?.elementState) {
    const target = cleanSelectorWords(expectations.elementState.selector) || 'The element';
    const state = expectations.elementState.visible !== false ? 'visible' : 'hidden';
    checks.push({
      sentence: expectations.elementState.description || `“${target}” becomes ${state}`,
      origin: defaultOrigin,
    });
  }

  if (validationRules && validationRules.length > 0) {
    for (const rule of validationRules) {
      const field = cleanSelectorWords(rule.selector) || rule.field;
      checks.push({
        sentence: `Validates “${field}”: ${rule.expectedError || 'must be filled correctly'}`,
        origin: rule.origin || defaultOrigin,
      });
    }
  }

  if (checks.length === 0) {
    checks.push({
      sentence: 'Loads and operates without errors',
      origin: 'observed',
    });
  }

  return checks;
}
