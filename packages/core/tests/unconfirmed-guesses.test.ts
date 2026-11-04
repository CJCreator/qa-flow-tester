import { describe, it, expect } from 'vitest';
import type { TestCase } from '@qa/types';
import { expandValidationTestCases } from '../src/validator-expander.js';

const loginCase: TestCase = {
  id: 'TC-LOGIN',
  flowId: 'FLOW-LOGIN',
  role: 'visitor',
  startPage: '/login',
  steps: [
    { action: 'fill', selector: '#user-name', value: 'standard_user', name: 'Enter username' },
    { action: 'fill', selector: '#password', value: 'secret', name: 'Enter password' },
    { action: 'click', selector: '#login-button', name: 'Log in' },
  ],
  expectations: { origin: 'ai-guess', url: { pattern: '/inventory' } },
  validationRules: [
    {
      field: 'user-name',
      selector: '#user-name',
      min: 0,
      max: 50,
      expectedError: 'Field is empty',
      origin: 'ai-guess',
    },
  ],
};

describe('Validation expander with guessed rules', () => {
  it('turns a guessed rule into one behaviour check, with no invented limits or wording', () => {
    const expanded = expandValidationTestCases([loginCase]);
    expect(expanded.map((tc) => tc.id)).toEqual(['TC-LOGIN', 'TC-LOGIN-val-user-name-empty']);
    const empty = expanded[1];
    expect(empty.steps[0].value).toBe('');
    expect(empty.expectations).toEqual({
      origin: 'ai-guess',
      validationError: {
        field: 'user-name',
        selector: '#user-name',
        description: 'An error appears when "user-name" is left empty',
      },
    });
  });

  it('skips a guessed rule for a field the flow never fills', () => {
    const expanded = expandValidationTestCases([
      {
        ...loginCase,
        validationRules: [
          { field: 'coupon', selector: '#coupon', expectedError: 'Invalid coupon', origin: 'ai-guess' },
        ],
      },
    ]);
    expect(expanded).toHaveLength(1);
  });
});
