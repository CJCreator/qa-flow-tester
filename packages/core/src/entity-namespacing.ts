import type { TestCaseStep } from '@qa/types';
import { CREDENTIAL_PLACEHOLDERS } from './credentials.js';

/** Fields where adding text could break the value (codes, numbers, dates, secrets, searches). */
const UNSAFE_HINT = /pass|pwd|otp|code|pin|card|cvv|zip|postal|phone|tel|date|url|search|query|coupon|captcha/i;
const EMAIL_SHAPE = /^([^@\s+]+)@([^@\s]+\.[^@\s]+)$/;
const FREE_TEXT = /^[A-Za-z][A-Za-z '.,-]{2,79}$/;

export class EntityNamespacer {
  /**
   * Generates a unique, collision-resistant identifier prefixed with worker ID.
   */
  static generateName(baseName: string, workerId: string | number): string {
    const cleanBase = baseName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    return `${cleanBase}_w${workerId}_${randomSuffix}`;
  }

  /**
   * Same run + Test + screen size always gives the same token, so a retry reuses it.
   * Six lowercase letters: safe in names and emails. Holds no secret.
   */
  static runToken(runId: string, testCaseId: string, breakpoint = ''): string {
    const input = `${runId}|${testCaseId}|${breakpoint}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    let out = '';
    for (let i = 0; i < 6; i++) {
      out += String.fromCharCode(97 + (hash % 26));
      hash = Math.floor(hash / 26);
    }
    return out;
  }

  /**
   * The value to type for a fill step on a Test Copy, with the run token added where that is safe.
   * Credentials, numbers, dates, secrets-like fields and long text are left alone.
   */
  static namespaceFillValue(step: TestCaseStep, token: string): string {
    const value = step.value;
    if (!value) return value ?? '';
    if (value.includes(CREDENTIAL_PLACEHOLDERS.username) || value.includes(CREDENTIAL_PLACEHOLDERS.password)) {
      return value;
    }
    if (value.includes('{{unique}}') || value.includes('{{entityName}}')) {
      const unique = `w_${token}`;
      return value.replace(/\{\{unique\}\}/g, unique).replace(/\{\{entityName\}\}/g, `entity_${unique}`);
    }
    if (value.endsWith(token)) return value;
    const email = EMAIL_SHAPE.exec(value);
    if (email) {
      return `${email[1]}+${token}@${email[2]}`;
    }
    if (UNSAFE_HINT.test(`${step.name ?? ''} ${step.selector ?? ''}`)) return value;
    if (FREE_TEXT.test(value)) return `${value} ${token}`;
    return value;
  }

  /**
   * Replaces variables like `{{entityName}}` or `{{unique_id}}` inside test step values.
   * With a run token the result is the same on every call; without one it is random.
   */
  static injectStepValues(step: TestCaseStep, workerId: string | number, runToken?: string): TestCaseStep {
    if (!step.value) {
      return step;
    }

    let modifiedValue = step.value;
    if (modifiedValue.includes('{{unique}}') || modifiedValue.includes('{{entityName}}')) {
      const uniqueToken = runToken
        ? `w${workerId}_${runToken}`
        : `w${workerId}_${Math.random().toString(36).substring(2, 7)}`;
      modifiedValue = modifiedValue
        .replace(/\{\{unique\}\}/g, uniqueToken)
        .replace(/\{\{entityName\}\}/g, `entity_${uniqueToken}`);
    }

    return {
      ...step,
      value: modifiedValue,
    };
  }
}
