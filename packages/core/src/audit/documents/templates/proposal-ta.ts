/**
 * The default Tamil Proposal template (REQ-027): website-only work. Same placeholders as proposal-en.ts.
 * The wording has not been reviewed by a native speaker yet.
 */

export const PROPOSAL_TEMPLATE_TA = `# {{site.url}} இணையதளத்திற்கான முன்மொழிவு

{{company.name}}
{{date}}

## நாங்கள் கண்டறிந்தவை

{{findings_summary}}

## பணி வரம்பு

இந்த முன்மொழிவு இணையதளப் பணிகளை மட்டுமே உள்ளடக்கியது. ஒவ்வொரு பக்கமும் மறுவடிவமைப்பு அல்லது சீரமைப்புக்காகக் குறிக்கப்பட்டுள்ளது.

{{scope}}

## சேர்க்கப்படாதவை

{{not_included}}

## விலை

விலைகள் இந்திய ரூபாயில் (INR).

{{price}}

## கட்டண விதிமுறைகள்

{{payment_terms}}

## கால அட்டவணை

பணிகள் மேம்பாட்டு வழிவரைபடத்தின் கட்டங்களைப் பின்பற்றுகின்றன.

{{timeline}}

## எங்களைப் பற்றி

- நிறுவனம்: {{company.name}}
- முகவரி: {{company.address}}
- தொலைபேசி: {{company.phone}}
- மின்னஞ்சல்: {{company.email}}
- இணையதளம்: {{company.website}}

## விதிமுறைகள் மற்றும் நிபந்தனைகள்

{{company.terms}}
`;

/** Listed under "Not included" when the tool user has not written their own lines. */
export const PROPOSAL_NOT_INCLUDED_TA: readonly string[] = [
  'ஹோஸ்டிங் அல்லது டொமைன்',
  'டிஜிட்டல் மார்க்கெட்டிங் அல்லது விளம்பரங்கள்',
  'மொபைல் செயலிகள்',
];

/** Shown in place of a price or payment terms the tool user has not filled in yet. */
export const PROPOSAL_FILL_IN_TA = '[நிரப்ப வேண்டியது]';
