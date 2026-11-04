/**
 * The fixed document wording per `DocumentLanguage`, the one source of fixed text for every Audit Document,
 * the Pitch Glimpse and the Owner Audit. Every `DocumentLanguage` has a table; all but English and Tamil are
 * labelled beta (Q-45).
 *
 * Two ways in: `labelsFor` returns a whole table and falls back to English with `fallback: true` for a
 * language without one, so G7 (REQ-032) can see which tables are missing; `documentText` returns one
 * string and throws for a language without a table or a key the table lacks (never a silent English fallback).
 */

import { DOCUMENT_LANGUAGE_INFO, type DocumentLanguage } from '@qa/types';
import { en, type DocumentLabels } from './en.js';
import { ta } from './ta.js';
import { hi } from './hi.js';
import { te } from './te.js';
import { kn } from './kn.js';
import { ml } from './ml.js';
import { mr } from './mr.js';
import { gu } from './gu.js';
import { bn } from './bn.js';
import { or } from './or.js';
import { pa } from './pa.js';
import { ur } from './ur.js';

export type { DocumentLabels } from './en.js';

const TABLES: Partial<Record<DocumentLanguage, DocumentLabels>> = { en, ta, hi, te, kn, ml, mr, gu, bn, or, pa, ur };

/** Every dotted path to a string in `T`: "scale.high", "documentTitles.pitch-glimpse". */
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/** One piece of fixed document text, as a dotted path into `DocumentLabels`. */
export type DocumentTextKey = LeafPaths<DocumentLabels>;

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

/** The table registered for `language`; throws, naming it, when there is none. */
function tableFor(language: DocumentLanguage): DocumentLabels {
  const table = hasOwn(TABLES, language) ? TABLES[language] : undefined;
  if (!table) throw new Error(`No document text table for language "${String(language)}".`);
  return table;
}

/**
 * The fixed text for `key` in `language`, with `{name}` placeholders filled from `vars`. Throws when the
 * language has no table, the table has no such key, or a placeholder in the text has no value in `vars`.
 */
export function documentText(
  language: DocumentLanguage,
  key: DocumentTextKey,
  vars: Record<string, string | number> = {}
): string {
  let node: unknown = tableFor(language);
  for (const part of String(key).split('.')) {
    node =
      node !== null && typeof node === 'object' && hasOwn(node, part)
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string' || node.trim() === '') {
    throw new Error(`No document text "${String(key)}" for language "${String(language)}".`);
  }
  for (const [, name] of node.matchAll(/\{(\w+)\}/g)) {
    if (!hasOwn(vars, name)) throw new Error(`Document text "${String(key)}" needs a value for {${name}}.`);
  }
  return formatLabel(node, vars);
}

/** Writing direction for documents in `language` (Urdu is right-to-left). Throws for an unknown code. */
export function documentDirection(language: DocumentLanguage): 'ltr' | 'rtl' {
  if (!hasOwn(DOCUMENT_LANGUAGE_INFO, language)) throw new Error(`Unknown document language "${String(language)}".`);
  return DOCUMENT_LANGUAGE_INFO[language].dir;
}

/**
 * The "beta translation" label for a language whose fixed text is not yet reviewed (Q-45), in that
 * language; '' for a reviewed one. Throws for an unknown code or a beta language without a table.
 */
export function betaLabel(language: DocumentLanguage): string {
  if (!hasOwn(DOCUMENT_LANGUAGE_INFO, language)) throw new Error(`Unknown document language "${String(language)}".`);
  return DOCUMENT_LANGUAGE_INFO[language].beta ? documentText(language, 'status.betaTranslation') : '';
}

export interface LabelLookup {
  labels: DocumentLabels;
  /** The language asked for. */
  requested: DocumentLanguage;
  /** The language of the table returned: `requested`, or 'en' when it has no table. */
  language: DocumentLanguage;
  /** True when `requested` has no table and English was returned instead. */
  fallback: boolean;
}

/**
 * Languages whose documents are written entirely in that language: every wording table of every builder
 * has it. Hindi has a label table (documentText) but not yet builder wording, so a Hindi document is
 * wholly English with the beta note (DEC-005). Add a language here once every builder covers it.
 */
const DOCUMENT_READY: ReadonlySet<DocumentLanguage> = new Set<DocumentLanguage>(['en', 'ta']);

/** The label table for `lang`, or the English one with `fallback: true` when `lang` is not document-ready. */
export function labelsFor(lang: DocumentLanguage): LabelLookup {
  const table = TABLES[lang];
  if (table && DOCUMENT_READY.has(lang)) return { labels: table, requested: lang, language: lang, fallback: false };
  return { labels: en, requested: lang, language: 'en', fallback: true };
}

/**
 * The beta note a document requested in `lang` carries: '' for a reviewed language, else the "beta
 * translation" label in the language the document is rendered in (English while `lang` falls back).
 */
export function documentBetaNote(lang: DocumentLanguage): string {
  if (!hasOwn(DOCUMENT_LANGUAGE_INFO, lang) || !DOCUMENT_LANGUAGE_INFO[lang].beta) return '';
  // The note is in the language actually rendered: English when the request fell back (DEC-005).
  return labelsFor(lang).labels.status.betaTranslation;
}

/** The languages that have their own label table. */
export function labelLanguages(): DocumentLanguage[] {
  return Object.keys(TABLES) as DocumentLanguage[];
}

/** Every label as a dotted key ("scale.high") with its value, in table order. */
export function flattenLabels(labels: DocumentLabels): Array<[key: string, value: string]> {
  const out: Array<[string, string]> = [];
  const walk = (node: unknown, prefix: string) => {
    if (typeof node === 'string') {
      out.push([prefix, node]);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, prefix ? `${prefix}.${k}` : k);
  };
  walk(labels, '');
  return out;
}

/** Fills `{name}` placeholders: `formatLabel('Phase {n}', { n: 2 })` is "Phase 2". Unknown ones stay. */
export function formatLabel(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** A roadmap phase's label: "Phase 1: Quick fixes" for the first three, "Phase 4" after them. */
export function phaseLabel(labels: DocumentLabels, phase: number): string {
  const numbered = formatLabel(labels.phases.numbered, { n: phase });
  const name = [labels.phases.first, labels.phases.second, labels.phases.third][phase - 1];
  return name ? `${numbered}: ${name}` : numbered;
}
