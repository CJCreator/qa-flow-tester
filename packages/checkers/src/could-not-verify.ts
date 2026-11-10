import type { Breakpoint, Finding } from '@qa/types';

/**
 * A check that could not run is reported as "Could not verify", never as passed. It is a guess-level
 * finding (`needsConfirmation`), so it never counts as a defect or in the grades.
 */
export function couldNotVerifyFinding(
  checker: 'performance' | 'seo' | 'ux-quality' | 'design-standards' | 'security',
  what: string,
  context: { testCaseId?: string; flowId?: string; role: string; breakpoint: Breakpoint; urlPath: string },
  categoryTag?: Finding['categoryTag']
): Finding {
  return {
    id: `F-UNVERIFIED-${checker}-${categoryTag ?? 'GEN'}-${context.testCaseId || 'GEN'}`,
    testCaseId: context.testCaseId,
    flowId: context.flowId,
    severity: 'Suggestion',
    checker,
    title: `Could not verify: ${what}`,
    where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
    expectedVsActual: { expected: `${what} is checked`, actual: 'The check could not run on this page' },
    stepsToReproduce: [`Open ${context.urlPath}`],
    evidence: {},
    resolution: 'Run the Check-up again. If it keeps happening, the page may block the check.',
    needsConfirmation: true,
    ...(categoryTag ? { categoryTag } : {}),
  };
}
