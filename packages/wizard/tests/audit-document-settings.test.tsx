import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditSettingsReply } from '@qa/types/src/browser.js';
import {
  PROPOSAL_PLACEHOLDERS,
  draftFrom,
  isUpdateEmpty,
  loadSettings,
  optOutInEffect,
  resetOptOutText,
  resetProposalTemplate,
  saveSettings,
  settingsUpdate,
  type SettingsDraft,
} from '../src/screens/audit/documents/settings-api';
import {
  DocumentSettingsScreen,
  DocumentSettingsView,
  type DocumentSettingsViewProps,
} from '../src/screens/audit/documents/DocumentSettingsScreen';

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const DEFAULT_TEMPLATE = '# Proposal for {{site.url}}\n\n{{scope}}\n\nPrice: {{price}}';
const DEFAULT_EN = 'If you would rather not hear from us again, tell us and we will not contact you.';
const DEFAULT_TA = 'இனி எங்களிடமிருந்து செய்தி வேண்டாம் என்றால் சொல்லுங்கள்.';

function settingsReply(over: Partial<AuditSettingsReply['settings']> = {}): AuditSettingsReply {
  return {
    settings: {
      optOutText: {},
      company: {
        name: 'Kavi Web Works',
        address: '12 Anna Salai, Chennai',
        phone: '+91 44 0000 0000',
        email: 'hello@kavi.example',
        website: 'https://kavi.example',
        terms: 'Half up front.',
      },
      proposalTemplate: DEFAULT_TEMPLATE,
      rewriteOverlapWords: 6,
      pagespeedKeySaved: false,
      ...over,
    },
    defaults: { optOutText: { en: DEFAULT_EN, ta: DEFAULT_TA }, proposalTemplate: DEFAULT_TEMPLATE, rewriteOverlapWords: 6 },
  };
}

const noop = () => {};

