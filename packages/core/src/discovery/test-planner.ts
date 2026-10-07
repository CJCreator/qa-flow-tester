import { promises as fs } from 'fs';
import type {
  AmbiguityQuestion,
  DiscoveredFlow,
  DiscoveryDraft,
  SpecFile,
  TestCase,
  TestCaseExpectations,
  TestCaseStep,
} from '@qa/types';
import { FORM_ANSWERS, isSkipAnswer } from './questions.js';

/** True when the flow presses the form's send button on the form's page. */
function submitsForm(flow: DiscoveredFlow, q: AmbiguityQuestion): boolean {
  if (!q.targetElement) return false;
  const pages = q.urlPaths ?? [q.urlPath];
  const onFormPage =
    pages.includes(flow.startPage) ||
    flow.steps.some((s) => s.action === 'navigate' && !!s.value && pages.includes(s.value));
  return onFormPage && flow.steps.some((s) => s.action === 'click' && s.selector === q.targetElement);
}

/**
 * What the user said should happen after sending a form. It replaces the AI's guess for that
 * journey: a confirmed expectation and a guessed one can't share one set of checks.
 */
function expectationFromAnswer(q: AmbiguityQuestion): TestCaseExpectations | null {
  if (q.selectedAnswer === FORM_ANSWERS.confirmationPage) {
    return {
      origin: 'user',
      navigatesAway: { fromPath: q.urlPath, description: 'Sending the form leads to a confirmation page' },
    };
  }
  if (q.selectedAnswer === FORM_ANSWERS.successMessage) {
    return { origin: 'user', successMessage: { description: 'Sending the form shows a success message' } };
  }
  return null;
}

export class TestPlanner {
  plan(draft: DiscoveryDraft, options: { readOnly?: boolean } = {}): SpecFile {
    const outOfScopePages = new Set(draft.pages.filter((p) => p.outOfScope).map((p) => p.urlPath));

    // Buttons the answers said not to press
    const skippedElements = new Set<string>();
    for (const q of draft.ambiguityQuestions) {
      if (q.category !== 'untested_form' && isSkipAnswer(q.selectedAnswer) && q.targetElement) {
        skippedElements.add(q.targetElement);
      }
    }
    const formAnswers = draft.ambiguityQuestions.filter((q) => q.category === 'untested_form' && q.selectedAnswer);
    const skippedJourneys = new Set(
      draft.ambiguityQuestions.filter((q) => q.flowId && isSkipAnswer(q.selectedAnswer)).map((q) => q.flowId!)
    );

    const testCases: TestCase[] = [];

    for (const flow of draft.flows) {
      // 1. Skip flows marked out of scope or whose startPage is out of scope, flows that can't run
      // as planned until someone fixes them, and flows an answer left out
      if (
        flow.outOfScope ||
        outOfScopePages.has(flow.startPage) ||
        (flow.needsHelp?.length ?? 0) > 0 ||
        skippedJourneys.has(flow.id)
      ) {
        continue;
      }
      // On a live site a journey that sends a form stays in the plan but isn't run.
      if (options.readOnly && flow.needsTestCopy) continue;

      const formAnswer = formAnswers.find((q) => submitsForm(flow, q));
      if (formAnswer && isSkipAnswer(formAnswer.selectedAnswer)) continue;

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

      const answered = formAnswer ? expectationFromAnswer(formAnswer) : null;
      const id = flow.id.startsWith('TC-') ? flow.id : `TC-${flow.id}`;
      testCases.push({
        id,
        requirementId: `REQ-${flow.id}`,
        flowId: flow.id,
        name: flow.name,
        role: flow.role,
        startPage: flow.startPage,
        steps: activeSteps,
        expectations: answered ??
          flow.candidateExpectations ?? {
            url: { pattern: '/*' },
          },
        validationRules: flow.candidateValidationRules,
      });

      // Each checkable rule the user added is its own test, so it never shares a verdict with a guess.
      (flow.userRules || []).forEach((rule, i) => {
        if (!rule.checkable || !rule.check) return;
        testCases.push({
          id: `${id}-RULE-${i + 1}`,
          requirementId: `REQ-${flow.id}`,
          flowId: flow.id,
          name: `${flow.name}: ${rule.text}`,
          role: flow.role,
          startPage: flow.startPage,
          steps: activeSteps.map((s) => ({ ...s })),
          expectations: { ...rule.check, origin: 'user' },
        });
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
