import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { TestCase } from '@qa/types';
import { Redactor, redactUrl } from '../src/redact.js';
import { replaceCredentialsWithPlaceholders, resolveCredentialPlaceholders } from '../src/credentials.js';
import { FlowTestOrchestrator, type OrchestratorEvent } from '../src/orchestrator.js';
import { server } from '../../../fixtures/test-app/server.js';

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

describe('A run keeps passwords out of everything it writes', () => {
  const PORT = 3505;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-redaction');

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  async function allFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? allFiles(path.join(dir, e.name)) : Promise.resolve([path.join(dir, e.name)])
      )
    );
    return nested.flat();
  }

  it('flags the GET sign-in form, and no output file or event contains the password', async () => {
    const events: OrchestratorEvent[] = [];
    const report = await new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'fixture',
      outputDir,
      breakpoints: ['1440px'],
      enableA11y: false,
      recordVideo: false,
      onEvent: (e) => events.push(e),
      profile: {
        name: 'Fixture',
        productId: 'fixture',
        roles: [
          { role: 'manager', username: 'manager@example.com', password: 'manager-password', loginPath: '/login' },
        ],
      },
      specTestCases: [
        {
          id: 'TC-SIGN-IN',
          flowId: 'FLOW-SIGN-IN',
          role: 'manager',
          startPage: '/login',
          steps: [
            { action: 'fill', selector: '[data-testid="email-input"]', value: '{{username}}', name: 'Enter email' },
            {
              action: 'fill',
              selector: '[data-testid="password-input"]',
              value: '{{password}}',
              name: 'Enter password',
            },
            { action: 'click', selector: '[data-testid="submit-btn"]', name: 'Sign in' },
          ],
          expectations: { url: { pattern: '/dashboard' } },
        },
      ],
    });

    // The site really did sign in with the real password…
    expect(report.results[0].stepEvidence.at(-1)?.urlAfter).toContain('/dashboard?email=***&password=***');
    // …and its GET sign-in form is reported as a security problem.
    const security = report.findings.filter((f) => f.checker === 'security');
    expect(security.map((f) => f.title)).toContain('The sign-in form sends passwords in the page address');

    const leaks: string[] = [];
    for (const file of await allFiles(outputDir)) {
      if (/\.(png|webm)$/.test(file) || file.includes(`${path.sep}auth${path.sep}`)) continue;
      if ((await fs.readFile(file, 'utf8')).includes('manager-password')) leaks.push(path.relative(outputDir, file));
    }
    expect(leaks).toEqual([]);
    expect(JSON.stringify(events)).not.toContain('manager-password');
  }, 60000);
});
