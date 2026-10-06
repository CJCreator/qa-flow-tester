import { describe, it, expect } from 'vitest';
import { addressFromSearch } from '../src/lib/form';

describe('landing page address prefill', () => {
  it('reads the address the landing form sent', () => {
    expect(addressFromSearch('?url=https%3A%2F%2Fexample.com')).toBe('https://example.com');
    expect(addressFromSearch('?url=example.com')).toBe('example.com');
  });
  it('ignores a missing, blank or oversized value', () => {
    expect(addressFromSearch('')).toBe('');
    expect(addressFromSearch('?url=')).toBe('');
    expect(addressFromSearch('?url=%20%20')).toBe('');
    expect(addressFromSearch(`?url=${'a'.repeat(3000)}`)).toBe('');
  });
});
