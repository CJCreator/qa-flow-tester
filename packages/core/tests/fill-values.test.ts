import { describe, it, expect } from 'vitest';
import { fieldHint, guessFillValue } from '../src/plan/fill-values.js';

describe('guessFillValue', () => {
  it('reads the attribute value, not the attribute word', () => {
    expect(guessFillValue('input[name="quantity"] Quantity')).toBe('1');
    expect(guessFillValue('[name="comment"] Comment')).toBe('Test Value');
    expect(guessFillValue('[name="full_name"] Your name')).toBe('Test User');
    expect(guessFillValue('#email Email')).toBe('test.user@example.com');
  });
  it('identifies field types and assigns believable values', () => {
    expect(guessFillValue('[name="search"]')).toBe('test');
    expect(guessFillValue('input[type=date] Date of birth')).toBe('2026-11-01');
    expect(guessFillValue('#zip Postal code')).toBe('90210');
    expect(guessFillValue('[name="phone"] Mobile')).toBe('+15555550123');
    expect(guessFillValue('[name="first_name"]')).toBe('Alex');
    expect(guessFillValue('[name="last_name"]')).toBe('Smith');
    expect(guessFillValue('[name="price"] Price')).toBe('49.99');
    expect(guessFillValue('input[name="quantity"] Quantity')).toBe('1');
  });
  it('fieldHint drops selector attribute words', () => {
    expect(fieldHint('input[name="qty"][type="number"]')).not.toContain('name');
    expect(fieldHint('input[name="qty"][type="number"]')).toContain('qty');
  });
});
