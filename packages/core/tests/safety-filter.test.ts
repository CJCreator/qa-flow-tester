import { describe, it, expect } from 'vitest';
import { SafetyFilter } from '../src/discovery/safety-filter.js';

describe('SafetyFilter', () => {
  it('should intercept destructive actions like deletions', () => {
    const filter = new SafetyFilter();
    const result = filter.isSensitive('Delete Invoice', '[data-testid="delete-invoice-btn"]');

    expect(result).not.toBeNull();
    expect(result?.type).toBe('deletion');
    expect(result?.reason).toContain('destructive');
  });

  it('should intercept payment and checkout actions', () => {
    const filter = new SafetyFilter();
    const result = filter.isSensitive('Pay Now ($500)', '[data-testid="checkout-btn"]');

    expect(result).not.toBeNull();
    expect(result?.type).toBe('payment');
  });

  it('should intercept explicit profile forbidden actions', () => {
    const filter = new SafetyFilter(['drop-database', 'revoke-license']);
    const result = filter.isSensitive('Drop Database Now', '#danger-btn');

    expect(result).not.toBeNull();
    expect(result?.reason).toContain('drop-database');
  });

  it('should allow benign actions', () => {
    const filter = new SafetyFilter();
    const result = filter.isSensitive('Save Invoice', '[data-testid="save-btn"]');

    expect(result).toBeNull();
  });

  it('should generate targeted ambiguity questions for sensitive actions', () => {
    const filter = new SafetyFilter();
    const sensitive = filter.isSensitive('Delete Account', '[data-testid="delete-btn"]')!;
    sensitive.urlPath = '/settings';

    const question = filter.createAmbiguityQuestion(sensitive, 1);
    expect(question.id).toBe('Q-SENSITIVE-1');
    expect(question.category).toBe('sensitive_action');
    expect(question.question).toBe(
      '“Delete Account” on /settings looks like it deletes something. Should the tests press it?'
    );
    // The safe answer is never to press it, and the key stays the same from run to run.
    expect(question.safeAnswer).toBe('Don’t press it');
    expect(question.options).toContain(question.safeAnswer);
    expect(question.key).toBe('sensitive:/settings:[data-testid="delete-btn"]');
  });
});
