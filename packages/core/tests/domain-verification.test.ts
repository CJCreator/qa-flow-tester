import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { decideTestCopy, proofLine, proofMatches, proofUrl, PROOF_PATH } from '../src/domain-verification.js';

describe('Verified Domain proof', () => {
  it('proofUrl is https only, exact host and port', () => {
    expect(proofUrl('https://preview-1.vercel.app')).toBe(`https://preview-1.vercel.app${PROOF_PATH}`);
    expect(proofUrl('https://example.com:8443/some/path?x=1')).toBe(`https://example.com:8443${PROOF_PATH}`);
    expect(proofUrl('http://example.com')).toBeNull();
    expect(proofUrl('not a url')).toBeNull();
    expect(proofUrl('ftp://example.com')).toBeNull();
  });

  it('rejects userinfo, IP literals, private text hosts', () => {
    expect(proofUrl('https://user:pw@example.com')).toBeNull();
    expect(proofUrl('https://user@example.com')).toBeNull();
    expect(proofUrl('https://8.8.8.8')).toBeNull();
    expect(proofUrl('https://[2606:4700:4700::1111]')).toBeNull();
    expect(proofUrl('https://127.0.0.1')).toBeNull();
    expect(proofUrl('https://localhost')).toBeNull();
    expect(proofUrl('https://app.localhost')).toBeNull();
    expect(proofUrl('https://host.docker.internal')).toBeNull();
  });

  it('proofMatches: exact token only (trims; wrong token, prefix, extra text, other session’s token fail)', () => {
    const token = 'abc_DEF-123';
    expect(proofLine(token)).toBe('qa-verify=abc_DEF-123');
    expect(proofMatches('qa-verify=abc_DEF-123', token)).toBe(true);
    expect(proofMatches('  qa-verify=abc_DEF-123\r\n', token)).toBe(true);
    expect(proofMatches('qa-verify=abc_DEF-12', token)).toBe(false);
    expect(proofMatches('qa-verify=abc_DEF-1234', token)).toBe(false);
    expect(proofMatches('qa-verify=abc_DEF-123 extra', token)).toBe(false);
    expect(proofMatches('hello\nqa-verify=abc_DEF-123', token)).toBe(false);
    expect(proofMatches('qa-verify=abc_DEF-123\nqa-verify=other', token)).toBe(false);
    expect(proofMatches('qa-verify=other-session-token', token)).toBe(false);
    expect(proofMatches('', token)).toBe(false);
    expect(proofMatches('qa-verify=', '')).toBe(false);
  });

  it('decideTestCopy truth table', () => {
    const base = { shared: true, textTestHost: false, marked: true, addresses: ['8.8.8.8'], proofOk: true };
    expect(decideTestCopy(base)).toEqual({ testCopy: true, reason: 'verified-marked' });
    expect(decideTestCopy({ ...base, marked: false })).toEqual({ testCopy: false, reason: 'not-marked' });
    expect(decideTestCopy({ ...base, addresses: [] })).toEqual({ testCopy: false, reason: 'dns-failed' });
    expect(decideTestCopy({ ...base, addresses: ['8.8.8.8', '10.0.0.1'] })).toEqual({
      testCopy: false,
      reason: 'bad-address',
    });
    expect(decideTestCopy({ ...base, proofOk: false })).toEqual({ testCopy: false, reason: 'not-verified' });
    // Verified alone is not a test copy; text-only shortcuts do not count on a shared machine.
    expect(decideTestCopy({ ...base, marked: false, proofOk: true }).testCopy).toBe(false);
    expect(decideTestCopy({ ...base, marked: false, textTestHost: true, proofOk: false }).testCopy).toBe(false);
    expect(decideTestCopy({ ...base, textTestHost: true, proofOk: false }).testCopy).toBe(false);
    // Local mode: the text rule or the mark, as before.
    const local = { ...base, shared: false, addresses: [], proofOk: false };
    expect(decideTestCopy({ ...local, textTestHost: true, marked: false })).toEqual({
      testCopy: true,
      reason: 'local',
    });
    expect(decideTestCopy({ ...local, textTestHost: false, marked: true }).testCopy).toBe(true);
    expect(decideTestCopy({ ...local, textTestHost: false, marked: false }).testCopy).toBe(false);
  });

  it('address-class.ts and domain-verification.ts import no Node module (the wizard can share them)', async () => {
    for (const file of ['address-class.ts', 'domain-verification.ts']) {
      const source = await fs.readFile(path.join(__dirname, '..', 'src', file), 'utf8');
      expect(source, file).not.toMatch(/node:|require\(/);
      const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
      // Only the pure address classifier, next door.
      for (const from of imports) expect(from, file).toBe('./address-class.js');
    }
    const first = await fs.readFile(path.join(__dirname, '..', 'src', 'address-class.ts'), 'utf8');
    expect(first).not.toMatch(/^\s*import\s/m);
  });
});
