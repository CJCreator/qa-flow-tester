import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { TestCase } from '@qa/types';
import { Redactor, redactUrl, redactSecretText, storageStateSecrets } from '../src/redact.js';
import {
  replaceCredentialsWithPlaceholders,
  resolveCredentialPlaceholders,
  CredentialPlaceholderError,
} from '../src/credentials.js';

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
      'https://x.test/cb?code=***&access_token=***&state=2'
    );
    expect(redactUrl('see /reset?token=zzz for details')).toBe('see /reset?token=*** for details');
    expect(redactUrl('/search?q=password')).toBe('/search?q=password');
  });

  it('hides fragment tokens (implicit OAuth), signed-URL parameters and token-looking path segments', () => {
    expect(redactUrl('https://x.test/cb#access_token=abc.def&token_type=bearer')).toBe(
      'https://x.test/cb#access_token=***&token_type=bearer'
    );
    expect(redactUrl('https://b.test/o?X-Amz-Signature=abc123&X-Amz-Credential=AKIA%2F1&v=2')).toBe(
      'https://b.test/o?X-Amz-Signature=***&X-Amz-Credential=***&v=2'
    );
    expect(redactUrl('https://x.test/reset/9f8a7c6d5e4b3a2f1e0d9c8b7a6f5e4d/confirm')).toBe(
      'https://x.test/reset/***/confirm'
    );
    expect(redactUrl('https://x.test/products/blue-widget-2024/reviews')).toBe(
      'https://x.test/products/blue-widget-2024/reviews'
    );
  });

  it('scrubs a secret in HTML-escaped, JSON-escaped and unicode-escaped form', () => {
    const escaped = new Redactor([{ role: 'r', username: 'x', password: 'a&b<c"d' }]);
    expect(escaped.text('value a&amp;b&lt;c&quot;d here')).toBe('value *** here');
    expect(escaped.text('value a&#38;b&#60;c&#34;d here')).toBe('value *** here');
    expect(escaped.text('{"p":"a&b<c\\"d"}')).toBe('{"p":"***"}');
    const unicode = new Redactor([{ role: 'r', username: 'x', password: 'tok€n-x' }]);
    expect(unicode.text('json "tok\\u20acn-x"')).toBe('json "***"');
  });

  it('scrubs a one-character token only when the caller lowers the minimum', () => {
    const creds = [{ role: 'r', username: 'x', token: 'Q' }];
    expect(new Redactor(creds).text('Q marks it')).toBe('Q marks it');
    expect(new Redactor(creds, { minSecretLength: 1 }).text('Q marks it')).toBe('*** marks it');
  });

  it('scrubs the evidence files that were added to the list (csv, xml, yml, yaml, svg, har)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'redact-'));
    const names = ['a.csv', 'b.xml', 'c.yml', 'd.yaml', 'e.svg', 'f.har'];
    for (const n of names) await writeFile(path.join(dir, n), 'pw=manager-password', 'utf8');
    await new Redactor([{ role: 'manager', username: 'x', password: 'manager-password' }]).files(dir);
    for (const n of names) expect(await readFile(path.join(dir, n), 'utf8'), n).toBe('pw=***');
  });

  it('redacts every string inside nested data', () => {
    expect(redactor.deep({ a: ['manager-password', { b: 'x?pwd=1' }], n: 3, ok: true })).toEqual({
      a: ['***', { b: 'x?pwd=***' }],
      n: 3,
      ok: true,
    });
  });

  it('hides a Role’s header values and stored entries, and leaves short ordinary values', () => {
    const redactor = new Redactor([
      {
        role: 'member',
        headers: { 'X-Api-Key': 'k-9f3a77c2aa', Authorization: 'Bearer tok-1234567890', 'X-Lang': 'en' },
        localStorageEntries: { authToken: 'eyJhbGciOi.abc.def', theme: 'dark' },
      },
    ]);
    const out = redactor.text('key k-9f3a77c2aa bearer tok-1234567890 jwt eyJhbGciOi.abc.def lang en theme dark');
    expect(out).not.toContain('k-9f3a77c2aa');
    expect(out).not.toContain('tok-1234567890');
    expect(out).not.toContain('eyJhbGciOi.abc.def');
    expect(out).toContain('lang en');
    expect(out).toContain('theme dark');
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
    expect(
      resolveCredentialPlaceholders('{{password}}', 'viewer', roles, {
        pageUrl: 'https://example.com/login',
        targetUrl: 'https://example.com/',
      })
    ).toBe('viewer-password');
    expect(() =>
      resolveCredentialPlaceholders('{{username}}', 'someone-else', roles, {
        pageUrl: 'https://example.com/login',
        targetUrl: 'https://example.com/',
      })
    ).toThrow(CredentialPlaceholderError);
  });
});

describe('redactSecretText', () => {
  const cases: Array<[string, string]> = [
    ['secret: x', 'secret: ***'],
    ['"token":"x"', '"token":"***"'],
    ['client_secret=x', 'client_secret=***'],
    ['Bearer abc.def', 'Bearer ***'],
    ['Authorization: Bearer xyz.abc', 'Authorization: Bearer ***'],
    ['Authorization: secret-token-123', 'Authorization: ***'],
    ['api_key = abc123', 'api_key = ***'],
    ['the key idea', 'the key idea'],
    ['monkey: banana', 'monkey: banana'],
  ];

  it.each(cases)('redacts %s -> %s', (input, expected) => {
    expect(redactSecretText(input)).toBe(expected);
  });
});

describe('extra secrets and saved sessions (T-316)', () => {
  it('hides extra secrets of 8+ characters, and the bare token of a Bearer value', () => {
    const r = new Redactor([], { extraSecrets: ['bypass-0123456789', 'Bearer tunnel-abcdefgh', 'short'] });
    expect(r.text('h=bypass-0123456789 t=tunnel-abcdefgh s=short')).toBe('h=*** t=*** s=short');
  });

  it('lists cookie and localStorage values of a saved session, skipping what has none', () => {
    const values = storageStateSecrets({
      cookies: [{ name: 'sid', value: 'cookie-value-12345' }, { name: 'x' }],
      origins: [{ origin: 'https://a.test', localStorage: [{ name: 't', value: 'ls-value-67890' }] }],
    } as never);
    expect(values).toEqual(['cookie-value-12345', 'ls-value-67890']);
  });
});
