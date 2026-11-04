import type { DocumentLanguage, PageLanguage } from '@qa/types';

/**
 * Page language from a page's main text by Unicode script share (REQ-013). The lang attribute is
 * only a hint: it is returned as `declared` and never decides `primary`. Pure and deterministic.
 */

/** One writing system the detector counts letters for. */
export interface ScriptEntry {
  /** Script name, for readability and tests. */
  name: string;
  /** Inclusive code point ranges. */
  ranges: ReadonlyArray<readonly [number, number]>;
  /** The listed language this script maps to. */
  language: DocumentLanguage;
}

/**
 * Scripts with a listed language. Add a row to detect another script (REQ-032: Devanagari and others).
 * Order breaks ties: an earlier row wins an equal count.
 */
export const SCRIPT_TABLE: readonly ScriptEntry[] = [
  {
    name: 'Latin',
    ranges: [
      [0x0041, 0x005a], // A-Z
      [0x0061, 0x007a], // a-z
      [0x00c0, 0x024f], // Latin-1 letters, Latin Extended-A/B (× and ÷ are not letters, filtered below)
      [0x1e00, 0x1eff], // Latin Extended Additional
    ],
    language: 'en',
  },
  {
    name: 'Tamil',
    ranges: [[0x0b80, 0x0bff]],
    language: 'ta',
  },
  {
    // Devanagari is shared by Hindi and Marathi; the script alone cannot tell them apart and the lang
    // attribute never decides, so it maps to Hindi (the larger language).
    name: 'Devanagari',
    ranges: [
      [0x0900, 0x097f], // Devanagari
      [0xa8e0, 0xa8ff], // Devanagari Extended
    ],
    language: 'hi',
  },
];

/** Fewer letters than this: too little text to tell, so 'not-identified'. */
export const MIN_LETTERS = 20;

/** A listed language other than the primary is listed in `others` from this share of letters (0..1). */
export const MIN_OTHER_SHARE = 0.1;

const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const LETTER = /\p{L}/u;

function scriptIndexOf(codePoint: number): number {
  for (let i = 0; i < SCRIPT_TABLE.length; i++) {
    for (const [from, to] of SCRIPT_TABLE[i].ranges) {
      if (codePoint >= from && codePoint <= to) return i;
    }
  }
  return -1;
}

/**
 * Counts letters per listed script (vowel signs and other combining marks count with their script),
 * plus one bucket for letters in scripts with no listed language.
 */
function countLetters(text: string): { perScript: number[]; unlisted: number; total: number } {
  const perScript = SCRIPT_TABLE.map(() => 0);
  let unlisted = 0;
  for (const ch of text) {
    const index = scriptIndexOf(ch.codePointAt(0) as number);
    if (index >= 0) {
      if (LETTER_OR_MARK.test(ch)) perScript[index]++;
    } else if (LETTER.test(ch)) {
      unlisted++;
    }
  }
  const total = perScript.reduce((sum, n) => sum + n, 0) + unlisted;
  return { perScript, unlisted, total };
}

export function detectPageLanguage(text: string, declared?: string | null): PageLanguage {
  const declaredValue = typeof declared === 'string' ? declared : null;
  const { perScript, unlisted, total } = countLetters(typeof text === 'string' ? text : '');

  if (total < MIN_LETTERS) {
    return { primary: 'not-identified', others: [], declared: declaredValue };
  }

  // Letters per listed language (two scripts may map to one language).
  const perLanguage = new Map<DocumentLanguage, number>();
  SCRIPT_TABLE.forEach((entry, i) => {
    perLanguage.set(entry.language, (perLanguage.get(entry.language) ?? 0) + perScript[i]);
  });

  let primary: DocumentLanguage | 'not-identified' = 'not-identified';
  let best = unlisted; // unlisted scripts must be beaten strictly
  for (const [language, count] of perLanguage) {
    if (count > best) {
      best = count;
      primary = language;
    }
  }

  const others: DocumentLanguage[] = [];
  for (const [language, count] of perLanguage) {
    if (language !== primary && count > 0 && count / total >= MIN_OTHER_SHARE) others.push(language);
  }

  return { primary, others, declared: declaredValue };
}