function view(props: Partial<DocumentSettingsViewProps> = {}): string {
  const reply = props.reply ?? settingsReply();
  return renderToStaticMarkup(
    createElement(DocumentSettingsView, {
      reply,
      draft: draftFrom(reply),
      saving: false,
      message: null,
      onDraft: noop,
      onSave: noop,
      onDiscard: noop,
      onReset: noop,
      ...props,
    })
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

/** A fetch that records each call and answers with the next queued reply. */
function fakeFetch(...replies: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error('no reply queued');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { impl, calls };
}

// ---------------------------------------------------------------------------------------------------
// AC-3: Proposal template save and "put the default back"
// ---------------------------------------------------------------------------------------------------

describe('Proposal template (REQ-027)', () => {
  it('sends the new template in the PUT body, and only what changed', async () => {
    const reply = settingsReply();
    const draft: SettingsDraft = { ...draftFrom(reply), proposalTemplate: '# Our offer\n\n{{timeline}}' };
    const update = settingsUpdate(reply, draft);
    expect(update).toEqual({ proposalTemplate: '# Our offer\n\n{{timeline}}' });

    const saved = settingsReply({ proposalTemplate: '# Our offer\n\n{{timeline}}' });
    const { impl, calls } = fakeFetch({ status: 200, body: saved });
    expect(await saveSettings(update, impl)).toEqual({ ok: true, value: saved });
    expect(calls[0].url).toBe('/api/audit-settings');
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ proposalTemplate: '# Our offer\n\n{{timeline}}' });
  });

  it('sends null to put the default template back', async () => {
    expect(resetProposalTemplate()).toEqual({ proposalTemplate: null });
    const { impl, calls } = fakeFetch({ status: 200, body: settingsReply() });
    await saveSettings(resetProposalTemplate(), impl);
    expect(calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ proposalTemplate: null });
  });

  it('shows the template in a labelled field, a put-the-default-back control and every placeholder', () => {
    const html = view();
    expect(html).toMatch(/<label for="settings-proposal-template"[^>]*>Proposal template \(Markdown\)<\/label>/);
    expect(html).toMatch(/<textarea id="settings-proposal-template"[^>]*>[\s\S]*Proposal for \{\{site\.url\}\}/);
    expect(html).toContain('aria-label="Put the default Proposal template back"');
    for (const p of PROPOSAL_PLACEHOLDERS) {
      expect(html).toContain(`<code>{{${p.name}}}</code>`);
      expect(textOf(html)).toContain(decode(p.description));
    }
  });

  it('lists the same placeholders as the Proposal filler of @qa/core', () => {
    const source = readFileSync(new URL('../../core/src/audit/documents/proposal.ts', import.meta.url), 'utf8');
    const block = source.match(/export const PROPOSAL_PLACEHOLDERS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
    const coreNames = [...block.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
    expect(coreNames.length).toBeGreaterThan(0);
    expect(PROPOSAL_PLACEHOLDERS.map((p) => p.name)).toEqual(coreNames);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-4: opt-out text per language
// ---------------------------------------------------------------------------------------------------

describe('opt-out text (REQ-019, REQ-018)', () => {
  it('shows English and Tamil opt-out text in labelled fields, each with its default', () => {
    const html = view();
    expect(html).toMatch(/<label for="settings-optout-en"[^>]*>Opt-out text in English<\/label>/);
    expect(html).toMatch(/<label for="settings-optout-ta"[^>]*>Opt-out text in Tamil<\/label>/);
    expect(html).toMatch(/<textarea id="settings-optout-ta"[^>]*lang="ta"/);
    const text = textOf(html);
    expect(text).toContain('Default text in English');
    expect(text).toContain('Default text in Tamil');
    expect(text).toContain(DEFAULT_EN);
    expect(text).toContain(DEFAULT_TA);
    expect(html).toContain('aria-label="Put the default English opt-out text back"');
    expect(html).toContain('aria-label="Put the default Tamil opt-out text back"');
  });

  it('says the tool user owns checking the text', () => {
    expect(textOf(view())).toMatch(/You own checking it/);
  });

  it('fills a field with the saved text, else the default, and sends only the changed language', () => {
    const reply = settingsReply({ optOutText: { en: 'Reply STOP and we will not write again.' } });
    expect(optOutInEffect(reply, 'en')).toBe('Reply STOP and we will not write again.');
    expect(optOutInEffect(reply, 'ta')).toBe(DEFAULT_TA);
    const html = view({ reply });
    expect(html).toMatch(/<textarea id="settings-optout-en"[^>]*>Reply STOP and we will not write again\.<\/textarea>/);
    expect(textOf(html)).toContain(DEFAULT_EN);

    const draft = draftFrom(reply);
    expect(isUpdateEmpty(settingsUpdate(reply, draft))).toBe(true);
    const edited = { ...draft, optOutText: { ...draft.optOutText, ta: 'புதிய உரை' } };
    expect(settingsUpdate(reply, edited)).toEqual({ optOutText: { ta: 'புதிய உரை' } });
    expect(resetOptOutText('en')).toEqual({ optOutText: { en: null } });
  });
});

// ---------------------------------------------------------------------------------------------------
// Company details
// ---------------------------------------------------------------------------------------------------

describe('company details', () => {
  it('edits every company field and sends only the changed ones', () => {
    const html = view();
    for (const field of ['name', 'address', 'phone', 'email', 'website', 'terms']) {
      expect(html).toContain(`<label for="settings-company-${field}"`);
    }
    expect(html).toMatch(/<input id="settings-company-email" type="email"/);
    const reply = settingsReply();
    const draft = draftFrom(reply);
    const update = settingsUpdate(reply, { ...draft, company: { ...draft.company, phone: '+91 44 1111 1111' } });
    expect(update).toEqual({ company: { phone: '+91 44 1111 1111' } });
  });

  it('enables the save only when something changed, and shows the saved and failed states', () => {
    const reply = settingsReply();
    const clean = view();
    expect(clean).toMatch(/<button type="button" class="btn-primary[^"]*" disabled="">Save document settings<\/button>/);
    expect(textOf(clean)).toContain('Every change is saved.');
    const changed = view({ draft: { ...draftFrom(reply), proposalTemplate: 'x' } });
    expect(changed).toMatch(/<button type="button" class="btn-primary[^"]*">Save document settings<\/button>/);
    expect(textOf(changed)).toContain('You have changes that are not saved yet.');
    expect(view({ message: { tone: 'fail', text: 'Only the tool user can change the document settings.' } })).toContain('role="alert"');
    expect(view({ message: { tone: 'pass', text: 'Document settings saved. New exports use them.' } })).toContain('role="status"');
  });
});

// ---------------------------------------------------------------------------------------------------
// The calls to the runner
// ---------------------------------------------------------------------------------------------------

describe('settings-api', () => {
  it('loads with GET /api/audit-settings', async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: settingsReply() });
    expect(await loadSettings(impl)).toEqual({ ok: true, value: settingsReply() });
    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([['GET', '/api/audit-settings']]);
  });

  it('turns refusals, bad replies and a silent runner into plain sentences', async () => {
    const { impl } = fakeFetch(
      { status: 403, body: { error: 'x', code: 'ERR_FORBIDDEN' } },
      { status: 400, body: { error: 'The Proposal template is too long.', code: 'ERR_INVALID_REQUEST' } },
      { status: 200, body: { nope: true } },
      new Error('offline')
    );
    expect(await saveSettings({}, impl)).toMatchObject({ ok: false, code: 'ERR_FORBIDDEN', message: expect.stringMatching(/tool user/) });
    expect(await saveSettings({ proposalTemplate: 'x' }, impl)).toEqual({
      ok: false,
      message: 'The Proposal template is too long.',
      code: 'ERR_INVALID_REQUEST',
    });
    expect(await loadSettings(impl)).toEqual({ ok: false, message: 'The document settings could not be loaded. Try again.' });
    expect(await loadSettings(impl)).toMatchObject({ ok: false, message: expect.stringMatching(/not answering/) });
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-5: markup and wording
// ---------------------------------------------------------------------------------------------------

/** Avoid words of CONTEXT.md for Audit Document, Improvement Roadmap, Pitch Glimpse and Owner Audit. */
const AVOID_WORDS =
  /\b(reports?|plans?|the three audit documents|enhancement plan|action plan|pitch deck|owner reports?|owner version|client copy|free audit|sales sheet|teaser|cold email|deliverables?|scan\w*|site review|teardown)\b/i;

describe('accessible markup and wording', () => {
  const views = {
    view: view(),
    saving: view({ saving: true, draft: { ...draftFrom(settingsReply()), proposalTemplate: 'x' } }),
    screen: renderToStaticMarkup(createElement(DocumentSettingsScreen, {})),
  };

  it('gives every input and textarea a label', () => {
    const html = views.view;
    const fields = [...html.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((m) => m[0]);
    expect(fields.length).toBe(1 + 2 + 6);
    for (const field of fields) {
      const id = field.match(/\sid="([^"]+)"/)?.[1];
      expect(id && html.includes(`<label for="${id}"`), field).toBe(true);
    }
  });

  it('gives every button a name, and every button is a real button', () => {
    for (const [name, html] of Object.entries(views)) {
      for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const [, attrs, inner] = match;
        expect(attrs, name).toContain('type="button"');
        expect(/aria-label="[^"]+"/.test(attrs) || textOf(inner).trim() !== '', `${name}: ${match[0]}`).toBe(true);
      }
    }
    expect(views.view).not.toMatch(/tabindex="-?[1-9]/);
  });

  it('uses no Avoid word in UI text', () => {
    for (const [name, html] of Object.entries(views)) {
      expect(textOf(html), name).not.toMatch(AVOID_WORDS);
      expect(html.match(/aria-label="[^"]*"/g)?.join(' ') ?? '', name).not.toMatch(AVOID_WORDS);
    }
  });

  it('uses the CONTEXT.md terms and shows the loading state first', () => {
    const text = textOf(views.view) + textOf(views.screen);
    for (const term of ['Proposal', 'Pitch Glimpse', 'Improvement Roadmap', 'Website Audit']) expect(text).toContain(term);
    expect(views.screen).toContain('<h1');
    expect(views.screen).toContain('Loading the document settings');
  });
});

// ---------------------------------------------------------------------------------------------------
// Imports (T-211)
// ---------------------------------------------------------------------------------------------------

describe('imports (T-211)', () => {
  it('reaches @qa/types through browser.js only, and imports no Node-only module', () => {
    const dir = new URL('../src/screens/audit/documents/', import.meta.url);
    for (const file of ['DocumentSettingsScreen.tsx', 'settings-api.ts']) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      const types = [...source.matchAll(/from '(@qa\/types[^']*)'/g)].map((m) => m[1]);
      expect(types.length, file).toBeGreaterThan(0);
      for (const specifier of types) expect(specifier, file).toBe('@qa/types/src/browser.js');
      for (const m of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
        expect(m[1], file).toMatch(/^(react$|@qa\/types\/src\/browser\.js$|\.)/);
      }
    }
    const test = readFileSync(new URL('./audit-document-settings.test.tsx', import.meta.url), 'utf8');
    for (const m of test.matchAll(/from '(@qa\/types[^']*)'/g)) expect(m[1]).toBe('@qa/types/src/browser.js');
  });
});
