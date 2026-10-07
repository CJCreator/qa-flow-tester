import type { ReferenceFlow, FrictionScorecard, CompetitiveBenchmark, UXRecommendation } from '@qa/types';

export class BenchmarkingEngine {
  /**
   * Computes a quantitative Friction Scorecard for a given flow.
   */
  calculateScorecard(flow: ReferenceFlow): FrictionScorecard {
    const totalSteps = Math.max(1, flow.steps.length);
    let totalFields = 0;
    let requiredFieldsCount = 0;

    for (const step of flow.steps) {
      totalFields += step.fieldsCount;
      requiredFieldsCount += step.requiredFieldsCount;
    }

    const clickDepth = Math.max(0, totalSteps - 1);

    // Friction Index formula:
    // (steps * 2.0) + (required fields * 2.5) + (total fields * 1.0) + (clickDepth * 0.5)
    const rawFriction = totalSteps * 2.0 + requiredFieldsCount * 2.5 + totalFields * 1.0 + clickDepth * 0.5;
    const frictionIndex = Math.round(rawFriction * 10) / 10;

    return {
      totalSteps,
      totalFields,
      requiredFieldsCount,
      clickDepth,
      frictionIndex,
    };
  }

  /**
   * Compares an internal flow against an external reference flow.
   */
  compareFlows(
    flowId: string,
    ourFlow: ReferenceFlow,
    refFlow: ReferenceFlow,
    recommendations: UXRecommendation[] = []
  ): CompetitiveBenchmark {
    const ourScorecard = this.calculateScorecard(ourFlow);
    const refScorecard = this.calculateScorecard(refFlow);

    const stepDifference = ourScorecard.totalSteps - refScorecard.totalSteps;
    const fieldDifference = ourScorecard.totalFields - refScorecard.totalFields;
    const frictionRatio =
      refScorecard.frictionIndex > 0
        ? Math.round((ourScorecard.frictionIndex / refScorecard.frictionIndex) * 100) / 100
        : 1.0;

    // Collect pattern presence
    const allOurControls = new Set(ourFlow.steps.flatMap((s) => s.interactiveControlsFound));
    const allRefControls = new Set(refFlow.steps.flatMap((s) => s.interactiveControlsFound));

    const candidatePatterns = [
      { id: 'google-sso', label: 'One-Click Google SSO' },
      { id: 'github-sso', label: 'GitHub Social Sign-In' },
      { id: 'pricing-frequency-tabs', label: 'Annual/Monthly Billing Toggle' },
      { id: 'expandable-accordion', label: 'Expandable FAQ Accordions' },
    ];

    const patterns = candidatePatterns.map((cp) => ({
      pattern: cp.label,
      ourProduct: allOurControls.has(cp.id),
      referenceProduct: allRefControls.has(cp.id),
    }));

    return {
      id: `bench_${Date.now()}`,
      flowId,
      ourProduct: {
        url: ourFlow.entryUrl,
        name: ourFlow.name,
        scorecard: ourScorecard,
        screenshots: ourFlow.steps.map((s) => s.screenshotPath || '').filter(Boolean),
      },
      referenceProduct: {
        url: refFlow.entryUrl,
        name: refFlow.name,
        scorecard: refScorecard,
        screenshots: refFlow.steps.map((s) => s.screenshotPath || '').filter(Boolean),
      },
      delta: {
        stepDifference,
        fieldDifference,
        frictionRatio,
      },
      patterns,
      recommendations,
      createdAt: new Date().toISOString(),
    };
  }
}
