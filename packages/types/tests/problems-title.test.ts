import { describe, it, expect } from 'vitest';
import { plainTitleText } from '../src/problems.js';

describe('plainTitleText: touch targets', () => {
  it('reads all three touch-target titles as one plain sentence', () => {
    const plain = '“Home” is too small to tap easily on a phone';
    expect(plainTitleText('Touch target too small: Home (37x18px)')).toBe(plain);
    expect(plainTitleText('Touch target below WCAG 2.5.8 minimum: Home (20x18px)')).toBe(plain);
    expect(plainTitleText('Touch target smaller than recommended: Home (39x30px)')).toBe(plain);
  });

  it('falls back to a general sentence when the title has no size', () => {
    expect(plainTitleText('Touch target too small')).toBe('A button is too small to tap easily on a phone');
  });
});

describe('plainTitleText: sideways scrolling', () => {
  it('reads both overflow titles as one plain sentence', () => {
    const plain = 'The page is wider than the screen and scrolls sideways';
    expect(plainTitleText('Content overflows the screen horizontally at 375px')).toBe(plain);
    expect(plainTitleText('Horizontal page overflow detected (375px)')).toBe(plain);
  });
});
