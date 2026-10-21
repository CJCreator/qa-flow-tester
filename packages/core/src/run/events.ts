import type { Breakpoint, Finding, ReleaseReport } from '@qa/types';

export type OrchestratorEvent =
  | {
      type: 'RUN_STARTED';
      runId: string;
      targetUrl: string;
      productId: string;
      testCaseCount: number;
      /** 'safe-public' for a read-only website scan; absent for a full product run. */
      mode?: 'safe-public';
    }
  | { type: 'PREFLIGHT_STARTED'; roles: string[] }
  | {
      type: 'TEST_POINT_STARTED';
      testCaseId: string;
      testCaseName: string;
      role: string;
      breakpoint: Breakpoint;
      /** 0-based position among all test points in this run. */
      index: number;
      total: number;
      /** The page the test point opens first. */
      startPage?: string;
      /** The journey it belongs to ('page-sweep' for a page visit). */
      flowId?: string;
    }
  | { type: 'STEP_STARTED'; stepIndex: number; stepName: string; action: string; target?: string; testCaseId: string }
  | {
      type: 'STEP_COMPLETED';
      stepIndex: number;
      passed: boolean;
      durationMs: number;
      error?: string;
      screenshotUrl?: string;
      /** The page the browser is on after the step. */
      urlPath?: string;
      testCaseId?: string;
    }
  | {
      type: 'FINDINGS_UPDATED';
      totalFindings: number;
      /** The issues this test point found, so a live view can pin them to their page. */
      latest?: Array<{
        id: string;
        title: string;
        severity: Finding['severity'];
        checker: Finding['checker'];
        urlPath: string;
        breakpoint: Breakpoint;
      }>;
    }
  | { type: 'RUN_COMPLETED'; runId: string; report: ReleaseReport }
  /**
   * Emitted after discovery completes in a run that pauses for review (i.e. skipReview was not
   * true). The wizard can open /api/runner/plan and show the map. Testing will not start until
   * POST /api/runner/plan/approve arrives.
   */
  | {
      type: 'PLAN_READY';
      runId: string;
      pageCount: number;
      flowCount: number;
      questionCount: number;
      timestamp: number;
    }
  /**
   * Emitted when the user approves (or skipReview bypasses) the plan and the runner moves from
   * awaiting-review into the testing phase.
   */
  | { type: 'TESTING_STARTED'; runId: string; testCaseCount: number; timestamp: number };
