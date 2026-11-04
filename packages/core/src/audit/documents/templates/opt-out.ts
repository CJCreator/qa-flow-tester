/**
 * The default Pitch Glimpse opt-out text in English and Tamil (REQ-019, Q-09, D-002). The tool user edits
 * it per language in the document settings and owns checking it; a language without saved text uses
 * these defaults, and a language with no default here uses English.
 *
 * The Tamil wording has not been reviewed by a native speaker yet.
 */

import type { DocumentLanguage } from '@qa/types';

export const OPT_OUT_TEXT_EN =
  'You received this page because we looked at the public pages of your website. ' +
  'If you do not want to hear from us again, tell us and we will not contact you about this website again.';

export const OPT_OUT_TEXT_TA =
  'உங்கள் இணையதளத்தின் பொதுப் பக்கங்களை நாங்கள் பார்த்ததால் இந்தப் பக்கம் உங்களுக்குக் கிடைத்துள்ளது. ' +
  'எங்களிடமிருந்து மீண்டும் தொடர்பு வேண்டாம் என்றால் எங்களிடம் தெரிவியுங்கள்; இந்த இணையதளம் பற்றி மீண்டும் உங்களைத் தொடர்புகொள்ள மாட்டோம்.';

/** The default opt-out text per language. */
export const DEFAULT_OPT_OUT_TEXT: Readonly<Partial<Record<DocumentLanguage, string>>> = {
  en: OPT_OUT_TEXT_EN,
  ta: OPT_OUT_TEXT_TA,
};

/** The default opt-out text for `lang`, or the English one when `lang` has none. */
export function defaultOptOutText(lang: DocumentLanguage): string {
  return DEFAULT_OPT_OUT_TEXT[lang] ?? OPT_OUT_TEXT_EN;
}
