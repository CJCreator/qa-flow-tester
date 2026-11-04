import { describe, it, expect } from 'vitest';
import type { TestCase } from '@qa/types';
import { Redactor, redactUrl } from '../src/redact.js';
import { replaceCredentialsWithPlaceholders, resolveCredentialPlaceholders } from '../src/credentials.js';

describe('Redactor', () => {
  const redactor = new Redactor([
    { role: 'manager', username: 'manager@example.com', password: 'manager-password' },
    { role: 'admin', username: 'admin', password: 'p@ss word!', token: 'tok_12345' },
  ]);

  it('hides passwords, tokens and email usernames, as typed and as they appear in addresses', () => {
    expect(redactor.text('logged in with manager-password')).toBe('logged in with ***');
    expect(redactor.text('/dashboard?email=manager%40example.com&password=manager-password')).toBe(
      '/dashboard?email=***&password=***'
    );
    expect(redactor.text('p@ss word! and p%40ss%20word! and p%40ss+word!')).toBe('*** and *** and ***');
    expect(redactor.text('Bearer tok_12345')).toBe('Bearer ***');
  });

  it('keeps plain usernames, which would blank out ordinary words', () => {
    expect(redactor.text('Signed in as admin on the admin page')).toBe('Signed in as admin on the admin page');
  });

  it('hides secret-looking URL parameters even when the secret is unknown', () => {
    expect(redactUrl('https://x.test/cb?code=1&access_token=abc.def&state=2')).toBe(
      'https://x.test/cb?code=1&access_token=***&state=2'
    );
    expect(redactUrl('see /reset?token=zzz for details')).toBe('see /reset?token=*** for details');
    expect(redactUrl('/search?q=password')).toBe('/search?q=password');
  });

  it('redacts every string inside nested data', () => {
    expect(redactor.deep({ a: ['manager-password', { b: 'x?pwd=1' }], n: 3, ok: true })).toEqual({
      a: ['***', { b: 'x?pwd=***' }],
      n: 3,
      ok: true,
    });
  });
});

describe('Credential placeholders', () => {
  const roles = [
    { role: 'manager', username: 'manager@example.com', password: 'manager-password' },
    { role: 'viewer', username: 'viewer@example.com', password: 'viewer-password' },
  ];

  it('keeps sign-in details out of plans and fills them in only when a step runs', () => {
    const steps: TestCase['steps'] = [
      { action: 'fill', selector: '#email', value: 'viewer@example.com', name: 'Email' },
      { action: 'fill', selector: '#password', value: 'viewer-password', name: 'Password' },
      { action: 'fill', selector: '#note', value: 'hello', name: 'Note' },
    ];
    replaceCredentialsWithPlaceholders(steps, roles);
    expect(steps.map((s) => s.value)).toEqual(['{{username}}', '{{password}}', 'hello']);
    expect(resolveCredentialPlaceholders('{{password}}', 'viewer', roles)).toBe('viewer-password');
    expect(resolveCredentialPlaceholders('{{username}}', 'someone-else', roles)).toBe('manager@example.com');
  });
});
