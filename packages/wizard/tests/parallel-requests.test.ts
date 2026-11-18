import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, parallelRolesOf } from '../src/lib/form';

describe('parallelRolesOf', () => {
  it('is not sent when the target is not a Test Copy', () => {
    expect(parallelRolesOf({ ...EMPTY_FORM, parallelRoles: 6 }, false)).toBeUndefined();
  });

  it('is not sent at the default of 1', () => {
    expect(parallelRolesOf(EMPTY_FORM, true)).toBeUndefined();
  });

  it('is sent on a Test Copy and capped at 10', () => {
    expect(parallelRolesOf({ ...EMPTY_FORM, parallelRoles: 4 }, true)).toBe(4);
    expect(parallelRolesOf({ ...EMPTY_FORM, parallelRoles: 50 }, true)).toBe(10);
  });
});
