/**
 * The claim-wording guard for every audit AI answer (ADR 0018, REQ-016): an answer that says a site is
 * compliant, certified, secure, fully accessible, passes WCAG, or is ready to release is flagged, so the
 * caller can drop or redo it. One word list for the whole Website Audit: the list and the matcher live in
 * `documents/wording.ts` (whole words and phrases, any letter case, Unicode-aware boundaries); this module
 * is the entry point the AI stages (and G3/G5) import.
 *
 * Derived forms are not claims and are not flagged: "securely", "insecure", "non-compliant", "safety".
 */
import { ADR_0018_CLAIM_WORDS, CLAIM_WORDS, RELEASE_VERDICT_WORDS, findClaimWords } from '../documents/wording.js';

export { ADR_0018_CLAIM_WORDS, CLAIM_WORDS, RELEASE_VERDICT_WORDS, findClaimWords };

/** True when `text` makes a claim ADR 0018 forbids. */
export function hasClaimWords(text: string): boolean {
  return findClaimWords(text).length > 0;
}
