import { describe, it, expect } from 'vitest';
import { DEFAULT_REWRITE_OVERLAP_WORDS } from '@qa/types';
import {
  applySettingsUpdate,
  auditSettingsDefaults,
  defaultProposalTemplate,
  emptyAuditSettings,
  resolveAuditSettings,
  MAX_COMPANY_FIELD_CHARS,
  MAX_OPT_OUT_TEXT_CHARS,
  MAX_PROPOSAL_TEMPLATE_CHARS,
  type StoredAuditSettings,
} from '../src/audit/documents/settings.js';
import { defaultOptOutText, OPT_OUT_TEXT_EN, OPT_OUT_TEXT_TA } from '../src/audit/documents/templates/opt-out.js';
import { PROPOSAL_TEMPLATE_EN } from '../src/audit/documents/templates/proposal-en.js';
import { PROPOSAL_TEMPLATE_TA } from '../src/audit/documents/templates/proposal-ta.js';
import { findClaimWords } from '../src/audit/documents/wording.js';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Applies an update, failing the test when it is refused. */
function applied(current: StoredAuditSettings, update: unknown) {
  const result = applySettingsUpdate(current, update);
  if (!result.ok) throw new Error(`update refused: ${JSON.stringify(result.errors)}`);
  return result;
}

describe('auditSettingsDefaults', () => {
  it('has English and Tamil opt-out text and Proposal templates, non-empty and without ADR 0018 words', () => {
    const defaults = auditSettingsDefaults();
    expect(defaults.optOutText.en).toBe(OPT_OUT_TEXT_EN);
    expect(defaults.optOutText.ta).toBe(OPT_OUT_TEXT_TA);
    expect(defaults.proposalTemplate).toBe(PROPOSAL_TEMPLATE_EN);
    expect(defaultProposalTemplate('ta')).toBe(PROPOSAL_TEMPLATE_TA);
    expect(defaults.rewriteOverlapWords).toBe(DEFAULT_REWRITE_OVERLAP_WORDS);
    for (const text of [OPT_OUT_TEXT_EN, OPT_OUT_TEXT_TA, PROPOSAL_TEMPLATE_EN, PROPOSAL_TEMPLATE_TA]) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(findClaimWords(text)).toEqual([]);
    }
    // The Tamil texts are written in Tamil script.
    expect(OPT_OUT_TEXT_TA).toMatch(/[஀-௿]/);
    expect(PROPOSAL_TEMPLATE_TA).toMatch(/[஀-௿]/);
  });

  it('returns a fresh copy each time, and other languages fall back to English', () => {
    const a = auditSettingsDefaults();
    a.optOutText.en = 'changed';
    expect(auditSettingsDefaults().optOutText.en).toBe(OPT_OUT_TEXT_EN);
    expect(defaultOptOutText('hi')).toBe(OPT_OUT_TEXT_EN);
    expect(defaultProposalTemplate('hi')).toBe(PROPOSAL_TEMPLATE_EN);
  });

  it('resolves empty stored settings to the defaults', () => {
    const settings = resolveAuditSettings(emptyAuditSettings(), false);
    expect(settings).toEqual({
      optOutText: { en: OPT_OUT_TEXT_EN, ta: OPT_OUT_TEXT_TA },
      company: { name: '', address: '', phone: '', email: '', website: '', terms: '' },
      proposalTemplate: PROPOSAL_TEMPLATE_EN,
      rewriteOverlapWords: DEFAULT_REWRITE_OVERLAP_WORDS,
      pagespeedKeySaved: false,
    });
  });
});

