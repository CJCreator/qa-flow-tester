import type {
  AIMessage,
  AmbiguityQuestion,
  FallbackReason,
  DiscoveredFlow,
  PageInventoryItem,
  RoleCredential,
} from '@qa/types';
import { AITruncatedError, completeWith, type AIProvider } from '../ai/ai-provider.js';
import { PlanValidator } from '../discovery/plan-validator.js';
import { CREDENTIAL_PLACEHOLDERS } from '../credentials.js';
import { generateFallbackJourneys, type SiteType } from '../discovery/site-type.js';
import { stepQuestion } from '../discovery/questions.js';
import type { SpiderResult } from '../discovery/deterministic-spider.js';
import { BudgetSpentError, StoppedEarlyError } from './ai-budget.js';
import { fallbackReasonOf, parseJsonAnswer, PLANNING_MAX_TOKENS } from './ai-planner.js';

/** Long product notes are cut short: the journeys need the gist, and every token counts on a free model. */
const CONTEXT_CHARS = 4000;

function productContextFor(context: string | undefined): string {
  const notes = context?.trim();
  if (!notes) return 'No written PRD provided. Rely on discovered pages.';
  return notes.length > CONTEXT_CHARS ? `${notes.slice(0, CONTEXT_CHARS)}… (cut short)` : notes;
}

export interface JourneyPlannerInput {
  targetUrl: string;
  productId: string;
  productContext?: string;
  /** The pages described to the AI: tested pages, closest to the start first. */
  promptPages: PageInventoryItem[];
  /** The crawl's facts: every page and form, for checking selectors and for the fixed-rule journeys. */
  spider: Pick<SpiderResult, 'pages' | 'forms'>;
  roles: RoleCredential[];
  siteType: SiteType;
  redact: (text: string) => string;
  /** What the person asked for when re-planning, e.g. "include the refund journey". */
  instructions?: string;
}

export interface JourneyPlannerOutput {
  flows: DiscoveredFlow[];
  siteType: SiteType;
  usedFallback: boolean;
  /** The AI Request Budget ran out before the journeys. */
  overBudget: boolean;
  notes: string[];
  /** Questions about journeys that can't run as planned. */
  questions: AmbiguityQuestion[];
}

/** A likely-looking value for a fill step the AI left empty: better an obvious test value than a blank field that passes silently. */
function guessFillValue(step: { selector?: string; name: string }): string {
  const hint = `${step.selector || ''} ${step.name}`.toLowerCase();
  if (hint.includes('email')) return 'test.user@example.com';
  if (hint.includes('password') || hint.includes('pass')) return 'TestPassword123!';
  if (
    hint.includes('url') ||
    hint.includes('address') ||
    hint.includes('site') ||
    hint.includes('domain') ||
    hint.includes('host')
  )
    return 'https://example.com';
  if (hint.includes('phone') || hint.includes('tel')) return '5555550123';
  if (hint.includes('name')) return 'Test User';
  if (hint.includes('number') || hint.includes('amount') || hint.includes('qty')) return '1';
  return 'Test Value';
}

/**
 * Plans the journeys across pages with the AI: multi-step things a person does, each page's own
 * buttons and links being planned separately. The AI may only use selectors from the pages it's
 * shown; the plan validator checks that, with one repair. Without the AI, or past the AI Request
 * Budget, fixed rules choose the journeys.
 */
