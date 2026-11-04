import { describe, it, expect } from 'vitest';
import { findClaimWords, hasClaimWords } from '../src/audit/ai/claim-words.js';

describe('findClaimWords (ADR 0018)', () => {
  it.each([
    ['The site is compliant.', 'compliant'],
    ['COMPLIANT with the rules', 'compliant'],
    ['A Certified shop', 'certified'],
    ['Your checkout is SeCuRe', 'secure'],
    ['The homepage is fully accessible', 'fully accessible'],
    ['The page Fully   Accessible now', 'fully accessible'],
    ['It passes WCAG 2.2', 'passes WCAG'],
    ['it passes wcag', 'passes WCAG'],
    ['The site is ready to release.', 'Ready to release'],
    ['READY TO RELEASE', 'Ready to release'],
  ])('finds the claim in %j', (text, word) => {
    expect(findClaimWords(text)).toContain(word);
    expect(hasClaimWords(text)).toBe(true);
  });

  it('finds a claim inside Tamil text', () => {
    expect(findClaimWords('இந்த தளம் secure ஆக உள்ளது')).toEqual(['secure']);
  });

  it('lists each claim once', () => {
    expect(findClaimWords('secure, secure and compliant')).toEqual(['compliant', 'secure']);
  });

  it('reports none for text without claims', () => {
    expect(findClaimWords('The contact form has no label on the email field.')).toEqual([]);
    expect(findClaimWords('')).toEqual([]);
    expect(hasClaimWords('Two headings skip a level.')).toBe(false);
  });

  describe('derived forms are not claims', () => {
    it.each([
      ['securely', 'Store passwords securely.'],
      ['insecure', 'The form posts over an insecure link.'],
      ['security', 'Security headers are missing.'],
      ['non-compliant', 'A non-compliant cookie banner.'],
      ['noncompliant', 'A noncompliant cookie banner.'],
      ['certifiedly', 'certifiedly odd'],
      ['accessible alone', 'The menu is accessible by keyboard.'],
      ['WCAG alone', 'WCAG 2.2 criterion 1.4.3 fails.'],
      ['secure_ (identifier)', 'secure_cookie flag'],
      ['letter-joined (Unicode)', 'secureé'],
    ])('%s', (_name, text) => {
      expect(findClaimWords(text)).toEqual([]);
    });
  });
});
