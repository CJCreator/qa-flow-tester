/**
 * The claim-wording guard (ADR 0018). A Website Audit says what was checked and what was found; it never
 * says a site is compliant, secure or accessible, and it has no release verdict (ADR 0029, ADR 0033).
 *
 * `findClaimWords` is used by the label tests and by the tests of every document built on this model.
 */

/** ADR 0018 "Words to avoid", in the order the record lists them. */
export const ADR_0018_CLAIM_WORDS = [
  'compliant',
  'compliance',
  'certified',
  'secure',
  'safe',
  'hack-proof',
  'passes WCAG',
  'fully accessible',
] as const;

/** A Website Audit, the Pitch Glimpse and the Owner Audit carry no release verdict. */
export const RELEASE_VERDICT_WORDS = ['Ready to release', 'Not ready yet', 'release verdict', 'release-ready'] as const;

export const CLAIM_WORDS: readonly string[] = [...ADR_0018_CLAIM_WORDS, ...RELEASE_VERDICT_WORDS];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole words only, any case, any run of spaces between words: "Secure" and "passes  WCAG" match;
// "insecure" and "safety" do not.
const PATTERNS = CLAIM_WORDS.map((word) => ({
  word,
  re: new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(word).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}_-])`, 'iu'),
}));

/** The claim words in `text`, each once, in `CLAIM_WORDS` order. Empty when the text makes no claim. */
export function findClaimWords(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.word);
}

/**
 * `text` with every claim word removed, using the same matcher as `findClaimWords` (so what is found is what
 * is removed). White space left behind is collapsed.
 */
export function stripClaimWords(text: string): string {
  let cleaned = text;
  for (const p of PATTERNS) cleaned = cleaned.replace(new RegExp(p.re.source, 'giu'), '');
  return cleaned.replace(/\s+/g, ' ').trim();
}
