import type { AmbiguityQuestion, DiscoveredFlow, SensitiveAction } from '@qa/types';

/**
 * The questions the plan review asks, in plain words. Each has a safe answer, used when nobody
 * answers (a skipped review), and a key that stays the same from run to run so a site's answers
 * can be remembered.
 */

export const FORM_ANSWERS = {
  confirmationPage: 'They should land on a confirmation page',
  successMessage: 'A success message should appear on the same page',
  noBreak: 'Just check nothing breaks',
  exclude: 'Don’t test this form',
} as const;

export const SENSITIVE_ANSWERS = {
  skip: 'Don’t press it',
  allow: 'Press it: this is a test copy with test data',
} as const;

export const STEP_ANSWERS = {
  skip: 'Skip this journey',
  describe: 'Describe it in your own words',
} as const;

const SENSITIVE_WORDS: Record<SensitiveAction['type'], string> = {
  deletion: 'deletes something',
  payment: 'takes a payment',
  external_communication: 'sends a message to people',
  admin_setting: 'does something you asked not to be tested',
};

function fieldList(labels: string[]): string {
  const named = labels.filter(Boolean);
  if (named.length === 0) return '';
  if (named.length === 1) return ` (${named[0]})`;
  return ` (${named.slice(0, -1).join(', ')} and ${named[named.length - 1]})`;
}

/**
 * The question for a form. The same form on several pages (a search box in the header) is one
 * question: `pages` lists them, and the answer counts for each.
 */
export function formQuestion(
  form: { urlPath: string; submitButtonSelector?: string; inputs: Array<{ label: string }> },
  index: number,
  pages: string[] = [form.urlPath]
): AmbiguityQuestion {
  const where = pages.length > 1 ? `found on ${pages.length} pages, such as ${pages[0]}` : `on ${form.urlPath}`;
  return {
    id: `Q-FORM-${index}`,
    key:
      pages.length > 1
        ? `form:shared:${form.submitButtonSelector || 'form'}:${form.inputs.map((i) => i.label).join('|')}`
        : `form:${form.urlPath}:${form.submitButtonSelector || 'form'}`,
    targetElement: form.submitButtonSelector || 'form',
    urlPath: form.urlPath,
    urlPaths: pages.length > 1 ? pages : undefined,
    question: `What should happen after someone fills in the form ${where}${fieldList(form.inputs.map((i) => i.label))} and sends it?`,
    options: [FORM_ANSWERS.confirmationPage, FORM_ANSWERS.successMessage, FORM_ANSWERS.noBreak, FORM_ANSWERS.exclude],
    safeAnswer: FORM_ANSWERS.noBreak,
    category: 'untested_form',
  };
}

export function sensitiveQuestion(action: SensitiveAction, index: number): AmbiguityQuestion {
  return {
    id: `Q-SENSITIVE-${index}`,
    key: `sensitive:${action.urlPath}:${action.elementSelector}`,
    targetElement: action.elementSelector,
    urlPath: action.urlPath,
    question: `“${action.elementText}” on ${action.urlPath || 'this page'} looks like it ${SENSITIVE_WORDS[action.type]}. Should the tests press it?`,
    options: [SENSITIVE_ANSWERS.skip, SENSITIVE_ANSWERS.allow],
    safeAnswer: SENSITIVE_ANSWERS.skip,
    category: 'sensitive_action',
  };
}

export function stepQuestion(flow: DiscoveredFlow, index: number): AmbiguityQuestion {
  return {
    id: `Q-STEP-${index}`,
    key: `journey:${flow.startPage}:${flow.name.trim().toLowerCase()}`,
    flowId: flow.id,
    urlPath: flow.startPage,
    question: `The journey “${flow.name}” uses something that isn’t on the page, so it can’t run as planned. What should happen?`,
    options: [STEP_ANSWERS.skip, STEP_ANSWERS.describe],
    safeAnswer: STEP_ANSWERS.skip,
    category: 'unverified_step',
  };
}

/** The answer a question gets when nobody answers it: the one that sends nothing and deletes nothing. */
export function safeAnswerFor(q: AmbiguityQuestion): string | undefined {
  if (q.safeAnswer && q.options.includes(q.safeAnswer)) return q.safeAnswer;
  // Questions written before safe answers were recorded: never fall back to the first option.
  return q.options.find((o) => /\b(skip|don.t|exclude)\b/i.test(o));
}

/** Gives every unanswered question its safe answer (a skipped review, or questions nobody opened). */
export function applySafeAnswers(questions: AmbiguityQuestion[]): void {
  for (const q of questions) {
    if (q.selectedAnswer) continue;
    const safe = safeAnswerFor(q);
    if (safe) q.selectedAnswer = safe;
  }
}

/** True for an answer that leaves something out of the tests. */
export function isSkipAnswer(answer: string | undefined): boolean {
  return !!answer && /\b(skip|don.t press|don.t test|exclude|out of scope)\b/i.test(answer);
}
