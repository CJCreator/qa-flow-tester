import type { ReferenceFlow, FrictionScorecard, UXRecommendation } from '@qa/types';
import type { AIProvider } from '../ai/ai-provider.js';

export class UXGapSynthesizer {
  /**
   * Synthesizes actionable UX recommendations and gap analysis
   * based on friction scorecards and pattern differences.
   */
  async synthesize(
    ourFlow: ReferenceFlow,
    refFlow: ReferenceFlow,
    ourScore: FrictionScorecard,
    refScore: FrictionScorecard,
    aiProvider?: AIProvider
  ): Promise<UXRecommendation[]> {
    const recommendations: UXRecommendation[] = [];
    let counter = 1;

    // 1. Heuristic Gap Analysis
    // Gap: Required field overload
    if (ourScore.requiredFieldsCount > refScore.requiredFieldsCount) {
      recommendations.push({
        id: `REC-${counter++}`,
        category: 'Quick Win',
        title: 'Reduce mandatory form inputs on entry',
        effort: 'Low',
        impact: 'High',
        rationale: `Our flow demands ${ourScore.requiredFieldsCount} required inputs compared to ${refScore.requiredFieldsCount} on ${refFlow.name}. Extra fields increase drop-off rates on mobile viewports.`,
        suggestedAction: 'Defer optional fields (e.g. phone number, company size) to post-onboarding profile settings.',
      });
    }

    // Gap: Step count / Multi-page navigation friction
    if (ourScore.totalSteps > refScore.totalSteps) {
      recommendations.push({
        id: `REC-${counter++}`,
        category: 'Strategic Investment',
        title: 'Adopt progressive disclosure inline flow',
        effort: 'Medium',
        impact: 'High',
        rationale: `Competitor achieves the flow goal in ${refScore.totalSteps} steps while our product requires ${ourScore.totalSteps} discrete pages.`,
        suggestedAction: 'Consolidate steps into an inline accordion or single-page wizard with instant validation.',
      });
    }

    // Gap: SSO availability
    const ourHasGoogleSSO = ourFlow.steps.some((s) => s.interactiveControlsFound.includes('google-sso'));
    const refHasGoogleSSO = refFlow.steps.some((s) => s.interactiveControlsFound.includes('google-sso'));
    if (!ourHasGoogleSSO && refHasGoogleSSO) {
      recommendations.push({
        id: `REC-${counter++}`,
        category: 'Quick Win',
        title: 'Implement One-Click Google Social Sign-In',
        effort: 'Low',
        impact: 'High',
        rationale:
          'Reference site offers one-click social authentication, eliminating manual email verification and password typing.',
        suggestedAction: 'Integrate Google Identity Services button on initial registration screen.',
      });
    }

    // Gap: Pricing frequency toggle
    const ourHasPricingToggle = ourFlow.steps.some((s) =>
      s.interactiveControlsFound.includes('pricing-frequency-tabs')
    );
    const refHasPricingToggle = refFlow.steps.some((s) =>
      s.interactiveControlsFound.includes('pricing-frequency-tabs')
    );
    if (!ourHasPricingToggle && refHasPricingToggle) {
      recommendations.push({
        id: `REC-${counter++}`,
        category: 'UX Polish',
        title: 'Add interactive Annual vs Monthly billing switch',
        effort: 'Low',
        impact: 'Medium',
        rationale:
          'Competitor highlights annual savings via an interactive switch, increasing annual contract conversions.',
        suggestedAction: 'Add a pill toggle between monthly and annual prices with a "Save 20%" badge.',
      });
    }

    // 2. If an AI provider is active and not mock, run LLM synthesis
    if (aiProvider && aiProvider.constructor.name !== 'MockAIProvider') {
      try {
        const prompt = `You are a Principal Product Designer & UX Researcher.
Compare our product flow with a competitor's reference flow:

Our Product (${ourFlow.name}):
- Steps: ${ourScore.totalSteps}
- Fields: ${ourScore.totalFields} (${ourScore.requiredFieldsCount} required)
- Friction Index: ${ourScore.frictionIndex}

Reference Competitor (${refFlow.name}):
- Steps: ${refScore.totalSteps}
- Fields: ${refScore.totalFields} (${refScore.requiredFieldsCount} required)
- Friction Index: ${refScore.frictionIndex}

Generate 2 strategic UX improvements as JSON:
[
  {
    "category": "Quick Win" | "Strategic Investment" | "UX Polish",
    "title": "Title",
    "effort": "Low" | "Medium" | "High",
    "impact": "Low" | "Medium" | "High",
    "rationale": "Why this matters",
    "suggestedAction": "Concrete design/code change"
  }
]`;

        const textResponse = await aiProvider.generateText([
          { role: 'system', content: 'You are an expert UX researcher. Return only valid JSON array.' },
          { role: 'user', content: prompt },
        ]);

        const parsed = JSON.parse(
          textResponse
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim()
        );

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            recommendations.push({
              id: `REC-${counter++}`,
              category: item.category || 'UX Polish',
              title: item.title,
              effort: item.effort || 'Medium',
              impact: item.impact || 'High',
              rationale: item.rationale,
              suggestedAction: item.suggestedAction,
            });
          }
        }
      } catch {
        // Fallback to heuristic recommendations
      }
    }

    return recommendations;
  }
}
