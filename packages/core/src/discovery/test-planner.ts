import { promises as fs } from 'fs';
import type { DiscoveryDraft, SpecFile, TestCase, TestCaseStep } from '@qa/types';

export class TestPlanner {
  plan(draft: DiscoveryDraft): SpecFile {
    const outOfScopePages = new Set(
      draft.pages.filter((p) => p.outOfScope).map((p) => p.urlPath)
    );

    // Identify skipped elements from answered ambiguity questions
    const skippedElements = new Set<string>();
    for (const q of draft.ambiguityQuestions) {
      if (
        q.selectedAnswer &&
        q.selectedAnswer.toLowerCase().includes('skip') &&
        q.targetElement
      ) {
        skippedElements.add(q.targetElement);
      }
    }

    const testCases: TestCase[] = [];

    for (const flow of draft.flows) {
      // 1. Skip flows marked out of scope or whose startPage is out of scope, and flows that
      // can't run as planned until someone fixes them
      if (flow.outOfScope || outOfScopePages.has(flow.startPage) || (flow.needsHelp?.length ?? 0) > 0) {
        continue;
      }

      // 2. Filter out steps targeting skipped elements
      const activeSteps: TestCaseStep[] = flow.steps.filter((s) => {
        if (s.selector && skippedElements.has(s.selector)) {
          return false;
        }
        return true;
      });

      if (activeSteps.length === 0) {
        continue;
      }

      testCases.push({
        id: flow.id.startsWith('TC-') ? flow.id : `TC-${flow.id}`,
        requirementId: `REQ-${flow.id}`,
        flowId: flow.id,
        name: flow.name,
        role: flow.role,
        startPage: flow.startPage,
        steps: activeSteps,
        expectations: flow.candidateExpectations || {
          url: { pattern: '/*' },
        },
        validationRules: flow.candidateValidationRules,
      });
    }

    return {
      version: draft.version || '1.0',
      product: draft.productId,
      testCases,
    };
  }

  async saveSpecFile(spec: SpecFile, outputPath: string): Promise<void> {
    await fs.writeFile(outputPath, JSON.stringify(spec, null, 2), 'utf8');
  }
}
