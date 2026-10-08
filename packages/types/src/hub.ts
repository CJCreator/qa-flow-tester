export interface RetryTelemetryEntry {
  flowId: string;
  testCaseId: string;
  failedStepIndex: number;
  retryCount: number;
  status: 'FLAKY_PASSED' | 'FAILED';
  errorMessage?: string;
}

export interface DesignTokens {
  colors?: Record<string, string>;
  spacing?: Record<string, string>;
  fontSize?: Record<string, string>;
  borderRadius?: Record<string, string>;
  fontFamily?: Record<string, string>;
}

export interface DesignTokenBaseline {
  version: string;
  productId: string;
  updatedAt: string;
  tokens: DesignTokens;
}

export interface AccountPoolConfig {
  [role: string]: Array<{
    username: string;
    password?: string;
    token?: string;
  }>;
}

// --- Phase 4: Competitive & Reference Public Flow Analysis Types ---

export interface ReferenceFlowStep {
  stepIndex: number;
  action: string;
  url: string;
  title?: string;
  screenshotPath?: string;
  interactiveControlsFound: string[];
  fieldsCount: number;
  requiredFieldsCount: number;
}

export interface ReferenceFlow {
  id: string;
  targetDomain: string;
  entryUrl: string;
  name: string;
  steps: ReferenceFlowStep[];
  timestamp: string;
}

export interface FrictionScorecard {
  totalSteps: number;
  totalFields: number;
  requiredFieldsCount: number;
  clickDepth: number;
  frictionIndex: number;
}

export interface InteractivePattern {
  name: string;
  category: 'auth' | 'pricing' | 'form' | 'trust';
  present: boolean;
  description: string;
}

export interface UXRecommendation {
  id: string;
  category: 'Quick Win' | 'Strategic Investment' | 'UX Polish';
  title: string;
  effort: 'Low' | 'Medium' | 'High';
  impact: 'Low' | 'Medium' | 'High';
  rationale: string;
  suggestedAction: string;
}

export interface CompetitiveBenchmark {
  id: string;
  flowId: string;
  ourProduct: {
    url: string;
    name: string;
    scorecard: FrictionScorecard;
    screenshots: string[];
  };
  referenceProduct: {
    url: string;
    name: string;
    scorecard: FrictionScorecard;
    screenshots: string[];
  };
  delta: {
    stepDifference: number;
    fieldDifference: number;
    frictionRatio: number;
  };
  patterns: Array<{
    pattern: string;
    ourProduct: boolean;
    referenceProduct: boolean;
  }>;
  recommendations: UXRecommendation[];
  createdAt: string;
}

/** One comparison of two sites: running, or finished and kept. */
export interface BenchmarkJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  /** What it is doing now, in plain words. */
  stage: string;
  flowType: string;
  ourUrl: string;
  refUrl: string;
  startedAt: string;
  /** True when an AI wrote some of the improvement ideas; false when fixed rules did. */
  aiUsed?: boolean;
  error?: string;
  result?: CompetitiveBenchmark;
}
