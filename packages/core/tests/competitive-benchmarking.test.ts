import { describe, it, expect } from 'vitest';
import { BenchmarkingEngine } from '../src/competitive/benchmarking-engine.js';
import { UXGapSynthesizer } from '../src/competitive/ux-gap-synthesizer.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import type { ReferenceFlow } from '@qa/types';

describe('Competitive & Reference Flow Benchmarking', () => {
  const ourFlow: ReferenceFlow = {
    id: 'our-onboarding',
    targetDomain: 'internal.local',
    entryUrl: 'http://localhost:3000/signup',
    name: 'Our Onboarding',
    steps: [
      {
        stepIndex: 1,
        action: 'Fill registration form',
        url: 'http://localhost:3000/signup',
        interactiveControlsFound: [],
        fieldsCount: 5,
        requiredFieldsCount: 4,
      },
      {
        stepIndex: 2,
        action: 'Verify email page',
        url: 'http://localhost:3000/verify',
        interactiveControlsFound: [],
        fieldsCount: 1,
        requiredFieldsCount: 1,
      },
      {
        stepIndex: 3,
        action: 'Set company profile',
        url: 'http://localhost:3000/setup',
        interactiveControlsFound: [],
        fieldsCount: 3,
        requiredFieldsCount: 2,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  const competitorFlow: ReferenceFlow = {
    id: 'competitor-onboarding',
    targetDomain: 'competitor.com',
    entryUrl: 'https://competitor.com/signup',
    name: 'Competitor Seamless Signup',
    steps: [
      {
        stepIndex: 1,
        action: 'Single-screen signup with social auth',
        url: 'https://competitor.com/signup',
        interactiveControlsFound: ['google-sso', 'pricing-frequency-tabs'],
        fieldsCount: 2,
        requiredFieldsCount: 1,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  describe('BenchmarkingEngine', () => {
    const engine = new BenchmarkingEngine();

    it('calculates friction scorecards accurately', () => {
      const ourScorecard = engine.calculateScorecard(ourFlow);
      expect(ourScorecard.totalSteps).toBe(3);
      expect(ourScorecard.totalFields).toBe(9);
      expect(ourScorecard.requiredFieldsCount).toBe(7);
      expect(ourScorecard.clickDepth).toBe(2);
      expect(ourScorecard.frictionIndex).toBeGreaterThan(20);

      const compScorecard = engine.calculateScorecard(competitorFlow);
      expect(compScorecard.totalSteps).toBe(1);
      expect(compScorecard.totalFields).toBe(2);
      expect(compScorecard.requiredFieldsCount).toBe(1);
      expect(compScorecard.clickDepth).toBe(0);
      expect(compScorecard.frictionIndex).toBeLessThan(ourScorecard.frictionIndex);
    });

    it('generates comparative benchmark with deltas and pattern comparisons', () => {
      const benchmark = engine.compareFlows('onboarding-benchmark', ourFlow, competitorFlow);
      expect(benchmark.delta.stepDifference).toBe(2);
      expect(benchmark.delta.fieldDifference).toBe(7);
      expect(benchmark.delta.frictionRatio).toBeGreaterThan(1.0);

      // Verify pattern matching
      const googleSsoPattern = benchmark.patterns.find((p) => p.pattern === 'One-Click Google SSO');
      expect(googleSsoPattern?.ourProduct).toBe(false);
      expect(googleSsoPattern?.referenceProduct).toBe(true);

      const pricingTogglePattern = benchmark.patterns.find((p) => p.pattern === 'Annual/Monthly Billing Toggle');
      expect(pricingTogglePattern?.ourProduct).toBe(false);
      expect(pricingTogglePattern?.referenceProduct).toBe(true);
    });
  });

  describe('UXGapSynthesizer', () => {
    const synthesizer = new UXGapSynthesizer();
    const engine = new BenchmarkingEngine();

    it('synthesizes prioritized actionable recommendations from flow disparities', async () => {
      const ourScore = engine.calculateScorecard(ourFlow);
      const compScore = engine.calculateScorecard(competitorFlow);
      const recommendations = await synthesizer.synthesize(
        ourFlow,
        competitorFlow,
        ourScore,
        compScore,
        new MockAIProvider()
      );

      expect(recommendations.length).toBeGreaterThan(0);

      const fieldReductionRec = recommendations.find((r) => r.title.includes('Reduce mandatory form inputs'));
      expect(fieldReductionRec).toBeDefined();
      expect(fieldReductionRec?.category).toBe('Quick Win');
      expect(fieldReductionRec?.effort).toBe('Low');
      expect(fieldReductionRec?.impact).toBe('High');

      const ssoRec = recommendations.find((r) => r.title.includes('Google Social Sign-In'));
      expect(ssoRec).toBeDefined();
      expect(ssoRec?.category).toBe('Quick Win');

      const progressiveRec = recommendations.find((r) => r.title.includes('progressive disclosure'));
      expect(progressiveRec).toBeDefined();
      expect(progressiveRec?.category).toBe('Strategic Investment');
    });
  });
});
