import { describe, it, expect } from 'vitest';
import { PermissionMatrixChecker } from '../src/permission-matrix.js';

describe('PermissionMatrixChecker', () => {
  const csvMatrix = `
target,admin,manager,member,viewer
/invoices,allow,allow,allow,allow
/invoices/new,allow,allow,deny,deny
/settings/billing,allow,deny,deny,deny
`;

  const checker = new PermissionMatrixChecker(csvMatrix);

  it('correctly parses CSV permission matrix', () => {
    const rules = checker.parseMatrix(csvMatrix);
    expect(rules).toHaveLength(3);
    expect(rules[0].target).toBe('/invoices');
    expect(rules[0].roles.viewer).toBe('allow');
    expect(rules[1].target).toBe('/invoices/new');
    expect(rules[1].roles.viewer).toBe('deny');
  });

  it('detects permission leak when restricted role accesses forbidden route', () => {
    const finding = checker.checkAccess({
      target: '/settings/billing',
      role: 'viewer',
      statusCode: 200,
      testCaseId: 'TC-PERM-01',
    });

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('Blocker');
    expect(finding?.checker).toBe('permission-matrix');
    expect(finding?.title).toContain('Permission Leak: Role "viewer" can access restricted route "/settings/billing"');
    expect(finding?.resolution).toContain('Add a server-side authorization check to this route');
  });

  it('detects over-restriction when permitted role receives 403 Forbidden', () => {
    const finding = checker.checkAccess({
      target: '/invoices',
      role: 'manager',
      statusCode: 403,
      testCaseId: 'TC-PERM-02',
    });

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('Major');
    expect(finding?.checker).toBe('permission-matrix');
    expect(finding?.title).toContain('Over-restriction: Role "manager" is blocked');
  });

  it('a rule covers its own path and what sits under it, not a path that only shares its first letters', () => {
    const m = new PermissionMatrixChecker(`
target,admin,member
/admin,allow,deny
`);
    // Under the rule: member is denied, so a 200 is a leak.
    expect(m.checkAccess({ target: '/admin/users', role: 'member', statusCode: 200 })).toBeDefined();
    expect(m.checkAccess({ target: '/admin?tab=1', role: 'member', statusCode: 200 })).toBeDefined();
    // Not under the rule: no rule applies, so nothing is reported.
    expect(m.checkAccess({ target: '/administrator', role: 'member', statusCode: 200 })).toBeUndefined();
    expect(m.checkAccess({ target: '/admin-help', role: 'member', statusCode: 200 })).toBeUndefined();
  });

  it('the longer rule wins over the shorter one', () => {
    // /invoices allows member, /invoices/new denies member (see csvMatrix above).
    expect(checker.checkAccess({ target: '/invoices/new', role: 'member', statusCode: 200 })).toBeDefined();
    expect(checker.checkAccess({ target: '/invoices/new/step-2', role: 'member', statusCode: 200 })).toBeDefined();
    expect(checker.checkAccess({ target: '/invoices/42', role: 'member', statusCode: 200 })).toBeUndefined();
  });

  it('returns undefined when permissions match expected behavior', () => {
    const allowFinding = checker.checkAccess({
      target: '/invoices',
      role: 'admin',
      statusCode: 200,
    });
    expect(allowFinding).toBeUndefined();

    const denyFinding = checker.checkAccess({
      target: '/settings/billing',
      role: 'viewer',
      statusCode: 403,
    });
    expect(denyFinding).toBeUndefined();
  });
});
