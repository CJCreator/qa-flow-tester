/**
 * The default English Proposal template (REQ-027): website-only work. The tool user edits it in the
 * document settings; `fillProposal` (../proposal.ts) fills its placeholders from one edited audit.
 *
 * A TS module, not a file read at runtime, so the runner's dist and Docker image need nothing extra.
 */

export const PROPOSAL_TEMPLATE_EN = `# Website proposal for {{site.url}}

{{company.name}}
{{date}}

## What we found

{{findings_summary}}

## Scope

This proposal covers work on the website only. Each page is marked for a redesign or a repair.

{{scope}}

## Not included

{{not_included}}

## Price

Prices are in Indian rupees (INR).

{{price}}

## Payment terms

{{payment_terms}}

## Timeline

The work follows the phases of the Improvement Roadmap.

{{timeline}}

## About us

- Company: {{company.name}}
- Address: {{company.address}}
- Phone: {{company.phone}}
- Email: {{company.email}}
- Website: {{company.website}}

## Terms and conditions

{{company.terms}}
`;

/** Listed under "Not included" when the tool user has not written their own lines. */
export const PROPOSAL_NOT_INCLUDED_EN: readonly string[] = ['Hosting or domain', 'Digital marketing or ads', 'Mobile apps'];

/** Shown in place of a price or payment terms the tool user has not filled in yet. */
export const PROPOSAL_FILL_IN_EN = '[To fill in]';
