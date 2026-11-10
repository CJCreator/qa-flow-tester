import { describe, it, expect } from 'vitest';
import { versionQuery } from '../src/routes/audit-common.js';

const at = (query: string) => new URL(`http://localhost/api/audits/audit_00001${query}`);

describe('versionQuery', () => {
  it('is undefined without a version', () => {
    expect(versionQuery(at(''))).toBeUndefined();
  });
  it('reads a whole number from 1', () => {
    expect(versionQuery(at('?version=1'))).toBe(1);
    expect(versionQuery(at('?version=1234567'))).toBe(1234567);
  });
  it("is 'invalid' for anything else", () => {
    for (const bad of ['0', '01', '-1', '1.5', 'abc', '', '12345678']) {
      expect(versionQuery(at(`?version=${bad}`)), bad).toBe('invalid');
    }
  });
});
