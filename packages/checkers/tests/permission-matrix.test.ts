import { describe, it, expect } from 'vitest';
import { PermissionMatrixChecker, PermissionMatrixError, validatePermissionMatrix } from '../src/permission-matrix.js';

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

  it('CSV yes/no/True/Allowed-style cells: maps words and rejects unknown values with line and cell', () => {
    const csv = `
target,admin,user,viewer
/test,yes,True,no
`;
    const rules = checker.parseMatrix(csv);
    expect(rules[0].roles.admin).toBe('allow');
    expect(rules[0].roles.user).toBe('allow');
    expect(rules[0].roles.viewer).toBe('deny');

    const badCsv = `
target,admin
/test,Allowed
`;
    expect(() => checker.parseMatrix(badCsv)).toThrowError(PermissionMatrixError);
    try {
      checker.parseMatrix(badCsv);
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionMatrixError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/line 2/i);
      expect(msg).toContain('Allowed');
    }
  });

  it('an empty cell leaves the role out and checkAccess returns undefined for a 200', () => {
    const csv = `
target,admin,viewer
/invoices,allow,
`;
    const c = new PermissionMatrixChecker(csv);
    const rules = c.parseMatrix(csv);
    expect(rules[0].roles.admin).toBe('allow');
    expect(rules[0].roles.viewer).toBeUndefined();

    const finding = c.checkAccess({
      target: '/invoices',
      role: 'viewer',
      statusCode: 200,
    });
    expect(finding).toBeUndefined();
  });

  it('a CSV whose first column has a colon parses as CSV', () => {
    const csv = `
target,admin,viewer
/search?q=a:b,allow,deny
`;
    const rules = checker.parseMatrix(csv);
    expect(rules).toHaveLength(1);
    expect(rules[0].target).toBe('/search?q=a:b');
    expect(rules[0].roles.admin).toBe('allow');
    expect(rules[0].roles.viewer).toBe('deny');
  });

  it('rejects CSV with header having fewer than two columns', () => {
    expect(() => checker.parseMatrix('target')).toThrowError(PermissionMatrixError);
  });

  it('rejects CSV row with more cells than header', () => {
    const badRow = `
target,admin
/test,allow,extra
`;
    expect(() => checker.parseMatrix(badRow)).toThrowError(PermissionMatrixError);
  });

  it('YAML: a rule without roles throws a PermissionMatrixError mentioning rule 1', () => {
    const yamlNoRoles = `
- target: /admin
`;
    expect(() => checker.parseMatrix(yamlNoRoles)).toThrowError(PermissionMatrixError);
    try {
      checker.parseMatrix(yamlNoRoles);
    } catch (err) {
      expect((err as Error).message).toMatch(/rule 1/i);
    }
  });

  it('YAML: bad indent throws starting with "The permission matrix is not valid YAML"', () => {
    const badYaml = `
- target: /admin
   roles:
  admin: allow
`;
    expect(() => checker.parseMatrix(badYaml)).toThrowError(PermissionMatrixError);
    try {
      checker.parseMatrix(badYaml);
    } catch (err) {
      expect((err as Error).message).toMatch(/^The permission matrix is not valid YAML/);
    }
  });

  it('YAML: a good YAML list parses correctly', () => {
    const goodYaml = `
- target: /admin
  roles:
    admin: allow
    viewer: deny
`;
    const rules = checker.parseMatrix(goodYaml);
    expect(rules).toHaveLength(1);
    expect(rules[0].target).toBe('/admin');
    expect(rules[0].roles.admin).toBe('allow');
    expect(rules[0].roles.viewer).toBe('deny');
  });

  it('throws from the constructor when given an object matrix with invalid roles', () => {
    expect(() => new PermissionMatrixChecker([{ target: '/admin', roles: { admin: 'maybe' as any } }])).toThrowError(
      PermissionMatrixError
    );
  });

  it('validatePermissionMatrix validates input shape and normalizes rules', () => {
    expect(() => validatePermissionMatrix('not an array')).toThrowError(PermissionMatrixError);
    expect(() => validatePermissionMatrix([null])).toThrowError(/rule 1/i);
    expect(() => validatePermissionMatrix([{ target: '', roles: {} }])).toThrowError(/rule 1/i);
    expect(() => validatePermissionMatrix([{ target: '/ok', roles: 'invalid' }])).toThrowError(/rule 1/i);

    const validated = validatePermissionMatrix([
      {
        target: '/ok',
        roles: { admin: 'yes', manager: 'true', viewer: '0', guest: 'no' },
      },
    ]);
    expect(validated).toEqual([
      {
        target: '/ok',
        roles: { admin: 'allow', manager: 'allow', viewer: 'deny', guest: 'deny' },
      },
    ]);
  });
});
