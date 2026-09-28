import { promises as fs } from 'fs';
import path from 'path';
import type {
  ProductProfile,
  DiscoveryDraft,
  DiscoveredFlow,
  AmbiguityQuestion,
  AIMessage,
  PageInventoryItem,
} from '@qa/types';
import { BrowserManager } from '../browser.js';
import { PreFlightChecker } from '../preflight.js';
import { DeterministicSpider, type SpiderResult } from './deterministic-spider.js';
import { ContextParser } from './context-parser.js';
import { PlanValidator } from './plan-validator.js';
import { Redactor } from '../redact.js';
import { CREDENTIAL_PLACEHOLDERS, replaceCredentialsWithPlaceholders } from '../credentials.js';
import type { AIProvider } from '../ai/ai-provider.js';

/** Room for a plan covering every page found (about 25), plus any thinking a model insists on. */
const PLAN_MAX_TOKENS = 12000;

export interface DiscoveryOptions {
  targetUrl: string;
  productId: string;
  profile?: ProductProfile;
  contextFilePath?: string;
  outputDir?: string;
  aiProvider: AIProvider;
}

/**
 * Combines the signed-out crawl with each role's crawl. A page keeps the elements seen by the
 * last explorer to reach it (the signed-in view, when a role reached it) and lists who reached it.
 */
export function mergeCrawls(crawls: Array<{ who: string; result: SpiderResult }>): SpiderResult {
  const pages = new Map<string, PageInventoryItem>();
  const forms = new Map<string, SpiderResult['forms'][number]>();
  const sensitive = new Map<string, SpiderResult['sensitiveActions'][number]>();
  const questions = new Map<string, AmbiguityQuestion>();

  for (const { who, result } of crawls) {
    for (const page of result.pages) {
      const key = new URL(page.urlPath, 'http://x').pathname;
      const reachedBy = [...(pages.get(key)?.reachedBy || []), who];
      pages.set(key, { ...page, reachedBy });
    }
    for (const form of result.forms) forms.set(`${form.urlPath}|${form.action}|${form.submitButtonSelector}`, form);
    for (const action of result.sensitiveActions) sensitive.set(`${action.urlPath}|${action.elementSelector}`, action);
    for (const q of result.ambiguityQuestions) questions.set(`${q.urlPath}|${q.targetElement}|${q.category}`, q);
  }

  const reached = new Set(pages.keys());
  const walls = new Set(crawls.flatMap((c) => c.result.signInWalls).filter((p) => !reached.has(p)));
  return {
    pages: [...pages.values()],
    forms: [...forms.values()],
    sensitiveActions: [...sensitive.values()],
    ambiguityQuestions: [...questions.values()].map((q, i) => ({ ...q, id: `Q-${String(i + 1).padStart(3, '0')}` })),
    signInWalls: [...walls],
  };
}

function describeExploration(
  crawls: Array<{ who: string; result: SpiderResult }>,
  merged: SpiderResult,
  signInFailed: string[]
): NonNullable<DiscoveryDraft['exploration']> {
  const signedInAs = crawls.map((c) => c.who).filter((who) => who !== 'visitor');
  const signInPages = merged.pages.filter((p) => p.hasSignInForm).map((p) => p.urlPath);
  const notes: string[] = [];
  if (signedInAs.length === 0 && (signInPages.length > 0 || merged.signInWalls.length > 0)) {
    notes.push(
      `Pages behind the sign-in were not reached${merged.signInWalls.length ? ` (${merged.signInWalls.join(', ')})` : ''}. Add a sign-in to test them.`
    );
  } else if (merged.signInWalls.length > 0) {
    notes.push(`These pages ask for a sign-in that no role could get past: ${merged.signInWalls.join(', ')}.`);
  }
  for (const role of signInFailed) {
    notes.push(`Signing in as "${role}" didn't work, so nothing was explored as that role. Check its username, password and sign-in page.`);
  }
  return { signedInAs, signInFailed, signInPages, notReached: merged.signInWalls, notes };
}

export class DiscoveryAgent {
  private browserManager = new BrowserManager();
  private contextParser = new ContextParser();

