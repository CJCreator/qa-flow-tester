import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { Page } from 'playwright';
import { Redactor, runSecrets, sessionCookies } from '../src/redact.js';
import { EvidenceCollector, SIGN_IN_FIELD_SELECTORS } from '../src/evidence.js';

const HEADER = 'hdr-SECRET-9931';
const TUNNEL = 'tunnel-SECRET-7712';
const COOKIE = 'cookie-SECRET-4480';
const PASSWORD = 'hunter2-SECRET';

describe('runSecrets: one list for every path', () => {
  it('includes role passwords, header values, tunnel authorization and cookie values', () => {
    const list = runSecrets({
      roles: [{ role: 'member', username: 'a@example.test', password: PASSWORD }],
      customHeaders: { 'X-Bypass': HEADER },
      tunnelAuth: TUNNEL,
      cookies: [{ name: 'session', value: COOKIE }],
    });
    const tokens = list.map((s) => s.token ?? s.password);
    expect(tokens).toEqual(expect.arrayContaining([PASSWORD, HEADER, TUNNEL, COOKIE, 'session']));
  });

  it('skips short header, tunnel and cookie values, which match ordinary words', () => {
    const list = runSecrets({ customHeaders: { 'X-A': 'ab' }, tunnelAuth: 'x', cookies: [{ value: 'no' }] });
    expect(list).toEqual([]);
  });

  it('adds the secret-looking parameters of the target URL', () => {
    const list = runSecrets({ targetUrl: 'https://x.test/?access_token=TOKVAL123' });
    expect(list).toEqual([{ token: 'TOKVAL123' }]);
  });
});

describe('Redactor.add', () => {
  it('hides a cookie value learned after the redactor was built, and keeps earlier secrets hidden', () => {
    const redactor = new Redactor(runSecrets({ customHeaders: { 'X-Bypass': HEADER } }));
    expect(redactor.text(`${HEADER} ${COOKIE}`)).toBe(`*** ${COOKIE}`);
    redactor.add(runSecrets({ cookies: [{ name: 'session', value: COOKIE }] }));
    expect(redactor.text(`${HEADER} ${COOKIE}`)).toBe('*** ***');
  });
});

describe('sessionCookies', () => {
  it('reads cookie values from storage state objects and from saved files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't45-cookies-'));
    const file = path.join(dir, 'member.json');
    await fs.writeFile(file, JSON.stringify({ cookies: [{ name: 'sid', value: 'FILE-COOKIE-1' }], origins: [] }));
    const cookies = await sessionCookies({
      admin: { cookies: [{ name: 'sid', value: 'OBJ-COOKIE-2' }], origins: [] },
      member: file,
      gone: path.join(dir, 'missing.json'),
    });
    expect(cookies.map((c) => c.value)).toEqual(['OBJ-COOKIE-2', 'FILE-COOKIE-1']);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('Redactor.files text evidence list', () => {
  it.each(['.csv', '.xml', '.yml', '.yaml', '.svg', '.har'])('redacts a %s file in place', async (ext) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't45-files-'));
    const file = path.join(dir, `evidence${ext}`);
    await fs.writeFile(file, `value=${PASSWORD}`, 'utf8');
    await new Redactor([{ role: 'member', username: 'u', password: PASSWORD }]).files(dir);
    expect(await fs.readFile(file, 'utf8')).toBe('value=***');
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('EvidenceCollector writes redacted evidence', () => {
  /** A page stand-in: records the screenshot options and returns a DOM that holds a secret. */
  function fakePage(html: string) {
    const shots: Array<{ mask?: unknown[] }> = [];
    const page = {
      url: () => 'https://x.test/login',
      content: async () => html,
      screenshot: async (opts: { mask?: unknown[] }) => {
        shots.push(opts);
        return Buffer.from([]);
      },
      locator: (selector: string) => ({ selector }),
    } as unknown as Page;
    return { page, shots };
  }

  it('hides a secret in the DOM snapshot as it is written, so a stopped run keeps none', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't45-evidence-'));
    const redactor = new Redactor([{ role: 'member', username: 'u', password: PASSWORD }]);
    const collector = new EvidenceCollector(dir, (text) => redactor.text(text));
    const { page } = fakePage(`<input value="${PASSWORD}">`);
    await collector.recordStep(page, 1, 'Sign in', 'fill', 'https://x.test/login', false); // T-54: evidence is written for a failed step only
    // No end-of-run pass: the run "stopped" here.
    const dom = await fs.readFile(path.join(dir, 'step-1-Sign_in.html'), 'utf8');
    expect(dom).not.toContain(PASSWORD);
    expect(dom).toContain('value="***"');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('masks sign-in fields in every screenshot', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't45-mask-'));
    const collector = new EvidenceCollector(dir);
    const { page, shots } = fakePage('<html></html>');
    await collector.recordStep(page, 1, 'Step', 'click', 'https://x.test/', false); // T-54: failed step only
    expect(shots[0].mask).toHaveLength(SIGN_IN_FIELD_SELECTORS.length);
    expect(SIGN_IN_FIELD_SELECTORS).toContain('input[type="password"]');
    await fs.rm(dir, { recursive: true, force: true });
  });
});
