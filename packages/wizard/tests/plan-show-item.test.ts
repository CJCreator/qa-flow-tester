import { describe, expect, it } from 'vitest';
import { itemDomId, safeDecodeHash } from '../src/components/plan/parts';

describe('Plan item addresses', () => {
  it('decodes a valid hash', () => {
    expect(safeDecodeHash('page%3A%2Fpricing')).toBe('page:/pricing');
  });
  it('returns null for a malformed hash instead of throwing', () => {
    expect(safeDecodeHash('%')).toBeNull();
    expect(safeDecodeHash('%E0%A4%A')).toBeNull();
  });
  it('keeps element ids free of selector characters', () => {
    expect(itemDomId('page:/a"b')).toBe('item-page_a_b');
  });
});
