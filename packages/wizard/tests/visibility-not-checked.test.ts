import { describe, expect, it } from 'vitest';
import { tabScoreText } from '../src/screens/VisibilityScreen';

describe('Visibility tab score', () => {
  it('says Not checked when there is no part', () => {
    expect(tabScoreText(null)).toBe('Not checked');
    expect(tabScoreText(undefined)).toBe('Not checked');
  });
  it('says Not checked when the part was not checked', () => {
    expect(tabScoreText({ score: 100, checked: false })).toBe('Not checked');
  });
  it('shows the score otherwise', () => {
    expect(tabScoreText({ score: 82 })).toBe('82%');
    expect(tabScoreText({ score: 0, checked: true })).toBe('0%');
  });
});