describe('applySettingsUpdate', () => {
  it('saves a new template, reads it back, and null puts the default back', () => {
    const current = deepFreeze(emptyAuditSettings());
    const template = '# My offer for {{site.url}}\n\n{{scope}}\n';
    const saved = applied(current, { proposalTemplate: template });
    expect(saved.settings.proposalTemplate).toBe(template);
    expect(resolveAuditSettings(saved.settings, false).proposalTemplate).toBe(template);

    const reset = applied(saved.settings, { proposalTemplate: null });
    expect('proposalTemplate' in reset.settings).toBe(false);
    expect(resolveAuditSettings(reset.settings, false).proposalTemplate).toBe(PROPOSAL_TEMPLATE_EN);
  });

  it('saves opt-out text per language; null puts that language\'s default back', () => {
    const current = deepFreeze(emptyAuditSettings());
    const saved = applied(current, { optOutText: { ta: 'புதிய உரை', en: 'Reply STOP to us.' } });
    expect(resolveAuditSettings(saved.settings, false).optOutText).toEqual({ en: 'Reply STOP to us.', ta: 'புதிய உரை' });

    const reset = applied(saved.settings, { optOutText: { ta: null } });
    expect(reset.settings.optOutText).toEqual({ en: 'Reply STOP to us.' });
    expect(resolveAuditSettings(reset.settings, false).optOutText.ta).toBe(OPT_OUT_TEXT_TA);
  });

  it('changes only the company fields sent, allows clearing one, and saves the overlap words', () => {
    const first = applied(deepFreeze(emptyAuditSettings()), {
      company: { name: 'Kavi Web Works', phone: '044 9876 5432' },
    });
    const second = applied(deepFreeze(first.settings), { company: { phone: '' }, rewriteOverlapWords: 8 });
    expect(second.settings.company).toEqual({
      name: 'Kavi Web Works',
      address: '',
      phone: '',
      email: '',
      website: '',
      terms: '',
    });
    expect(resolveAuditSettings(second.settings, true)).toMatchObject({ rewriteOverlapWords: 8, pagespeedKeySaved: true });
  });

  it('passes the PageSpeed key through untouched and never stores it', () => {
    const key = '  AIza-test-value  ';
    const result = applied(deepFreeze(emptyAuditSettings()), { pagespeedKey: key });
    expect(result.pagespeedKey).toBe(key);
    expect(JSON.stringify(result.settings)).not.toContain('AIza');

    const removed = applied(deepFreeze(emptyAuditSettings()), { pagespeedKey: null });
    expect(removed.pagespeedKey).toBeNull();
    expect('pagespeedKey' in applied(emptyAuditSettings(), {})).toBe(false);
  });

  const invalid: Array<[string, unknown, string[]]> = [
    ['a body that is not an object', 'x', ['body']],
    ['an unknown key', { theme: 'dark' }, ['theme']],
    ['a template of the wrong type', { proposalTemplate: 42 }, ['proposalTemplate']],
    ['an empty template', { proposalTemplate: '   ' }, ['proposalTemplate']],
    ['an over-long template', { proposalTemplate: 'x'.repeat(MAX_PROPOSAL_TEMPLATE_CHARS + 1) }, ['proposalTemplate']],
    ['a template with a control character', { proposalTemplate: 'a\u0007b' }, ['proposalTemplate']],
    ['opt-out text that is not an object', { optOutText: 'hello' }, ['optOutText']],
    ['an unknown language', { optOutText: { xx: 'hello' } }, ['optOutText.xx']],
    ['over-long opt-out text', { optOutText: { en: 'x'.repeat(MAX_OPT_OUT_TEXT_CHARS + 1) } }, ['optOutText.en']],
    ['opt-out text of the wrong type', { optOutText: { ta: 5 } }, ['optOutText.ta']],
    ['company that is not an object', { company: null }, ['company']],
    ['an unknown company field', { company: { fax: '1' } }, ['company.fax']],
    ['an over-long company name', { company: { name: 'x'.repeat(MAX_COMPANY_FIELD_CHARS + 1) } }, ['company.name']],
    ['a company field of the wrong type', { company: { email: ['a'] } }, ['company.email']],
    ['non-integer overlap words', { rewriteOverlapWords: 2.5 }, ['rewriteOverlapWords']],
    ['zero overlap words', { rewriteOverlapWords: 0 }, ['rewriteOverlapWords']],
    ['negative overlap words', { rewriteOverlapWords: -3 }, ['rewriteOverlapWords']],
    ['overlap words as text', { rewriteOverlapWords: '6' }, ['rewriteOverlapWords']],
    ['overlap words as null', { rewriteOverlapWords: null }, ['rewriteOverlapWords']],
    ['a PageSpeed key of the wrong type', { pagespeedKey: 123 }, ['pagespeedKey']],
  ];

  for (const [name, update, fields] of invalid) {
    it(`refuses ${name} with field errors`, () => {
      const result = applySettingsUpdate(deepFreeze(emptyAuditSettings()), update);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual([...fields].sort());
    });
  }

  it('changes nothing when any field is refused', () => {
    const base = applied(emptyAuditSettings(), { proposalTemplate: 'Mine {{scope}}', company: { name: 'Kavi' } }).settings;
    const before = structuredClone(base);
    const result = applySettingsUpdate(deepFreeze(base), {
      proposalTemplate: 'New {{scope}}',
      company: { name: 'Other' },
      optOutText: { en: null },
      rewriteOverlapWords: 1.5,
      pagespeedKey: 'secret-value',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toEqual(['rewriteOverlapWords']);
      expect(JSON.stringify(result.errors)).not.toContain('secret-value');
    }
    expect(base).toEqual(before);
  });

  it('never repeats a refused PageSpeed key in its message', () => {
    const key = `k${'x'.repeat(600)}`;
    const result = applySettingsUpdate(emptyAuditSettings(), { pagespeedKey: key });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.errors)).not.toContain(key.slice(0, 20));
  });
});