export async function planJourneys(
  input: JourneyPlannerInput,
  ai: AIProvider | undefined
): Promise<JourneyPlannerOutput> {
  const siteType = input.siteType;
  const notes: string[] = [];
  const validator = new PlanValidator(input.spider.pages, input.spider.forms);
  const fallback = () => generateFallbackJourneys(siteType, input.spider as SpiderResult, input.roles);

  if (!ai) {
    notes.push('No AI key is set up, so the journeys were chosen by fixed rules. The AI review sections were skipped.');
    return finish(fallback(), true, false, 'no-ai');
  }

  // A form repeated on many pages (a search box in the header) is listed once, with its pages.
  const formsForPrompt: Array<{
    pages: string[];
    method?: string;
    action?: string;
    fields: unknown[];
    submitSelector?: string;
  }> = [];
  const byShape = new Map<string, (typeof formsForPrompt)[number]>();
  for (const f of input.spider.forms) {
    const form = {
      method: f.method,
      action: f.action,
      fields: f.inputs.map((i) => ({
        label: i.label,
        type: i.type,
        required: i.required || undefined,
        selector: i.selector,
      })),
      submitSelector: f.submitButtonSelector,
    };
    const shape = JSON.stringify(form);
    const same = byShape.get(shape);
    if (same) {
      if (!same.pages.includes(f.urlPath)) same.pages.push(f.urlPath);
      continue;
    }
    const entry = { pages: [f.urlPath], ...form };
    byShape.set(shape, entry);
    formsForPrompt.push(entry);
  }
  const promptMessage: AIMessage = {
    role: 'user',
    content: input.redact(`
You are an expert QA Engineer synthesizing application flows for pre-release testing.
Target Application: ${input.targetUrl} (a ${siteType} site)

Product Context:
${productContextFor(input.productContext)}
${input.instructions ? `\nThe owner asks: ${input.instructions}\n` : ''}
Discovered Pages and the interactive elements on each (nothing else exists):
${input.promptPages.map((p) => PlanValidator.describePageForPrompt(p)).join('\n\n')}

Discovered Forms (a form on several pages is listed once):
${JSON.stringify(formsForPrompt)}

Roles: ${(input.roles.length ? input.roles : [{ role: 'member' }]).map((r) => r.role).join(', ')}

Rules:
- Every step "selector" MUST be copied exactly from the element or form lists above, from the page the step runs on. Never invent a selector.
- Each flow runs already signed in as its role (pages list who reached them), so only include sign-in steps in a flow that is about signing in.
- To type a role's sign-in details, use the values ${CREDENTIAL_PLACEHOLDERS.username} and ${CREDENTIAL_PLACEHOLDERS.password}; the runner fills in the real ones.
- Only give expected text or error messages that appear in the Product Context or on a listed page. If you don't know the exact wording, leave it out.

Generate a JSON object with:
1. "flows": the journeys a person takes across pages to get something done, as an array of 3 to 8 DiscoveredFlow items (each page's own buttons and links are planned separately, so focus on multi-step journeys). Each flow MUST have:
   - "id": e.g. "FLOW-001"
   - "name": flow name
   - "role": assigned role
   - "description": a one-line reason why this journey was chosen
   - "startPage": starting URL path
   - "steps": array of { action: "click"|"fill"|"navigate"|"wait", selector?: string, value?: string, name: string }
   - "inferredRules": list of validation or business constraints
   - "candidateExpectations": { url?: { pattern: string }, text?: { contains: string } }
   - "candidateValidationRules": [ { field: string, selector?: string, min?: number, max?: number, expectedError: string } ]
2. "inferredRules": list of global inferred application business rules

Respond with ONLY the JSON object.
`),
  };

  // The site type comes from the crawl (site-type.ts); the AI isn't asked for it.
  const parseFlows = (responseText: string): DiscoveredFlow[] => parseJsonAnswer(responseText).flows || [];

  // Small free models often omit "value" on fill steps, which would silently type nothing: that
  // counts as unusable, so it gets the same repair as malformed JSON.
  const missingFillValue = (flows: DiscoveredFlow[]): string | null => {
    for (const flow of flows) {
      for (const step of flow.steps || []) {
        if (step.action === 'fill' && (!step.value || String(step.value).trim() === '')) {
          return `Flow "${flow.id}" step "${step.name}" has action "fill" but no non-empty "value".`;
        }
      }
    }
    return null;
  };
  const problemsIn = (flows: DiscoveredFlow[]): string[] => {
    const problems: string[] = [];
    const missing = missingFillValue(flows);
    if (missing) problems.push(missing);
    problems.push(...validator.check(flows).map((i) => i.message));
    return problems;
  };

  const system: AIMessage = {
    role: 'system',
    content: 'You are an autonomous QA flow extraction agent. Output strictly valid JSON.',
  };
  const asked = {
    responseFormat: 'json',
    reasoning: 'low',
    maxTokens: PLANNING_MAX_TOKENS,
    stage: 'journeys',
  } as const;
  // Asked again when the answer is cut off: fewer, leaner journeys fit in what the model has left
  // after thinking. The same request again would be cut off the same way.
  const shorterMessage: AIMessage = {
    role: 'user',
    content: `${promptMessage.content}\nKeep the answer short, or it gets cut off: at most 3 flows of at most 6 steps, each with only "id", "name", "role", "description", "startPage", "steps" and "candidateExpectations". Leave out "inferredRules" and "candidateValidationRules".`,
  };
  try {
    let asking = promptMessage;
    let first = await completeWith(ai, [system, asking], { ...asked, temperature: 0.2 });
    let firstParse: DiscoveredFlow[] | null = null;
    let problems: string[] = [];
    for (let attempt = 1; ; attempt++) {
      try {
        firstParse = parseFlows(first.text);
        problems = problemsIn(firstParse);
        break;
      } catch (parseErr) {
        if (first.finishReason !== 'length') {
          problems = [`The response was not valid JSON (${parseErr instanceof Error ? parseErr.message : parseErr}).`];
          break;
        }
        if (attempt > 1) throw new AITruncatedError(first.model);
        console.warn('[JourneyPlanner] The answer was cut off; asking for fewer, shorter journeys...');
        asking = shorterMessage;
        first = await completeWith(ai, [system, asking], { ...asked, temperature: 0.2 });
      }
    }
    const responseText = first.text;
    if (problems.length === 0 && firstParse) return finish(firstParse, false, false);

    // One chance to repair its own output, told exactly what was wrong.
    console.warn(`[JourneyPlanner] AI response needs repair (${problems[0]}); retrying with a repair prompt...`);
    const repairText = await ai.generateText(
      [
        system,
        asking,
        { role: 'assistant', content: responseText },
        {
          role: 'user',
          content: `That response was not usable:\n${problems
            .slice(0, 20)
            .map((p) => `- ${p}`)
            .join(
              '\n'
            )}\n\nReply again with ONLY a single valid JSON object matching the requested schema — no markdown fences, no commentary, no truncation. Copy every selector exactly from the element lists, and every "fill" step MUST include a concrete non-empty "value".`,
        },
      ],
      { ...asked, stage: 'repair', temperature: 0 }
    );
    let flows: DiscoveredFlow[];
    try {
      flows = parseFlows(repairText);
    } catch (repairErr) {
      // A usable first answer beats none: its bad steps are caught when checked.
      if (!firstParse) throw repairErr;
      flows = firstParse;
    }
    // Still no value after the repair: type an obvious test value rather than nothing.
    for (const flow of flows) {
      for (const step of flow.steps || []) {
        if (step.action === 'fill' && (!step.value || String(step.value).trim() === '')) {
          step.value = guessFillValue(step);
          console.warn(
            `[JourneyPlanner] AI-generated fill step "${step.name}" in flow "${flow.id}" had no value; backfilling with a placeholder ("${step.value}") to avoid a silent no-op.`
          );
        }
      }
    }
    return finish(flows, false, false);
  } catch (aiErr) {
    console.warn(`[JourneyPlanner] Fixed-rule journeys instead: ${aiErr instanceof Error ? aiErr.message : aiErr}`);
    const overBudget = aiErr instanceof BudgetSpentError;
    notes.push(
      overBudget
        ? 'The AI Request Budget ran out before the journeys, so fixed rules chose them. Re-plan them with the AI when requests are available again.'
        : aiErr instanceof StoppedEarlyError
          ? 'You stopped the scan early, so fixed rules chose the journeys.'
          : aiErr instanceof AITruncatedError
            ? 'The AI model stopped before it finished planning the journeys (it used its whole answer allowance), so fixed rules chose them. Choose another model in Settings, then re-plan them.'
            : 'The AI service didn’t answer for the journeys, so fixed rules chose them.'
    );
    return finish(fallback(), true, overBudget, fallbackReasonOf(aiErr));
  }

  function finish(
    flows: DiscoveredFlow[],
    usedFallback: boolean,
    overBudget: boolean,
    reason?: FallbackReason
  ): JourneyPlannerOutput {
    for (const flow of flows) {
      flow.source ??= usedFallback ? 'fallback' : 'ai';
      if (flow.source === 'fallback' && reason) flow.fallbackReason = reason;
    }
    // What the AI expects is a guess unless the owner's notes say it, and a guess never fails a site
    // on its own: it's reported as "Could not verify" until someone confirms it.
    const context = input.productContext || '';
    const inNotes = (text: string) => {
      const wording = text
        .replace(/^\^|\$$/g, '')
        .replace(/\*/g, '')
        .trim();
      return wording.length >= 3 && context.includes(wording);
    };
    for (const flow of flows) {
      if (!flow.description || flow.description.trim() === '')
        flow.description = `Primary ${siteType} journey: ${flow.name}`;
      const expectations = flow.candidateExpectations;
      if (expectations) {
        const wording = [expectations.text?.contains, expectations.text?.notContains, expectations.url?.pattern].filter(
          (w): w is string => !!w
        );
        expectations.origin = wording.length > 0 && wording.every(inNotes) ? 'user' : 'ai-guess';
      }
      for (const rule of flow.candidateValidationRules || [])
        rule.origin = inNotes(rule.expectedError) ? 'user' : 'ai-guess';
    }
    // Whatever is still wrong: the journey isn't run, and the plan review asks about it.
    validator.markFlowsNeedingHelp(flows);
    const questions: AmbiguityQuestion[] = [];
    for (const flow of flows) {
      if (flow.needsHelp?.length) questions.push(stepQuestion(flow, questions.length + 1));
    }
    return { flows, siteType, usedFallback, overBudget, notes, questions };
  }
}
