import { describe, it, expect } from 'vitest';
import { fieldHint, guessFillValue } from '../src/plan/fill-values.js';

describe('guessFillValue', () => {
  it('reads the attribute value, not the attribute word', () => {
    expect(guessFillValue('input[name="quantity"] Quantity')).toBe('1');
    expect(guessFillValue('[name="comment"] Comment')).toBe('Test Value');
    expect(guessFillValue('[name="full_name"] Your name')).toBe('Test User');
    expect(guessFillValue('#email Email')).toBe('test.user@example.com');
  });
  it('fieldHint drops selector attribute words', () => {
    expect(fieldHint('input[name="qty"][type="number"]')).not.toContain('name');
    expect(fieldHint('input[name="qty"][type="number"]')).toContain('qty');
  });
});
