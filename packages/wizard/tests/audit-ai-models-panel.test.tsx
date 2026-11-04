import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_AI_MODELS_ROUTE,
  AUDIT_AI_STAGES,
  FIX_FIELDS,
  STAGE_DEFAULT_SLOT,
  STAGE_TEXT,
  afterSave,
  defaultModel,
  draftFrom,
  isUpdateEmpty,
  loadModels,
  modelsUpdate,
  saveModels,
  type AuditAiModelsReply,
  type ModelsState,
} from '../src/screens/audit/ai/stage-models-api';
import {
  AuditAiModelsPanel,
  AuditAiModelsView,
  type AuditAiModelsViewProps,
} from '../src/screens/audit/ai/AuditAiModelsPanel';

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const TEXT = 'gemini-2.5-flash';
const VISION = 'gemini-2.5-pro';

function modelsReply(models: AuditAiModelsReply['models'] = {}): AuditAiModelsReply {
  const defaults = { text: TEXT, vision: VISION };
  const effective = {} as AuditAiModelsReply['effective'];
  for (const stage of AUDIT_AI_STAGES) effective[stage] = models[stage] ?? defaults[STAGE_DEFAULT_SLOT[stage]];
  return { models, defaults, effective };
}

function stateOf(reply: AuditAiModelsReply, over: Partial<ModelsState> = {}): ModelsState {
  return { reply, draft: draftFrom(reply), errors: {}, message: null, ...over };
}

const noop = () => {};

function view(props: Partial<AuditAiModelsViewProps> = {}): string {
  const base = stateOf(props.reply ?? modelsReply());
  return renderToStaticMarkup(
    createElement(AuditAiModelsView, { ...base, saving: false, onDraft: noop, onSave: noop, onDiscard: noop, ...props })
  );
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}