  async discover(options: DiscoveryOptions): Promise<DiscoveryDraft> {
    const outputDir = options.outputDir || path.join(process.cwd(), '.qa-report');
    await fs.mkdir(outputDir, { recursive: true });

    // 1. Ingest Product Context
    const parsedContext = await this.contextParser.parseFile(options.contextFilePath);

    // 2. Explore: signed out first, then once per role that can sign in, starting where it landed.
    const spider = new DeterministicSpider(options.profile?.forbiddenActions || []);
    const roles = options.profile?.roles || [];
    const redactor = new Redactor(roles);
    const preflight =
      roles.length > 0
        ? await new PreFlightChecker().runPreFlight(options.targetUrl, options.profile, undefined, {
            browserManager: this.browserManager,
            authDir: path.join(outputDir, 'auth'),
          })
        : undefined;

    console.log(`[DiscoveryAgent] Crawling routes and interactive forms on ${options.targetUrl}...`);
    const crawls: Array<{ who: string; result: SpiderResult }> = [];
    const visitorContext = await this.browserManager.createContext({ baseUrl: options.targetUrl });
    crawls.push({ who: 'visitor', result: await spider.crawl(visitorContext, options.targetUrl) });
    await visitorContext.close();

    const signInFailed: string[] = [];
    for (const role of roles) {
      const storageState = preflight?.roleStorageStates?.[role.role];
      if (!storageState) {
        signInFailed.push(role.role);
        continue;
      }
      const landing = preflight?.roleLandingPaths?.[role.role];
      console.log(`[DiscoveryAgent] Exploring signed in as "${role.role}"${landing ? ` from ${redactor.text(landing)}` : ''}...`);
      const roleContext = await this.browserManager.createContext({ baseUrl: options.targetUrl, storageState });
      crawls.push({
        who: role.role,
        result: await spider.crawl(roleContext, options.targetUrl, { startPaths: landing ? [landing] : [] }),
      });
      await roleContext.close();
    }
    await this.browserManager.close();

    const spiderResult = mergeCrawls(crawls);
    const exploration = describeExploration(crawls, spiderResult, signInFailed);

    console.log(
      `[DiscoveryAgent] Spider found ${spiderResult.pages.length} pages, ${spiderResult.forms.length} forms, ${spiderResult.sensitiveActions.length} sensitive actions.`
    );

    // 3. Form ambiguity questions for unmapped forms
    const ambiguityQuestions: AmbiguityQuestion[] = [...spiderResult.ambiguityQuestions];
    let qCounter = ambiguityQuestions.length + 1;

    for (const form of spiderResult.forms) {
      ambiguityQuestions.push({
        id: `Q-FORM-${qCounter++}`,
        targetElement: form.submitButtonSelector || 'form',
        urlPath: form.urlPath,
        question: `Found form on "${form.urlPath}" submitting to "${form.action}" with fields [${form.inputs.map((i) => i.label).join(', ')}]. What should happen on submit?`,
        options: [
          'Expect navigation to confirmation / detail page',
          'Expect inline success banner',
          'Exclude form from testing (out of scope)',
        ],
        category: 'untested_form',
      });
    }

    // 4. Synthesize flows using AI Provider. The AI sees every page's real elements and may only
    // use their selectors; the plan validator checks that before anything runs.
    const validator = new PlanValidator(spiderResult.pages, spiderResult.forms);
    const pagesForPrompt = spiderResult.pages.map((p) => PlanValidator.describePageForPrompt(p)).join('\n\n');
    const formsForPrompt = spiderResult.forms.map((f) => ({
      page: f.urlPath,
      method: f.method,
      action: f.action,
      fields: f.inputs.map((i) => ({ label: i.label, type: i.type, required: i.required || undefined, selector: i.selector })),
      submitSelector: f.submitButtonSelector,
    }));
    const promptMessage: AIMessage = {
      role: 'user',
      content: `
You are an expert QA Engineer synthesizing application flows for pre-release testing.
Target Application: ${options.targetUrl}
Product ID: ${options.productId}

Product Context:
${parsedContext.rawContent || 'No written PRD provided. Rely on discovered pages.'}

Discovered Pages and the interactive elements on each (nothing else exists):
${pagesForPrompt}

Discovered Forms:
${JSON.stringify(formsForPrompt, null, 2)}

Roles:
${JSON.stringify((options.profile?.roles || [{ role: 'member' }]).map((r) => ({ role: r.role })), null, 2)}

Rules:
- Every step "selector" MUST be copied exactly from the element or form lists above, from the page the step runs on. Never invent a selector.
- Each flow runs already signed in as its role (pages list who reached them), so only include sign-in steps in a flow that is about signing in.
- To type a role's sign-in details, use the values ${CREDENTIAL_PLACEHOLDERS.username} and ${CREDENTIAL_PLACEHOLDERS.password}; the runner fills in the real ones.
- Only give expected text or error messages that appear in the Product Context or on a listed page. If you don't know the exact wording, leave it out.

Generate a JSON object with:
1. "flows": an array of DiscoveredFlow items. Each flow MUST have:
   - "id": e.g. "FLOW-001"
   - "name": flow name
   - "role": assigned role
   - "description": summary
   - "startPage": starting URL path
   - "steps": array of { action: "click"|"fill"|"navigate"|"wait", selector?: string, value?: string, name: string }
   - "inferredRules": list of validation or business constraints
   - "candidateExpectations": { url?: { pattern: string }, text?: { contains: string } }
   - "candidateValidationRules": [ { field: string, selector?: string, min?: number, max?: number, expectedError: string } ]
2. "inferredRules": list of global inferred application business rules

Respond with ONLY the JSON object.
`,
    };
    // Belt and braces: nothing secret leaves for the AI provider, even from product notes.
    promptMessage.content = redactor.text(promptMessage.content);

    const NON_FILLABLE_TYPES = new Set(['submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden']);

    const parseFlowsFromResponse = (responseText: string): DiscoveredFlow[] => {
      const cleanJson = responseText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleanJson);
      return parsed.flows || [];
    };

