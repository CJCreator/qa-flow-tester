import { describe, it, expect } from 'vitest';
import { wcagCriteria } from '../src/ux-quality.js';

describe('wcagCriteria with new tags', () => {
  it('maps wcag1411 to Non-text Contrast', () => {
    expect(wcagCriteria(['wcag1411'])).toEqual(['WCAG 1.4.11 Non-text Contrast']);
  });

  it('maps the other six new WCAG criteria tags', () => {
    expect(wcagCriteria(['wcag135'])).toEqual(['WCAG 1.3.5 Identify Input Purpose']);
    expect(wcagCriteria(['wcag1412'])).toEqual(['WCAG 1.4.12 Text Spacing']);
    expect(wcagCriteria(['wcag246'])).toEqual(['WCAG 2.4.6 Headings and Labels']);
    expect(wcagCriteria(['wcag331'])).toEqual(['WCAG 3.3.1 Error Identification']);
    expect(wcagCriteria(['wcag333'])).toEqual(['WCAG 3.3.3 Error Suggestion']);
    expect(wcagCriteria(['wcag413'])).toEqual(['WCAG 4.1.3 Status Messages']);
  });

  it('maps an unknown tag to a bare WCAG number', () => {
    expect(wcagCriteria(['wcag999'])).toEqual(['WCAG 9.9.9']);
  });
});
