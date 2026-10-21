import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Redactor, redactUrl } from '../src/redact.js';

describe('redactUrl forms', () => {
  it.each([
    ['query parameter', '/login?p=hunter2', '/login?p=***'],
    ['fragment token', 'https://x.test/cb#access_token=abc.def&state=1', 'https://x.test/cb#access_token=***&state=1'],
    ['path token', 'https://x.test/reset/abc123XYZ', 'https://x.test/reset/***'],
    ['OAuth code', 'https://x.test/cb?code=abc&state=2', 'https://x.test/cb?code=***&state=2'],
    [
      'signed URL',
      'https://b.s3.amazonaws.com/o?X-Amz-Signature=deadbeef&X-Amz-Expires=60',
      'https://b.s3.amazonaws.com/o?X-Amz-Signature=***&X-Amz-Expires=60',
    ],
    ['reset_token', 'https://x.test/new?reset_token=zz9', 'https://x.test/new?reset_token=***'],
    ['ordinary query', '/search?q=password&page=2', '/search?q=password&page=2'],
  ])('hides the value in a %s', (_name, input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });
});

describe('Redactor escaped forms', () => {
  const password = `pw&"<'!*()x`;
  const forms: Array<[string, string]> = [
    ['raw', password],
    ['HTML entity', 'pw&amp;&quot;&lt;&#39;!*()x'],
    ['HTML hex entity', 'pw&amp;&quot;&lt;&#x27;!*()x'],
    ['JSON escaped', JSON.stringify(password).slice(1, -1)],
    ['URI encoded', encodeURIComponent(password)],
    ['form encoded', new URLSearchParams([['v', password]]).toString().slice(2)],
  ];

  it.each(forms)('hides the %s form', (_name, form) => {
    const redactor = new Redactor([{ role: 'admin', username: 'admin', password }]);
    expect(redactor.text(`sent ${form} now`)).toBe('sent *** now');
  });
});

describe('Redactor short role credentials', () => {
  it('hides a two-character password everywhere it appears in text and events', async () => {
    const redactor = new Redactor([{ role: 'admin', username: 'admin', password: 'ab' }]);
    expect(redactor.text('typed ab, then abc')).toBe('typed ***, then ***c');
    expect(redactor.deep({ message: 'ab', nested: [{ url: '/x?q=ab' }] })).toEqual({
      message: '***',
      nested: [{ url: '/x?q=***' }],
    });
  });

  it('hides a two-character password in text evidence files', async () => {
    const redactor = new Redactor([{ role: 'admin', username: 'admin', password: 'ab' }]);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redact-forms-'));
    try {
      const file = path.join(dir, 'step-1.html');
      await fs.writeFile(file, '<p>ab</p>', 'utf8');
      await redactor.files(dir);
      expect(await fs.readFile(file, 'utf8')).toBe('<p>***</p>');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
