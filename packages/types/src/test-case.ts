import type { DocSource } from './plan.js';

export type FindingSeverity ='Blocker' | 'Major' | 'Minor' | 'Suggestion';

export type CheckerType =
  | 'bug-detection'
  | 'spec-conformance'
  | 'design-standards'
  | 'ux-quality'
  | 'permission-matrix'
  | 'security'
  | 'performance'
  | 'seo'
  | 'ai-review';

export type TriageStatus = 'Pending' | 'Confirmed' | 'Intended' | 'False Positive' | 'Resolved';

export type Breakpoint = '375px' | '768px' | '1440px';

export type TestPointStatus = 'Passed' | 'Failed' | 'Blocked' | 'Skipped' | 'Could not verify';

export interface TestCaseStep {
  /** 'check-link' fetches `value` (a link's address) once and fails only if the link is broken; nothing is clicked. */
  action: 'click' | 'fill' | 'select' | 'check' | 'navigate' | 'wait' | 'check-link';
  selector?: string; // e.g. "[data-testid=new-invoice-btn]"
  value?: string;
  name: string;
  /**
   * A step that may not be possible, e.g. a button that only shows on wide screens. If it can't
   * be done it is recorded as skipped, not as a failure, and the next steps still run.
   */
  optional?: boolean;
  /** Only done at these screen sizes, e.g. opening the menu that narrow screens hide their links behind. */
  onlyAt?: Breakpoint[];
}

/**
 * Where an expectation or rule came from. Only 'observed' and 'user' ones can fail a site; an
 * 'ai-guess' that doesn't match is reported as "Could not verify" until someone confirms it.
 * Absent means 'user' (hand-written spec files).
 */
export type RuleOrigin = 'observed' | 'ai-guess' | 'user';

export interface TestCaseExpectations {
  origin?: RuleOrigin;
  /**
   * Behaviour check for a guessed validation rule: after the steps, an error message or an
   * invalid-field marker should appear. The exact wording isn't checked.
   */
  validationError?: {
    field: string;
    selector?: string;
    description?: string;
  };
  url?: {
    pattern: string;
    description?: string;
  };
  text?: {
    contains?: string;
    notContains?: string;
    description?: string;
  };
  apiCall?: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    status: number;
  };
  elementState?: {
    selector: string;
    visible?: boolean;
    disabled?: boolean;
    description?: string;
  };
  /** After the steps, the page is no longer `fromPath`, e.g. a form led to a confirmation page. */
  navigatesAway?: { fromPath: string; description?: string };
  /** After the steps, a success message shows on the page and no error does. */
  successMessage?: { description?: string };
  /** After the steps, the page opened and works: no error status, not blank, not a "not found" page. */
  pageWorks?: { description?: string };
}

export interface ValidationRule {
  field: string;
  selector?: string;
  min?: number;
  max?: number;
  pattern?: string;
  expectedError: string;
  origin?: RuleOrigin;
}

export interface TestCase {
  id: string; // e.g., "TC-001"
  requirementId?: string; // e.g., "REQ-INV-01"
  flowId: string; // e.g., "create-invoice"
  name?: string;
  role: string; // e.g., "manager", "admin", "viewer"
  startPage: string; // e.g., "/invoices"
  steps: TestCaseStep[];
  expectations: TestCaseExpectations;
  validationRules?: ValidationRule[];
  edgeCases?: {
    testBackButton?: boolean;
    testRefresh?: boolean;
    testEmptyInputs?: boolean;
  };
  /**
   * The kind of Plan Item this test runs. It decides which checkers run afterwards: a page visit or
   * a journey gets them all; a test on a page gets the ones about what it did (errors, what it
   * expected, accessibility of the state it left); a Navigation Check gets errors and whether it
   * landed; a link check only its own result. Absent means all of them, as for hand-written specs.
   */
  kind?: 'page' | 'page-test' | 'navigation' | 'link' | 'journey';
  /** Only run at these screen sizes. Absent means every size the run uses. */
  breakpoints?: Breakpoint[];
  /** The Plan Item this test runs, so a report can be matched back to the plan. */
  planItemId?: string;
  /** The document section this test came from (ADR 0020). A mismatch is then reported against it. */
  docSource?: DocSource;
  /** Severity the person chose for a mismatch with the Source. */
  docSeverity?: FindingSeverity;
  /** The person said the document is out of date: a mismatch is "Could not verify". */
  docStale?: boolean;
}

export interface SpecFile {
  version?: string;
  product?: string;
  testCases: TestCase[];
}
