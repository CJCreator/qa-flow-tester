import { describe, expect, it } from 'vitest';
import { contactLinks, ISSUES_URL } from '../src/lib/contact';

describe('contactLinks', () => {
  it('falls back to GitHub issues when nothing is set', () => {
    const c = contactLinks({});
    expect(c.contactHref).toBe(ISSUES_URL);
    expect(c.contactIsEmail).toBe(false);
    expect(c.signupAction).toBeNull();
    expect(c.feedbackHref).toBe(ISSUES_URL);
  });
  it('uses a valid email as mailto', () => {
    const c = contactLinks({ email: 'hi@example.com' });
    expect(c.contactHref).toBe('mailto:hi@example.com');
    expect(c.contactIsEmail).toBe(true);
  });
  it('ignores bad emails', () => {
    for (const bad of ['a b@x.com', 'x@y', '<script>@x.com', `${'a'.repeat(300)}@x.com`]) {
      const c = contactLinks({ email: bad });
      expect(c.contactIsEmail).toBe(false);
      expect(c.contactHref).toBe(ISSUES_URL);
    }
  });
  it('accepts only an https sign-up endpoint without credentials', () => {
    const good = 'https://buttondown.com/api/emails/embed-subscribe/x';
    expect(contactLinks({ signupUrl: good }).signupAction).toBe(good);
    for (const bad of ['http://h.com/x', 'javascript:alert(1)', 'https://u:p@h.com', '//h.com', 'garbage']) {
      expect(contactLinks({ signupUrl: bad }).signupAction).toBeNull();
    }
  });
});