    // Some models (esp. smaller/free ones) omit "value" on fill steps entirely, which
    // otherwise silently no-ops the action (e.g. a login form submitted with blank fields
    // that still "succeeds" because no exception is thrown). Detect this before accepting
    // a parse as usable so it triggers the same repair retry as malformed JSON.
    const findMissingFillValue = (flows: DiscoveredFlow[]): string | null => {
      for (const flow of flows) {
        for (const step of flow.steps || []) {
          if (step.action === 'fill' && (!step.value || String(step.value).trim() === '')) {
            return `Flow "${flow.id}" step "${step.name}" has action "fill" but no non-empty "value".`;
          }
        }
      }
      return null;
    };

    // Best-effort heuristic value for a fill step that still has no value after a repair
    // attempt, so we never silently execute a no-op fill. Better an obviously-fake value
    // that produces a visible finding than a blank field that passes silently.
    const guessFillValue = (step: { selector?: string; name: string }): string => {
      const hint = `${step.selector || ''} ${step.name}`.toLowerCase();
      if (hint.includes('email')) return 'test.user@example.com';
      if (hint.includes('password') || hint.includes('pass')) return 'TestPassword123!';
      if (hint.includes('phone') || hint.includes('tel')) return '5555550123';
      if (hint.includes('name')) return 'Test User';
      if (hint.includes('number') || hint.includes('amount') || hint.includes('qty')) return '1';
      return 'Test Value';
    };

    const backfillMissingFillValues = (flows: DiscoveredFlow[]): void => {
      for (const flow of flows) {
        for (const step of flow.steps || []) {
          if (step.action === 'fill' && (!step.value || String(step.value).trim() === '')) {
            const guessed = guessFillValue(step);
            console.warn(
              `[DiscoveryAgent] AI-generated fill step "${step.name}" in flow "${flow.id}" had no value; backfilling with a placeholder ("${guessed}") to avoid a silent no-op.`
            );
            step.value = guessed;
          }
        }
      }
    };

    // Everything that makes a parsed plan unusable: missing fill values and steps aimed at
    // elements the crawler never found.
    const problemsIn = (flows: DiscoveredFlow[]): string[] => {
      const problems: string[] = [];
      const missingValue = findMissingFillValue(flows);
      if (missingValue) problems.push(missingValue);
      problems.push(...validator.check(flows).map((i) => i.message));
      return problems;
    };

