import { describe, expect, it } from 'vitest';
import { viewFor } from '../src/screens/VisualBaselinesScreen';

describe('Visual Baselines view', () => {
  it('keeps side by side always', () => {
    expect(viewFor('split', null)).toBe('split');
    expect(viewFor('split', {})).toBe('split');
  });
  it('offers the slider only with a new screenshot', () => {
    expect(viewFor('overlay', {})).toBe('split');
    expect(viewFor('overlay', { currentUrl: '/x.png' })).toBe('overlay');
  });
  it('offers what changed only with a diff', () => {
    expect(viewFor('diff-only', { currentUrl: '/x.png' })).toBe('split');
    expect(viewFor('diff-only', { diffUrl: '/d.png' })).toBe('diff-only');
  });
});
