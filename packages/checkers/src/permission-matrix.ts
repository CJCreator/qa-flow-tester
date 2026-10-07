import type { Finding, PermissionMatrix, PermissionRule, Breakpoint } from '@qa/types';
import YAML from 'yaml';

export class PermissionMatrixChecker {
  private matrix: PermissionMatrix = [];

  constructor(matrixOrYaml?: PermissionMatrix | string) {
    if (matrixOrYaml) {
      if (typeof matrixOrYaml === 'string') {
        this.matrix = this.parseMatrix(matrixOrYaml);
      } else {
        this.matrix = matrixOrYaml;
      }
    }
  }

  /**
   * Parse either CSV or YAML permission matrix string
   */
  public parseMatrix(content: string): PermissionMatrix {
    const trimmed = content.trim();
    if (trimmed.startsWith('-') || trimmed.includes(':')) {
      // Parse YAML
      const parsed = YAML.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed as PermissionMatrix;
      }
    }

    // Parse CSV: header is "target,role1,role2,role3"
    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map((h) => h.trim());
    const targetIdx = 0;
    const roleCols = header.slice(1);

    const rules: PermissionMatrix = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p) => p.trim());
      const target = parts[targetIdx];
      const permissions: Record<string, 'allow' | 'deny'> = {};

      for (let r = 0; r < roleCols.length; r++) {
        const role = roleCols[r];
        const val = parts[r + 1]?.toLowerCase() === 'allow' ? 'allow' : 'deny';
        permissions[role] = val;
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

    // Find rule for this target (exact match or prefix)
    const rule = this.matrix.find((r) => r.target === target || target.startsWith(r.target));
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

  /**
   * Check direct URL access where a link is hidden in UI navigation but accessible via direct URL navigation
   */
  public checkDirectUrlExposure(params: {
    target: string;
    role: string;
    isNavVisible: boolean;
    isReachable: boolean;
    breakpoint?: Breakpoint;
    testCaseId?: string;
  }): Finding | undefined {
    const { target, role, isNavVisible, isReachable, breakpoint = '1440px', testCaseId } = params;

    const rule = this.matrix.find((r) => r.target === target);
    if (!rule) return undefined;

    const expected = rule.roles[role];
    // If permission says deny, checkAccess handles leak.
    // If not in nav, but reachable directly when denied or unconfigured:
    if (expected === 'deny' && isReachable && !isNavVisible) {
      return {
        id: `F-DIRECT-URL-${role}-${target.replace(/[^a-zA-Z0-9]/g, '_')}`,
        testCaseId,
        severity: 'Blocker',
        checker: 'permission-matrix',
        title: `Direct URL Access: Hidden route "${target}" accessible directly by "${role}"`,
        where: {
          urlPath: target,
          role,
          breakpoint,
        },
        expectedVsActual: {
          expected: `Route "${target}" should be denied and inaccessible for "${role}"`,
          actual: `Route is hidden from navigation bar but accessible via direct URL address bar`,
        },
        stepsToReproduce: [
          `Log in as "${role}"`,
          `Observe "${target}" is not present in navigation menus`,
          `Type "${target}" directly in browser URL bar`,
          `Observe page loads successfully`,
        ],
        evidence: {},
        resolution: `Ensure backend middleware rejects unauthorized requests rather than relying on frontend navigation hiding (security through obscurity).`,
      };
    }

    return undefined;
  }
}
