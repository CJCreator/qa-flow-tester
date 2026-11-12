import type { Finding, PermissionMatrix, Breakpoint } from '@qa/types';
import YAML from 'yaml';

export class PermissionMatrixError extends Error {}

function normalizePermission(val: unknown): 'allow' | 'deny' | null {
  if (typeof val === 'boolean') {
    if (val) return 'allow';
    return 'deny';
  }
  if (typeof val === 'number') {
    if (val === 1) return 'allow';
    if (val === 0) return 'deny';
    return null;
  }
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s === 'allow' || s === 'yes' || s === 'true' || s === 'y' || s === '1') {
      return 'allow';
    }
    if (s === 'deny' || s === 'no' || s === 'false' || s === 'n' || s === '0') {
      return 'deny';
    }
  }
  return null;
}

export function validatePermissionMatrix(value: unknown): PermissionMatrix {
  if (!Array.isArray(value)) {
    throw new PermissionMatrixError('The permission matrix must be an array');
  }

  const normalized: PermissionMatrix = [];
  for (let i = 0; i < value.length; i++) {
    const ruleNum = i + 1;
    const rule = value[i];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new PermissionMatrixError(`Rule ${ruleNum} is not an object`);
    }

    const target = (rule as Record<string, unknown>).target;
    if (typeof target !== 'string' || target.trim() === '') {
      throw new PermissionMatrixError(`Rule ${ruleNum}: target must be a non-empty string`);
    }

    const roles = (rule as Record<string, unknown>).roles;
    if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
      throw new PermissionMatrixError(`Rule ${ruleNum}: roles must be an object`);
    }

    const normalizedRoles: Record<string, 'allow' | 'deny'> = {};
    for (const [role, rawVal] of Object.entries(roles as Record<string, unknown>)) {
      const norm = normalizePermission(rawVal);
      if (!norm) {
        throw new PermissionMatrixError(`Rule ${ruleNum}: role "${role}" has invalid permission "${rawVal}"`);
      }
      normalizedRoles[role] = norm;
    }

    normalized.push({ target: target.trim(), roles: normalizedRoles });
  }

  return normalized;
}

/** True when `target` is the rule's path or sits under it: "/admin" covers "/admin/users" and "/admin?tab=1", not "/administrator". */
function ruleCovers(ruleTarget: string, target: string): boolean {
  if (target === ruleTarget) return true;
  const base = ruleTarget.endsWith('/') ? ruleTarget : `${ruleTarget}/`;
  return target.startsWith(base) || target.startsWith(`${ruleTarget}?`) || target.startsWith(`${ruleTarget}#`);
}

export class PermissionMatrixChecker {
  private matrix: PermissionMatrix = [];

  constructor(matrixOrYaml?: PermissionMatrix | string) {
    if (matrixOrYaml) {
      if (typeof matrixOrYaml === 'string') {
        this.matrix = this.parseMatrix(matrixOrYaml);
      } else {
        this.matrix = validatePermissionMatrix(matrixOrYaml);
      }
    }
  }

  /**
   * Parse either CSV or YAML permission matrix string
   */
  public parseMatrix(content: string): PermissionMatrix {
    const trimmed = content.trim();
    if (!trimmed) return [];

    const lines = trimmed.split(/\r?\n/).map((l) => l.trim());
    const firstNonBlank = lines.find((l) => l.length > 0) ?? '';
    const isYaml = firstNonBlank.startsWith('-') || firstNonBlank.startsWith('[') || firstNonBlank.startsWith('---');

    if (isYaml) {
      let parsed: unknown;
      try {
        parsed = YAML.parse(trimmed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new PermissionMatrixError('The permission matrix is not valid YAML: ' + message);
      }
      return validatePermissionMatrix(parsed);
    }

    // Parse CSV: header is "target,role1,role2,role3"
    const nonEmptyLines: { lineNum: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) {
        nonEmptyLines.push({ lineNum: i + 1, text: lines[i] });
      }
    }

    if (nonEmptyLines.length === 0) return [];

    const headerLine = nonEmptyLines[0];
    const header = headerLine.text.split(',').map((h) => h.trim());
    if (header.length < 2) {
      throw new PermissionMatrixError(`Line ${headerLine.lineNum}: CSV header must have at least two columns`);
    }

    const targetIdx = 0;
    const roleCols = header.slice(1);

    const rules: PermissionMatrix = [];
    for (let i = 1; i < nonEmptyLines.length; i++) {
      const { lineNum, text } = nonEmptyLines[i];
      const parts = text.split(',').map((p) => p.trim());
      if (parts.length > header.length) {
        throw new PermissionMatrixError(`Line ${lineNum}: row has more cells than header`);
      }

      const target = parts[targetIdx];
      if (!target) {
        throw new PermissionMatrixError(`Line ${lineNum}: target must be a non-empty string`);
      }

      const permissions: Record<string, 'allow' | 'deny'> = {};

      for (let r = 0; r < roleCols.length; r++) {
        const role = roleCols[r];
        if (!role) continue;
        const cell = parts[r + 1];
        if (cell === undefined || cell === '') {
          // Empty cell means "no expectation for this role": leave the role out of roles
          continue;
        }
        const norm = normalizePermission(cell);
        if (!norm) {
          throw new PermissionMatrixError(`Line ${lineNum}: role "${role}" has invalid permission "${cell}"`);
        }
        permissions[role] = norm;
      }

      rules.push({ target, roles: permissions });
    }

    return rules;
  }