    let synthesizedFlows: DiscoveredFlow[] = [];
    let usedFallbackSynthesis = false;
    try {
      const responseText = await options.aiProvider.generateText(
        [
          {
            role: 'system',
            content: 'You are an autonomous QA flow extraction agent. Output strictly valid JSON.',
          },
          promptMessage,
        ],
        { responseFormat: 'json', temperature: 0.2, maxTokens: PLAN_MAX_TOKENS }
      );

      let firstParse: DiscoveredFlow[] | null = null;
      let problems: string[];
      try {
        firstParse = parseFlowsFromResponse(responseText);
        problems = problemsIn(firstParse);
      } catch (parseErr) {
        problems = [`The response was not valid JSON (${parseErr instanceof Error ? parseErr.message : parseErr}).`];
      }

      if (problems.length === 0 && firstParse) {
        synthesizedFlows = firstParse;
      } else {
        // Give the model one chance to repair its own output, telling it exactly what was wrong,
        // before giving up on AI synthesis or backfilling a placeholder.
        console.warn(`[DiscoveryAgent] AI response needs repair (${problems[0]}); retrying with a repair prompt...`);
        const repairText = await options.aiProvider.generateText(
          [
            {
              role: 'system',
              content: 'You are an autonomous QA flow extraction agent. Output strictly valid JSON.',
            },
            promptMessage,
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
          { responseFormat: 'json', temperature: 0, maxTokens: PLAN_MAX_TOKENS }
        );
        try {
          synthesizedFlows = parseFlowsFromResponse(repairText);
        } catch (repairErr) {
          // A usable first answer beats none: its bad steps are caught below.
          if (!firstParse) throw repairErr;
          synthesizedFlows = firstParse;
        }
        // If the repair attempt still didn't produce a value, don't silently no-op the
        // step — backfill a placeholder so the step actually does something observable.
        backfillMissingFillValues(synthesizedFlows);
      }
    } catch (aiErr) {
      console.warn(`[DiscoveryAgent] AI flow synthesis fallback triggered: ${aiErr instanceof Error ? aiErr.message : aiErr}`);
      usedFallbackSynthesis = true;
      // Fallback: generate default flows from discovered forms.
      // Only text-like inputs get a `fill` step; buttons/submits/checkboxes get `click` (or are skipped).
      let flowIdx = 1;
      for (const form of spiderResult.forms) {
        const fillableInputs = form.inputs.filter((inp) => !NON_FILLABLE_TYPES.has(inp.type));
        // type="button" needs its own click step; type="submit" is already covered by
        // submitButtonSelector below, so it's excluded here to avoid a duplicate click.
        const clickableInputs = form.inputs.filter((inp) => inp.type === 'button');

        synthesizedFlows.push({
          id: `FLOW-FALLBACK-${flowIdx++}`,
          name: `Form Flow on ${form.urlPath}`,
          role: options.profile?.roles?.[0]?.role || 'member',
          description: `Discovered form submission on ${form.urlPath}`,
          startPage: form.urlPath,
          steps: [
            ...fillableInputs.map((inp) => ({
              action: 'fill' as const,
              selector: inp.selector,
              value: inp.type === 'number' ? '100' : 'Test Value',
              name: `Fill ${inp.label || 'field'}`,
            })),
            ...clickableInputs.map((inp) => ({
              action: 'click' as const,
              selector: inp.selector,
              name: `Click ${inp.label || 'button'}`,
            })),
            ...(form.submitButtonSelector
              ? [{ action: 'click' as const, selector: form.submitButtonSelector, name: 'Submit Form' }]
              : []),
          ],
          inferredRules: ['Form fields require valid inputs'],
          candidateExpectations: {
            url: { pattern: '/*' },
          },
        });
      }
    }

    // What the AI expects is a guess unless the user's own notes say it, and a guess can never fail
    // a site on its own: it's reported as "Could not verify" until someone confirms it.
    const notes = parsedContext.rawContent || '';
    const inNotes = (text: string) => {
      const wording = text.replace(/^\^|\$$/g, '').replace(/\*/g, '').trim();
      // Too short to be a meaningful quote ("/" matches almost any notes).
      return wording.length >= 3 && notes.includes(wording);
    };
    for (const flow of synthesizedFlows) {
      // A journey with nothing to expect is still the AI's plan, and just as unconfirmed.
      const expectations = (flow.candidateExpectations ??= {});
      const wording = [expectations.text?.contains, expectations.text?.notContains, expectations.url?.pattern].filter(
        (w): w is string => !!w
      );
      expectations.origin = wording.length > 0 && wording.every(inNotes) ? 'user' : 'ai-guess';
      for (const rule of flow.candidateValidationRules || []) {
        rule.origin = inNotes(rule.expectedError) ? 'user' : 'ai-guess';
      }
    }

    // Whatever is still wrong after the repair: the flow isn't run, and the plan review asks about it.
    validator.markFlowsNeedingHelp(synthesizedFlows);
    let stepQuestionCounter = 1;
    for (const flow of synthesizedFlows) {
      if (!flow.needsHelp?.length) continue;
      console.warn(`[DiscoveryAgent] Flow "${flow.id}" can't run as planned: ${flow.needsHelp[0]}`);
      ambiguityQuestions.push({
        id: `Q-STEP-${stepQuestionCounter++}`,
        urlPath: flow.startPage,
        question: `The planned journey "${flow.name}" can't run as written: ${flow.needsHelp.join(' ')} How should it be done?`,
        options: ['Describe the steps in your own words', 'Skip this journey'],
        category: 'unverified_step',
      });
    }

    const draft: DiscoveryDraft = {
      version: '1.0',
      productId: options.productId,
      targetUrl: options.targetUrl,
      timestamp: new Date().toISOString(),
      pages: spiderResult.pages,
      flows: synthesizedFlows,
      sensitiveActions: spiderResult.sensitiveActions,
      ambiguityQuestions,
      rawContextSummary: parsedContext.summary,
      usedFallbackSynthesis,
      exploration,
    };

    // A plan never holds credentials: sign-in details become placeholders the runner fills in,
    // and anything left that looks secret is hidden before the draft is saved or returned.
    for (const flow of draft.flows) replaceCredentialsWithPlaceholders(flow.steps, roles);
    const safeDraft = redactor.deep(draft);

    const draftPath = path.join(outputDir, 'discovery-draft.json');
    await fs.writeFile(draftPath, JSON.stringify(safeDraft, null, 2), 'utf8');
    console.log(`[DiscoveryAgent] Discovery draft saved to ${draftPath}`);

    return safeDraft;
  }
}
