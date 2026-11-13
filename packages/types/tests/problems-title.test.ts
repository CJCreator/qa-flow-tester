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

describe('plainTitleText: raw checker WCAG titles', () => {
  it('rewrites known checker titles into plain language sentences', () => {
    expect(
      plainTitleText(
        'WCAG 1.4.3 Contrast (Minimum) violation: Elements must meet minimum color contrast ratio thresholds (color-contrast)'
      )
    ).toBe('Text doesn’t have enough contrast with its background');

    expect(
      plainTitleText(
        'WCAG 2.4.2 Page Titled violation: Documents must have <title> element to aid in navigation (document-title)'
      )
    ).toBe('The page is missing a title');

    expect(
      plainTitleText('WCAG 1.1.1 Non-text Content violation: Images must have alternate text (image-alt)')
    ).toBe('An image is missing a text description for screen readers');
  });

  it('strips WCAG criteria prefix and trailing rule ids from unmapped checker titles', () => {
    expect(
      plainTitleText(
        'WCAG 4.1.2 Name, Role, Value violation: Custom widgets must have accessible names (custom-widget)'
      )
    ).toBe('Custom widgets must have accessible names');

    expect(plainTitleText('WCAG violation: Input elements must have labels (input-label)')).toBe(
      'Input elements must have labels'
    );
  });
});
