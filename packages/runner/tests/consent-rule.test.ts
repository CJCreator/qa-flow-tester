/** The consent rule (ADR 0022) as a truth table. */
import { describe, it, expect } from 'vitest';
import { resolveReadOnly } from '../src/server.js';

const good = [{ username: 'a@b.test', password: 'pw' }];
const base = { beta: false, owner: true, testHost: false, signInConsent: true as unknown, roles: good };

describe('resolveReadOnly', () => {
  it('consent + owner + good details: full testing', () => {
    expect(resolveReadOnly(base)).toEqual({ consent: true, readOnly: false });
  });
  it('a shared machine (beta) ignores consent', () => {
    expect(resolveReadOnly({ ...base, beta: true })).toEqual({ consent: false, readOnly: true });
  });
  it('no consent flag stays read-only', () => {
    expect(resolveReadOnly({ ...base, signInConsent: undefined })).toEqual({ consent: false, readOnly: true });
    expect(resolveReadOnly({ ...base, signInConsent: false })).toEqual({ consent: false, readOnly: true });
    expect(resolveReadOnly({ ...base, signInConsent: 'true' })).toEqual({ consent: false, readOnly: true });
  });
  it('missing password or username or roles is not consent', () => {
    expect(resolveReadOnly({ ...base, roles: [{ username: 'a@b.test', password: '' }] }).readOnly).toBe(true);
    expect(resolveReadOnly({ ...base, roles: [{ username: '', password: 'pw' }] }).readOnly).toBe(true);
    expect(resolveReadOnly({ ...base, roles: [] }).readOnly).toBe(true);
    expect(resolveReadOnly({ ...base, roles: undefined }).readOnly).toBe(true);
  });
  it('one complete role among incomplete ones is enough', () => {
    expect(resolveReadOnly({ ...base, roles: [{ username: 'x' }, ...good] }).consent).toBe(true);
  });
  it('not the owner: read-only even with consent or a test host', () => {
    expect(resolveReadOnly({ ...base, owner: false })).toEqual({ consent: true, readOnly: true });
    expect(resolveReadOnly({ ...base, owner: false, testHost: true }).readOnly).toBe(true);
  });
  it('test host: full testing without consent', () => {
    expect(resolveReadOnly({ ...base, testHost: true, signInConsent: undefined, roles: [] })).toEqual({
      consent: false,
      readOnly: false,
    });
  });
  it('beta with a test host still tests fully; beta without is read-only', () => {
    expect(resolveReadOnly({ ...base, beta: true, testHost: true }).readOnly).toBe(false);
    expect(resolveReadOnly({ ...base, beta: true, testHost: false }).readOnly).toBe(true);
  });
});
