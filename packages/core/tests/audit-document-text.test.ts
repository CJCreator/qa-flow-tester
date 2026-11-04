import { describe, it, expect } from 'vitest';
import type { DocumentLanguage } from '@qa/types';
import { en } from '../src/audit/documents/labels/en.js';
import { ta } from '../src/audit/documents/labels/ta.js';
import { hi } from '../src/audit/documents/labels/hi.js';
import {
  betaLabel,
  documentDirection,
  documentText,
  flattenLabels,
  labelLanguages,
  labelsFor,
  type DocumentTextKey,
} from '../src/audit/documents/labels/index.js';
import { findClaimWords } from '../src/audit/documents/wording.js';

const TABLES = { en, ta, hi };
const enEntries = flattenLabels(en);
const keys = enEntries.map(([k]) => k as DocumentTextKey);
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Proper nouns and code that stay as written in every language. */
const KEPT_AS_IS = /WCAG 2\.2 AA|robots\.txt|\bAI\b|\{\w+\}/g;

describe('Document text tables (en, ta, hi)', () => {
  it('every key has a non-empty string in each language, with the same {variables} as English', () => {
    expect(keys.length).toBeGreaterThan(50);
    for (const [lang, table] of Object.entries(TABLES)) {
      const entries = flattenLabels(table);
      expect(entries.map(([k]) => k), lang).toEqual(keys);
      for (const [key, value] of entries) {
        expect(typeof value, `${lang} ${key}`).toBe('string');
        expect(value.trim(), `${lang} ${key}`).not.toBe('');
        const enValue = enEntries.find(([k]) => k === key)![1];
        expect(placeholders(value), `${lang} ${key}`).toEqual(placeholders(enValue));
      }
    }
    expect(placeholders(en.phases.numbered)).toEqual(['n']);
  });

  it('Tamil is in Tamil script and Hindi in Devanagari, apart from proper nouns and code', () => {
    const scripts: Array<[string, typeof en, RegExp]> = [
      ['ta', ta, /[஀-௿]/u],
      ['hi', hi, /[ऀ-ॿ]/u],
    ];
    for (const [lang, table, script] of scripts) {
      for (const [key, value] of flattenLabels(table)) {
        expect(value, `${lang} ${key}`).toMatch(script);
        expect(value.replace(KEPT_AS_IS, ''), `${lang} ${key}: Latin text outside proper nouns`).not.toMatch(/[A-Za-z]/);
      }
    }
  });

  it('no string has U+FFFD and every string is NFC', () => {
    for (const [lang, table] of Object.entries(TABLES)) {
      for (const [key, value] of flattenLabels(table)) {
        expect(value.includes('�'), `${lang} ${key}`).toBe(false);
        expect(value.normalize('NFC'), `${lang} ${key}`).toBe(value);
      }
    }
  });

  it('English uses none of the CONTEXT.md Avoid terms and no ADR 0018 claim words', () => {
    const avoid = [
      // Website Audit
      /\bcheck-?ups?\b/i, /\bscans?\b/i, /\bruns?\b/i, /\bsite reviews?\b/i, /\bteardowns?\b/i, /\bprojects?\b/i,
      // Audit Document
      /\breports?\b/i, /\bdeliverables?\b/i, /\bthe three audit documents\b/i,
      // Improvement Roadmap
      /\bplans?\b/i, /\benhancement plans?\b/i, /\baction plans?\b/i, /\bbacklogs?\b/i, /\bto-?do lists?\b/i,
      // Pitch Glimpse
      /\bpitch decks?\b/i, /\bsales sheets?\b/i, /\bteasers?\b/i, /\bsummary reports?\b/i, /\bcold emails?\b/i,
      // Owner Audit
      /\bowner reports?\b/i, /\bowner versions?\b/i, /\bclient cop(y|ies)\b/i, /\bfree audits?\b/i,
      // ADR 0018
      /\bcompliant\b/i, /\bsecure\b/i, /\bpasses\b/i, /\baccessible\b/i,
    ];
    for (const [key, value] of enEntries) {
      for (const term of avoid) expect(value, `${key}: ${term}`).not.toMatch(term);
    }
    for (const [lang, table] of Object.entries(TABLES)) {
      for (const [key, value] of flattenLabels(table)) expect(findClaimWords(value), `${lang} ${key}`).toEqual([]);
    }
  });
});

describe('documentText', () => {
  it('returns the text of the asked language for every key', () => {
    for (const [lang, table] of Object.entries(TABLES) as Array<[DocumentLanguage, typeof en]>) {
      const byKey = new Map(flattenLabels(table));
      for (const key of keys) {
        if (key === 'phases.numbered') continue;
        expect(documentText(lang, key), `${lang} ${key}`).toBe(byKey.get(key));
      }
    }
    expect(documentText('ta', 'documentTitles.roadmap')).toBe(ta.documentTitles.roadmap);
    expect(documentText('hi', 'documentTitles.roadmap')).toBe('सुधार रोडमैप');
    expect(documentText('hi', 'scale.high')).toBe(hi.scale.high);
    expect(documentText('en', 'actions.redesign')).toBe('Redesign');
  });

  it('fills named variables and throws when one is missing', () => {
    expect(documentText('en', 'phases.numbered', { n: 2 })).toBe('Phase 2');
    expect(documentText('ta', 'phases.numbered', { n: 3 })).toBe('கட்டம் 3');
    expect(documentText('hi', 'phases.numbered', { n: 1 })).toBe('चरण 1');
    expect(() => documentText('hi', 'phases.numbered')).toThrow(/\{n\}/);
  });

  it('throws, naming the language, for a code with no registered table (no English fallback)', () => {
    const unknown = 'xx' as DocumentLanguage;
    expect(() => documentText(unknown, 'scale.high')).toThrow(/"xx"/);
    expect(() => documentText('__proto__' as DocumentLanguage, 'scale.high')).toThrow(/__proto__/);
    expect(() => documentText('toString' as DocumentLanguage, 'scale.high')).toThrow(/toString/);
  });

  it('throws for a key the table does not have', () => {
    expect(() => documentText('hi', 'scale.huge' as DocumentTextKey)).toThrow(/scale\.huge/);
    expect(() => documentText('en', 'scale' as DocumentTextKey)).toThrow(/scale/);
    expect(() => documentText('en', 'scale.constructor' as DocumentTextKey)).toThrow();
  });

  it('labelsFor falls back to the English table for Hindi until it is document-ready (DEC-005)', () => {
    expect(labelsFor('hi')).toEqual({ labels: en, requested: 'hi', language: 'en', fallback: true });
    expect(labelLanguages().sort()).toEqual(['bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te', 'ur']);
  });
});

describe('betaLabel and documentDirection', () => {
  it('labels Hindi as beta, in Hindi, and not English or Tamil (Q-45)', () => {
    expect(betaLabel('hi')).toBe(hi.status.betaTranslation);
    expect(betaLabel('hi').trim()).not.toBe('');
    expect(betaLabel('ta')).toBe('');
    expect(betaLabel('en')).toBe('');
    expect(() => betaLabel('xx' as DocumentLanguage)).toThrow(/"xx"/);
  });

  it('gives the writing direction from DOCUMENT_LANGUAGE_INFO', () => {
    expect(documentDirection('en')).toBe('ltr');
    expect(documentDirection('ta')).toBe('ltr');
    expect(documentDirection('hi')).toBe('ltr');
    expect(documentDirection('ur')).toBe('rtl');
    expect(() => documentDirection('xx' as DocumentLanguage)).toThrow(/"xx"/);
  });
});
