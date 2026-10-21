import { describe, it, expect } from 'vitest';
import { aspectLabel } from '../src/aspects.js';
import type { AspectType } from '../src/aspects.js';

describe('aspectLabel', () => {
  it('shows Secure as Security', () => {
    expect(aspectLabel('Secure')).toBe('Security');
  });

  it('leaves every other aspect unchanged', () => {
    const others: AspectType[] = ['Works', 'Accessible', 'Fast and mobile', 'Findable', 'Looks and reads well'];
    for (const aspect of others) {
      expect(aspectLabel(aspect)).toBe(aspect);
    }
  });
});