/** The markup of one task's box. */
function stageBox(html: string, stage: string): string {
  const start = html.indexOf(`data-stage="${stage}"`);
  expect(start, stage).toBeGreaterThan(-1);
  const next = html.indexOf('data-stage="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

/** A fetch that records each call and answers with the next queued reply. */
function fakeFetch(...replies: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error('no reply queued');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { impl, calls };
}

// ---------------------------------------------------------------------------------------------------
// REQ-039 AC-1: a model per task; a save sends only what changed; a cleared field sends null
// ---------------------------------------------------------------------------------------------------

describe('a model per Website Audit AI task (REQ-039 AC-1)', () => {
  it('shows the four tasks in order, each with a labelled field', () => {
    const html = view();
    const order = AUDIT_AI_STAGES.map((stage) => html.indexOf(`data-stage="${stage}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const text = textOf(html);
    for (const label of [
      'Assessment notes and redesign or repair',
      'Audit Documents and Pitch Glimpse',
      'Homepage preview',
      'Section rewrite',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('sends exactly the changed tasks, a different model each', async () => {
    const reply = modelsReply({ documents: 'claude-sonnet-4-5' });
    const draft = { ...draftFrom(reply), assessment: '  gpt-4.1 ', rewrite: 'claude-haiku-4-5' };
    const update = modelsUpdate(reply, draft);
    expect(update).toEqual({ models: { assessment: 'gpt-4.1', rewrite: 'claude-haiku-4-5' } });

    const { impl, calls } = fakeFetch({
      status: 200,
      body: modelsReply({ ...reply.models, ...update.models } as AuditAiModelsReply['models']),
    });
    const outcome = await saveModels(update, impl);
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/audit-ai/models');
    expect(calls[0]!.init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      models: { assessment: 'gpt-4.1', rewrite: 'claude-haiku-4-5' },
    });
  });

  it('sends null for a cleared field, to put the default back', () => {
    const reply = modelsReply({ preview: 'gpt-4.1', rewrite: 'gpt-4.1-mini' });
    expect(modelsUpdate(reply, { ...draftFrom(reply), preview: '' })).toEqual({ models: { preview: null } });
    expect(modelsUpdate(reply, { ...draftFrom(reply), preview: '   ' })).toEqual({ models: { preview: null } });
  });

  it('sends nothing when nothing changed, and keeps the save off', () => {
    const reply = modelsReply({ assessment: 'gpt-4.1' });
    expect(isUpdateEmpty(modelsUpdate(reply, draftFrom(reply)))).toBe(true);
    // An empty field that was empty is not a change.
    expect(isUpdateEmpty(modelsUpdate(reply, { ...draftFrom(reply), documents: ' ' }))).toBe(true);
    const html = view({ reply });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save AI models<\/button>/);
    const changed = view({ reply, draft: { ...draftFrom(reply), documents: 'x' } });
    expect(changed).not.toMatch(/<button[^>]*disabled=""[^>]*>Save AI models<\/button>/);
    expect(textOf(changed)).toContain('You have changes that are not saved yet.');
  });

  it('fills each field with the saved model, else leaves it empty', () => {
    const reply = modelsReply({ rewrite: 'gpt-4.1-mini' });
    const html = view({ reply });
    expect(stageBox(html, 'rewrite')).toContain('value="gpt-4.1-mini"');
    expect(stageBox(html, 'documents')).toContain('value=""');
  });
});

// ---------------------------------------------------------------------------------------------------
// Labels and the default shown
// ---------------------------------------------------------------------------------------------------

describe('labels and the default model', () => {
  it('ties a visible label to every field', () => {
    const html = view();
    const fields = [...html.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((m) => m[0]);
    expect(fields).toHaveLength(4);
    for (const field of fields) {
      const id = field.match(/\sid="([^"]+)"/)?.[1];
      expect(id, field).toBeTruthy();
      const label = html.match(new RegExp(`<label for="${id}"[^>]*>([^<]+)</label>`))?.[1];
      expect(label?.trim(), field).toBeTruthy();
      expect(field).toContain(`aria-describedby="${id}-hint ${id}-default"`);
    }
  });

  it('shows the effective model of the reply as the default when the field is empty', () => {
    const reply = modelsReply();
    const html = view({ reply });
    for (const stage of AUDIT_AI_STAGES) {
      const box = textOf(stageBox(html, stage));
      expect(reply.models[stage]).toBeUndefined();
      expect(defaultModel(reply, stage)).toBe(reply.effective[stage]);
      expect(box, stage).toContain(`Default when empty: ${reply.effective[stage]}.`);
      expect(box, stage).toContain(`In use now: ${reply.effective[stage]}.`);
    }
    expect(textOf(stageBox(html, 'assessment'))).toContain(VISION);
    expect(textOf(stageBox(html, 'documents'))).toContain(TEXT);
  });

  it('shows the default and the chosen model in use when a task has its own model', () => {
    const reply = modelsReply({ preview: 'gpt-4.1' });
    const box = textOf(stageBox(view({ reply }), 'preview'));
    expect(box).toContain(`Default when empty: ${TEXT}.`);
    expect(box).toContain('In use now: gpt-4.1.');
  });

  it('says when the AI Provider has no default model', () => {
    const reply: AuditAiModelsReply = {
      models: {},
      defaults: { text: null, vision: null },
      effective: { assessment: null, documents: null, preview: null, rewrite: null },
    };
    expect(textOf(view({ reply }))).toContain('Default when empty: none set for your AI Provider.');
  });
});

// ---------------------------------------------------------------------------------------------------
// A 400 shows the field messages next to the fields; nothing else is cleared
// ---------------------------------------------------------------------------------------------------

describe('a refused save', () => {
  const tooLong = 'Use a model id of at most 200 characters.';

  it('returns the message per field of a 400', async () => {
    const { impl } = fakeFetch({
      status: 400,
      body: { error: 'Invalid models', code: 'ERR_INVALID_REQUEST', errors: { rewrite: tooLong } },
    });
    const outcome = await saveModels({ models: { rewrite: 'x'.repeat(201) } }, impl);
    expect(outcome).toEqual({
      ok: false,
      message: FIX_FIELDS,
      code: 'ERR_INVALID_REQUEST',
      errors: { rewrite: tooLong },
    });
    const { impl: viaFields } = fakeFetch({ status: 400, body: { fields: { preview: 'Enter a model id.' } } });
    const other = await saveModels({ models: { preview: 'x' } }, viaFields);
    expect(!other.ok && other.errors).toEqual({ preview: 'Enter a model id.' });
  });

  it('keeps every typed field and the reply, and shows the message next to its field', async () => {
    const reply = modelsReply({ documents: 'claude-sonnet-4-5' });
    const before = stateOf(reply, { draft: { ...draftFrom(reply), assessment: 'gpt-4.1', rewrite: 'x'.repeat(201) } });
    const { impl } = fakeFetch({ status: 400, body: { error: 'Invalid models', errors: { rewrite: tooLong } } });
    const after = afterSave(before, await saveModels(modelsUpdate(before.reply, before.draft), impl));
    expect(after.reply).toBe(before.reply);
    expect(after.draft).toEqual(before.draft);
    expect(after.errors).toEqual({ rewrite: tooLong });

    const html = view(after);
    const box = stageBox(html, 'rewrite');
    expect(box).toContain('aria-invalid="true"');
    expect(box).toContain(
      'aria-describedby="audit-ai-model-rewrite-hint audit-ai-model-rewrite-default audit-ai-model-rewrite-error"'
    );
    expect(textOf(box)).toContain(tooLong);
    expect(stageBox(html, 'assessment')).toContain('value="gpt-4.1"');
    expect(stageBox(html, 'assessment')).not.toContain('aria-invalid');
    expect(stageBox(html, 'documents')).toContain('value="claude-sonnet-4-5"');
    expect(textOf(html)).toContain(FIX_FIELDS);
  });

  it('shows a message for the body as a whole with the save', () => {
    const html = view({ errors: { models: 'Send the models as an object of stage to model id.' } });
    expect(textOf(html)).toContain('Send the models as an object of stage to model id.');
  });

  it('escapes a message from the runner', () => {
    const html = view({ errors: { rewrite: '<img src=x onerror=alert(1)>' } });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('takes the saved reply after a save that worked, and clears the field messages', () => {
    const reply = modelsReply();
    const saved = modelsReply({ preview: 'gpt-4.1' });
    const after = afterSave(stateOf(reply, { errors: { preview: 'x' } }), { ok: true, value: saved });
    expect(after).toEqual({
      reply: saved,
      draft: draftFrom(saved),
      errors: {},
      message: { tone: 'pass', text: 'AI models saved. The next Website Audit uses them.' },
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// stage-models-api
// ---------------------------------------------------------------------------------------------------

describe('stage-models-api', () => {
  it('loads with GET /api/audit-ai/models and keeps only well-formed values', async () => {
    const { impl, calls } = fakeFetch({
      status: 200,
      body: {
        models: { preview: 'gpt-4.1', planning: 'other', rewrite: 42 },
        defaults: { text: TEXT, vision: '' },
        effective: { assessment: null, documents: TEXT, preview: 'gpt-4.1', rewrite: TEXT },
      },
    });
    const outcome = await loadModels(impl);
    expect(calls[0]).toEqual({ url: '/api/audit-ai/models', init: { method: 'GET' } });
    expect(outcome).toEqual({
      ok: true,
      value: {
        models: { preview: 'gpt-4.1' },
        defaults: { text: TEXT, vision: null },
        effective: { assessment: null, documents: TEXT, preview: 'gpt-4.1', rewrite: TEXT },
      },
    });
  });

  it('turns refusals, bad replies and a silent runner into plain sentences', async () => {
    const forbidden = await loadModels(fakeFetch({ status: 403, body: { error: 'nope', code: 'ERR_FORBIDDEN' } }).impl);
    expect(forbidden).toEqual({
      ok: false,
      message: 'Only the tool user can change the AI models.',
      code: 'ERR_FORBIDDEN',
    });
    const bad = await loadModels(fakeFetch({ status: 200, body: { models: [] } }).impl);
    expect(bad).toEqual({ ok: false, message: 'The AI models could not be loaded. Try again.' });
    const silent = await saveModels({ models: {} }, fakeFetch(new Error('ECONNREFUSED')).impl);
    expect(!silent.ok && silent.message).toMatch(/not answering/);
    const failed = await saveModels({ models: {} }, fakeFetch({ status: 500, body: {} }).impl);
    expect(failed).toEqual({ ok: false, message: 'The AI models could not be saved. Try again.' });
  });

  it('keeps a __proto__ field message as a plain field', async () => {
    const body = '{"errors":{"__proto__":"Unknown AI stage."}}';
    const impl = async () => new Response(body, { status: 400 });
    const outcome = await saveModels({ models: {} }, impl);
    expect(!outcome.ok && Object.getPrototypeOf(outcome.errors)).toBe(Object.prototype);
    expect(!outcome.ok && Object.keys(outcome.errors ?? {})).toEqual(['__proto__']);
  });

  it('stays in step with the stages, slots and route of @qa/types ai.ts', () => {
    const source = readFileSync(new URL('../../types/src/ai.ts', import.meta.url), 'utf8');
    const stages = source.match(/export const AUDIT_AI_STAGES = \[([^\]]*)\]/)?.[1] ?? '';
    expect([...stages.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...AUDIT_AI_STAGES]);
    const slots = source.match(/export const STAGE_MODEL_SLOT[^{]*\{([\s\S]*?)\};/)?.[1] ?? '';
    for (const stage of AUDIT_AI_STAGES) {
      expect(slots, stage).toMatch(new RegExp(`\\b'?${stage}'?: '${STAGE_DEFAULT_SLOT[stage]}'`));
    }
    expect(source).toContain(`getModels: { method: 'GET', path: '${AUDIT_AI_MODELS_ROUTE.get.path}'`);
    expect(source).toContain(`putModels: { method: 'PUT', path: '${AUDIT_AI_MODELS_ROUTE.put.path}'`);
    expect(source).toMatch(/effective: Record<AuditAiStage, string \| null>/);
    expect(source).toMatch(/defaults: \{ text: string \| null; vision: string \| null \}/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Accessible markup and wording
// ---------------------------------------------------------------------------------------------------

const AVOID_WORDS =
  /\b(reports?|plans?|quotas?|limits?|the three audit documents|deliverables?|scan\w*|site review|teardown|model wrapper|ai client|pitch deck|teaser)\b/i;

describe('accessible markup and wording', () => {
  const views = {
    view: view(),
    saving: view({ saving: true, draft: { ...draftFrom(modelsReply()), preview: 'x' } }),
    refused: view({ errors: { rewrite: 'x' }, message: { tone: 'fail', text: FIX_FIELDS } }),
    screen: renderToStaticMarkup(createElement(AuditAiModelsPanel, {})),
  };

  it('uses real buttons with names, and no positive tabindex', () => {
    for (const [name, html] of Object.entries(views)) {
      for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const [, attrs, inner] = match;
        expect(attrs, name).toContain('type="button"');
        expect(/aria-label="[^"]+"/.test(attrs) || textOf(inner).trim() !== '', `${name}: ${match[0]}`).toBe(true);
      }
      expect(html, name).not.toMatch(/tabindex="-?[1-9]/);
    }
  });

  it('uses no Avoid word in UI text', () => {
    const shown = [...Object.values(views).map(textOf), ...Object.values(STAGE_TEXT).flatMap((t) => [t.label, t.hint])];
    for (const text of shown) expect(text).not.toMatch(AVOID_WORDS);
  });

  it('uses the CONTEXT.md terms and shows the loading state first', () => {
    const text = textOf(views.view);
    for (const term of ['AI Provider', 'Website Audit', 'Pitch Glimpse', 'Audit Documents', 'Section'])
      expect(text).toContain(term);
    expect(views.screen).toContain('Loading the AI models');
  });
});

// ---------------------------------------------------------------------------------------------------
// Imports (T-211)
// ---------------------------------------------------------------------------------------------------

describe('imports (T-211)', () => {
  it('reaches @qa/types through browser.js only, and imports no Node-only module', () => {
    const dir = new URL('../src/screens/audit/ai/', import.meta.url);
    for (const file of ['AuditAiModelsPanel.tsx', 'stage-models-api.ts']) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      for (const m of source.matchAll(/from '(@qa\/types[^']*)'/g)) expect(m[1], file).toBe('@qa/types/src/browser.js');
      for (const m of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
        expect(m[1], file).toMatch(/^(react$|@qa\/types\/src\/browser\.js$|\.)/);
      }
    }
  });
});