  /**
   * Check route or action execution against expected permission
   */
  public checkAccess(params: {
    target: string;
    role: string;
    breakpoint?: Breakpoint;
    statusCode: number;
    redirectedToLogin?: boolean;
    testCaseId?: string;
  }): Finding | undefined {
    const { target, role, breakpoint = '1440px', statusCode, redirectedToLogin, testCaseId } = params;

    // Find rule for this target: an exact match first, then the longest rule whose path it sits under
    // (so "/invoices/new" is not answered by the "/invoices" rule when it has a rule of its own, and
    // "/administrator" is not answered by the "/admin" rule).
    const rule =
      this.matrix.find((r) => r.target === target) ??
      this.matrix.filter((r) => ruleCovers(r.target, target)).sort((a, b) => b.target.length - a.target.length)[0];
    if (!rule) return undefined;

    const expected = rule.roles[role];
    if (!expected) return undefined;

    const isAccessGranted = statusCode >= 200 && statusCode < 300 && !redirectedToLogin;
    const isAccessDenied = statusCode === 401 || statusCode === 403 || redirectedToLogin;

    // 1. Permission Leak: matrix says deny, but user got 200 OK access
    if (expected === 'deny' && isAccessGranted) {
      return {
        id: `F-PERM-LEAK-${role}-${target.replace(/[^a-zA-Z0-9]/g, '_')}`,
        testCaseId,
        severity: 'Blocker',
        checker: 'permission-matrix',
        title: `Permission Leak: Role "${role}" can access restricted route "${target}"`,
        where: {
          urlPath: target,
          role,
          breakpoint,
        },
        expectedVsActual: {
          expected: `Permission matrix specifies DENY for role "${role}" on "${target}"`,
          actual: `Server returned HTTP ${statusCode} (access allowed)`,
        },
        stepsToReproduce: [
          `Authenticate as role: ${role}`,
          `Navigate directly to ${target}`,
          `Observe page rendered with HTTP ${statusCode}`,
        ],
        evidence: {},
        resolution: `Role "${role}" can open "${target}"; permission matrix says deny. Add a server-side authorization check to this route.`,
      };
    }

    // 2. Over-restriction: matrix says allow, but user received 401/403 or unauthorized redirect
    if (expected === 'allow' && isAccessDenied) {
      return {
        id: `F-PERM-RESTRICT-${role}-${target.replace(/[^a-zA-Z0-9]/g, '_')}`,
        testCaseId,
        severity: 'Major',
        checker: 'permission-matrix',
        title: `Over-restriction: Role "${role}" is blocked from authorized route "${target}"`,
        where: {
          urlPath: target,
          role,
          breakpoint,
        },
        expectedVsActual: {
          expected: `Permission matrix specifies ALLOW for role "${role}" on "${target}"`,
          actual: `Server returned HTTP ${statusCode} (access denied or redirected to login)`,
        },
        stepsToReproduce: [
          `Authenticate as role: ${role}`,
          `Navigate to ${target}`,
          `Observe request was rejected with HTTP ${statusCode}`,
        ],
        evidence: {},
        resolution: `Role "${role}" should have access to "${target}". Verify role authorization mappings in the backend.`,
      };
    }

    return undefined;
  }
}
