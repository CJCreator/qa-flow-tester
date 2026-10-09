import { describe, it, expect } from 'vitest';
import { capLine, capFromInputs } from '../src/lib/cap';

describe('cap', () => {
  it('parses inputs', () => {
    expect(capFromInputs('50', '')).toEqual({ requests: 50 });
    expect(capFromInputs('', '2.5')).toEqual({ dollars: 2.5 });
    expect(capFromInputs('0', 'abc')).toBeUndefined();
  });
  it('shows requests of the cap, no dollars without a price', () => {
    const line = capLine({ low: 30, high: 46 }, { requests: 50, dollars: 5 });
    expect(line).toBe('About 38 requests of your 50 cap.');
    expect(line).not.toMatch(/\$/);
  });
  it('shows dollars only when priced', () => {
    expect(capLine({ low: 10, high: 10, estimatedUsd: 0.4 }, { dollars: 1 })).toBe(
      'About 10 requests, about $0.40 of your $1.00 cap.'
    );
  });
  it('warns when the cap is lower', () => {
    expect(capLine({ low: 60, high: 80 }, { requests: 50 })).toMatch(/fixed rules/);
  });
});
