import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAuditErrorCode, NOT_ANSWERING } from '../src/screens/audit/audit-call';

const AUDIT = resolve(__dirname, '../src/screens/audit');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('shared Website Audit API helpers', () => {
  it('knows a runner code from other text', () => {
    expect(isAuditErrorCode('ERR_AUDIT_NOT_FOUND')).toBe(true);
    expect(isAuditErrorCode('nope')).toBe(false);
    expect(isAuditErrorCode(404)).toBe(false);
  });
  it('does not mention a terminal: the hosted copy has none', () => {
    expect(NOT_ANSWERING).toMatch(/not answering/);
    expect(NOT_ANSWERING).not.toMatch(/terminal/);
  });
  it('is declared once', () => {
    const declaring = files(AUDIT).filter((f) => /const NOT_ANSWERING\s*=/.test(readFileSync(f, 'utf8')));
    expect(declaring.map((f) => f.replace(/\\/g, '/').split('/screens/audit/')[1])).toEqual(['audit-call.ts']);
    const checks = files(AUDIT).filter((f) => /function isAuditErrorCode/.test(readFileSync(f, 'utf8')));
    expect(checks).toHaveLength(1);
  });
});
