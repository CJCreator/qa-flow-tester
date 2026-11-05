/**
 * LAT-13/LAT-14: planValidatorFor builds one validator per pages/forms pair and reuses it.
 * Unit tier: plain objects, no browser.
 */
import { describe, it, expect } from 'vitest';
import { planValidatorFor } from '../src/discovery/plan-validator.js';
import type { PageInventoryItem } from '@qa/types';

const pages = [{ urlPath: '/', elements: [] }] as unknown as PageInventoryItem[];

describe('planValidatorFor (LAT-13/14)', () => {
  it('returns the same validator for the same pages and forms', () => {
    expect(planValidatorFor(pages, undefined)).toBe(planValidatorFor(pages, undefined));
  });

  it('builds a new validator when the forms object differs', () => {
    const a = planValidatorFor(pages, []);
    expect(planValidatorFor(pages, [])).not.toBe(a);
  });

  it('builds a new validator for a different pages array', () => {
    const other = [{ urlPath: '/x', elements: [] }] as unknown as PageInventoryItem[];
    expect(planValidatorFor(other, undefined)).not.toBe(planValidatorFor(pages, undefined));
  });
});
