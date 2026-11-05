import { describe, expect, it } from 'vitest';
import { HOME_FAQ } from '../src/lib/faq';

describe('home FAQ copy', () => {
  it('names no AI provider in the pricing answer', () => {
    const item = HOME_FAQ.find((f) => /free during the beta/.test(f.a));
    expect(item?.a).toContain('a free or low-cost model works');
    expect(item?.a).not.toContain('OpenRouter');
  });
});
