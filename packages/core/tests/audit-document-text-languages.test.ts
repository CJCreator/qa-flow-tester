import { describe, it, expect } from 'vitest';
import { DOCUMENT_LANGUAGES, DOCUMENT_LANGUAGE_INFO, type DocumentLanguage } from '@qa/types';
import { en } from '../src/audit/documents/labels/en.js';
import {
  betaLabel,
  documentDirection,
  documentText,
  flattenLabels,
  labelsFor,
  type DocumentTextKey,
} from '../src/audit/documents/labels/index.js';

const enEntries = flattenLabels(en);
const keys = enEntries.map(([k]) => k as DocumentTextKey);
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Proper nouns and code that stay as written in every language. */
const KEPT_AS_IS = /WCAG 2\.2 AA|robots\.txt|\bAI\b|\{\w+\}/g;

const NINE: Array<[DocumentLanguage, RegExp]> = [
  ['te', /[ఀ-౿]/u],
  ['kn', /[ಀ-೿]/u],
  ['ml', /[ഀ-ൿ]/u],
  ['mr', /[ऀ-ॿ]/u],
  ['gu', /[઀-૿]/u],
  ['bn', /[ঀ-৿]/u],
  ['or', /[଀-୿]/u],
  ['pa', /[਀-੿]/u],
  ['ur', /[؀-ۿ]/u],
];

/** The text for every key through `documentText`, filling each placeholder with a sample value. */
function textsFor(lang: DocumentLanguage): Array<[string, string]> {
  return keys.map((key) => {
    const vars = Object.fromEntries(placeholders(enEntries.find(([k]) => k === key)![1]).map((n) => [n, 3]));
    return [key, documentText(lang, key, vars)];
  });
}

describe('document text in every DocumentLanguage (REQ-032)', () => {
  it('documentText returns non-empty text for every key in every language, with the English {variables}', () => {
    expect(DOCUMENT_LANGUAGES.length).toBe(12);
    for (const lang of DOCUMENT_LANGUAGES) {
      for (const key of keys) {
        const enValue = enEntries.find(([k]) => k === key)![1];
        const vars = Object.fromEntries(placeholders(enValue).map((n) => [n, 7]));
        const text = documentText(lang, key, vars);
        expect(text.trim(), `${lang} ${key}`).not.toBe('');
      }
    }
  });

  it.each(NINE)('%s is not the English table and has the same {variables} per key', (lang) => {
    for (const [key, enValue] of enEntries) {
      const raw = documentText(lang, key as DocumentTextKey, Object.fromEntries(placeholders(enValue).map((n) => [n, '{' + n + '}'])));
      expect(placeholders(raw), `${lang} ${key}`).toEqual(placeholders(enValue));
      if (/[A-Za-z]{3,}/.test(enValue.replace(KEPT_AS_IS, ''))) {
        expect(raw, `${lang} ${key} is still English`).not.toBe(enValue);
      }
    }
  });

  it.each(NINE)('%s is in its own script apart from proper nouns, NFC, with no U+FFFD', (lang, script) => {
    for (const [key, value] of textsFor(lang)) {
      expect(value, `${lang} ${key}`).toMatch(script);
      expect(value.replace(KEPT_AS_IS, '').replace(/\d+/g, ''), `${lang} ${key}: Latin text`).not.toMatch(/[A-Za-z]/);
      expect(value.includes('�'), `${lang} ${key}`).toBe(false);
      expect(value.normalize('NFC'), `${lang} ${key}`).toBe(value);
    }
  });

  it('labels each of the nine as beta, in its own script, and only Urdu as right-to-left', () => {
    for (const [lang, script] of NINE) {
      expect(DOCUMENT_LANGUAGE_INFO[lang].beta, lang).toBe(true);
      expect(betaLabel(lang).trim(), lang).not.toBe('');
      expect(betaLabel(lang), lang).toMatch(script);
      expect(documentDirection(lang), lang).toBe(lang === 'ur' ? 'rtl' : 'ltr');
    }
    expect(DOCUMENT_LANGUAGES.filter((l) => documentDirection(l) === 'rtl')).toEqual(['ur']);
  });

  it('keeps the nine on the English document with the beta note until they are document-ready (DEC-005)', () => {
    for (const [lang] of NINE) {
      expect(labelsFor(lang), lang).toEqual({ labels: en, requested: lang, language: 'en', fallback: true });
    }
  });
});
