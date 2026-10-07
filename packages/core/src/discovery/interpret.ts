import type { DiscoveredFlow, DiscoveryDraft, PageInventoryItem, TestCaseExpectations, TestCaseStep } from '@qa/types';
import type { AIProvider } from '../ai/ai-provider.js';
import { PlanValidator } from './plan-validator.js';

/**
 * Turns a person's own words into something the tests can run: a whole test ("Save an invoice
 * with an empty amount — it should show an error") or a rule for an existing journey ("The total
 * must show the currency"). The text model only sees the page's real elements, and its answer is
 * checked like any AI plan before it is shown back for the person to confirm.
 */

export type Interpretation = { ok: true; flow: DiscoveredFlow } | { ok: false; message: string };

export type RuleInterpretation =
  { ok: true; rule: NonNullable<DiscoveredFlow['userRules']>[number] } | { ok: false; message: string };

const NO_AI =
  'Turning a sentence into a test needs the AI helper, which isn’t set up. Add an AI key in Settings, then try again.';
const UNCLEAR = 'I couldn’t work out what to do from that. Say what to click or fill in, and what should happen.';

type Expected = { kind?: string; field?: string; text?: string; page?: string };

/** The person's expectation, as a check that is theirs: it can fail the site. */
function toExpectations(
  expected: Expected | undefined,
  page: PageInventoryItem | undefined
): TestCaseExpectations | null {
  switch (expected?.kind) {
    case 'error-message': {
      if (!expected.field) return null;
      const field = (page?.elements || []).find((el) => el.name.toLowerCase() === expected.field!.toLowerCase());
      return {
        origin: 'user',
        validationError: {
          field: expected.field,
          selector: field?.selector,
          description: `An error appears about “${expected.field}”`,
        },
      };
    }
    case 'text':
      return expected.text
        ? { origin: 'user', text: { contains: expected.text, description: `The page says “${expected.text}”` } }
        : null;
    case 'page':
      return expected.page
        ? { origin: 'user', url: { pattern: expected.page, description: `Ends on ${expected.page}` } }
        : null;
    case 'success-message':
      return { origin: 'user', successMessage: { description: 'A success message appears' } };
    case 'nothing-breaks':
      return { origin: 'user' };
    default:
      return null;
  }
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(
      text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim()
    ) as T;
  } catch {
    return null;
  }
}

const EXPECTED_SHAPE = `"expected": { "kind": "error-message" | "text" | "page" | "success-message" | "nothing-breaks", "field": "<error-message: the field's name as listed>", "text": "<text: the exact words to find>", "page": "<page: the path to end on>" }`;

export async function interpretTest(options: {
  sentence: string;
  urlPath: string;
  role?: string;
  draft: Pick<DiscoveryDraft, 'pages' | 'forms'>;
  ai?: AIProvider;
}): Promise<Interpretation> {
  const sentence = options.sentence.trim();
  if (!sentence) return { ok: false, message: 'Write what the test should do, then try again.' };
  if (!options.ai) return { ok: false, message: NO_AI };
  const page = options.draft.pages.find((p) => p.urlPath === options.urlPath);
  if (!page) return { ok: false, message: `I couldn’t find the page ${options.urlPath} in this plan.` };

  const response = await options.ai
    .generateText(
      [
        {
          role: 'system',
          content: 'You turn a person’s description of a website test into steps. Output strictly valid JSON.',
        },
        {
          role: 'user',
          content: `A person describes a test for one page in their own words. Turn it into steps, using ONLY the elements listed for the page.

${PlanValidator.describePageForPrompt(page)}

The person wrote: "${sentence}"

Reply with ONLY a JSON object:
{
  "understood": true | false,
  "unclear": "<when not understood: one short sentence to the person saying what is unclear or missing, e.g. I couldn't find a button called Export on this page.>",
  "name": "<a short name for the test>",
  "steps": [ { "action": "click" | "fill" | "select" | "check" | "wait", "selector": "<copied exactly from the list>", "value": "<for fill or select; an empty string to leave a field empty>", "name": "<what the step does, in plain words>" } ],
  ${EXPECTED_SHAPE}
}
If the sentence mentions something that isn't in the list, set "understood" to false and name it in "unclear".`,
        },
      ],
      { responseFormat: 'json', temperature: 0 }
    )
    .catch(() => null);

  const parsed = response
    ? parseJson<{ understood?: boolean; unclear?: string; name?: string; steps?: TestCaseStep[]; expected?: Expected }>(
        response
      )
    : null;
  if (!parsed) return { ok: false, message: UNCLEAR };
  if (parsed.understood === false) return { ok: false, message: parsed.unclear?.trim() || UNCLEAR };

  const steps = (parsed.steps || []).filter((s) => s && typeof s.action === 'string');
  const expectations = toExpectations(parsed.expected, page);
  if (steps.length === 0 || !expectations) return { ok: false, message: UNCLEAR };

  const flow: DiscoveredFlow = {
    id: `FLOW-USER-${Date.now()}`,
    name: (parsed.name || sentence).trim().slice(0, 80),
    role: options.role || 'visitor',
    description: sentence,
    startPage: page.urlPath,
    steps: steps.map((s) => ({ action: s.action, selector: s.selector, value: s.value, name: s.name || s.action })),
    candidateExpectations: expectations,
    source: 'user',
  };

  // Never a step aimed at something the scan didn't find.
  const issues = new PlanValidator(options.draft.pages, options.draft.forms).checkFlow(flow);
  if (issues.length > 0) {
    const missing = flow.steps[issues[0].stepIndex];
    return {
      ok: false,
      message: `I couldn’t find “${missing?.name || missing?.selector}” on ${page.urlPath}. Name the button or field as it appears on the page, then try again.`,
    };
  }
  return { ok: true, flow };
}

export async function interpretRule(options: {
  sentence: string;
  flow: DiscoveredFlow;
  draft: Pick<DiscoveryDraft, 'pages'>;
  ai?: AIProvider;
}): Promise<RuleInterpretation> {
  const text = options.sentence.trim();
  if (!text) return { ok: false, message: 'Write the rule, then try again.' };
  // Without the AI a rule is still kept: listed in the report for a person to check.
  if (!options.ai) return { ok: true, rule: { text, origin: 'user', checkable: false } };

  const lastPage = options.draft.pages.find((p) => p.urlPath === options.flow.startPage);
  const response = await options.ai
    .generateText(
      [
        {
          role: 'system',
          content: 'You decide how a website test can check a business rule. Output strictly valid JSON.',
        },
        {
          role: 'user',
          content: `A journey on a website: "${options.flow.name}", starting on ${options.flow.startPage}, with these steps:
${options.flow.steps.map((s, i) => `${i + 1}. ${s.name}`).join('\n')}

The site's owner adds a rule: "${text}"

Can the rule be checked by looking at the page after the journey's steps? Reply with ONLY a JSON object:
{ "checkable": true | false, ${EXPECTED_SHAPE} }`,
        },
      ],
      { responseFormat: 'json', temperature: 0 }
    )
    .catch(() => null);

  const parsed = response ? parseJson<{ checkable?: boolean; expected?: Expected }>(response) : null;
  const check = parsed?.checkable ? toExpectations(parsed.expected, lastPage) : null;
  return {
    ok: true,
    rule: check ? { text, origin: 'user', checkable: true, check } : { text, origin: 'user', checkable: false },
  };
}
