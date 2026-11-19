/**
 * Fix options per finding, by rule (T-417, ADR 0049). Fixed text per finding `rule`, labelled "decided by
 * rule", so every top finding has 2 or 3 ways to fix it without an AI key. Each option has an effort size
 * (S, M or L) and a trade-off. No score, no claim words, nothing about the whole site (ADR 0018).
 *
 * A leaf module with type-only imports: the wizard imports it as is (no Node code reaches its bundle).
 */
import type { AuditArea, AuditFinding, AuditFindingGroup } from '@qa/types';

/** S: under an hour or two; M: a day or so; L: several days or a rebuild of the part. */
export type FixEffort = 'S' | 'M' | 'L';

/** One way to fix one finding. */
export interface FixOption {
  /** `<finding id>-<letter>`: stable for a finding, so a Roadmap row can point at it. */
  id: string;
  /** The finding it answers (every option cites one). */
  findingId: string;
  title: string;
  effort: FixEffort;
  /** What this option costs or leaves out, in one line. */
  tradeOff: string;
  /** 'rule': fixed text from this file; 'ai': written for this site from the finding (with a key). */
  source: 'rule' | 'ai';
}

/** The label of a rule option. */
export const DECIDED_BY_RULE = 'decided by rule';

/** How many findings get options: the top 10 (ranked by impact, then lower effort). */
export const FIX_OPTION_TOP_FINDINGS = 10;
/** Options per finding at most. */
export const MAX_FIX_OPTIONS = 3;

type RuleText = Omit<FixOption, 'id' | 'findingId' | 'source'>;

const o = (title: string, effort: FixEffort, tradeOff: string): RuleText => ({ title, effort, tradeOff });

/** Fixed options per finding rule. */
export const FIX_RULES: Readonly<Record<string, readonly RuleText[]>> = {
  'missing-title': [
    o('Write a title for this page by hand', 'S', 'Best wording, but each new page needs the same care.'),
    o(
      'Set a title pattern in the site builder (page name, then business name)',
      'M',
      'Covers every page at once; the wording is less specific.'
    ),
  ],
  'duplicate-title': [
    o(
      'Rewrite the repeated titles so each names its own page',
      'S',
      'Quick for a few pages; slow when many share one title.'
    ),
    o(
      'Change the title template to include the page name',
      'M',
      'Fixes future pages too; needs access to the theme or builder settings.'
    ),
  ],
  'missing-description': [
    o('Write a one-sentence description for this page', 'S', 'Good wording, one page at a time.'),
    o(
      'Fill descriptions from each page’s first paragraph in the builder',
      'M',
      'Covers many pages; the text may read less naturally.'
    ),
  ],
  'duplicate-description': [
    o('Rewrite the repeated descriptions per page', 'S', 'Quick for a few pages.'),
    o(
      'Remove the shared default description so each page sets its own',
      'M',
      'Pages without their own text then show none until written.'
    ),
  ],
  'duplicate-content': [
    o(
      'Merge the pages into one and redirect the other address',
      'M',
      'One stronger page; old links must point to the kept one.'
    ),
    o('Rewrite one page so it covers a different topic', 'L', 'Keeps both pages; needs new writing.'),
    o('Point the copy to the original with a canonical link', 'S', 'Fast; the copy still exists for visitors.'),
  ],
  'no-h1': [
    o(
      'Turn the page’s main title into a level-1 heading',
      'S',
      'A small template change; check that the look stays the same.'
    ),
    o('Add a short level-1 heading above the first Section', 'S', 'Adds a line of text to the design.'),
  ],
  'multiple-h1': [
    o('Keep one level-1 heading and make the others level 2', 'S', 'May change their size; restyle if needed.'),
    o('Fix the theme so only the page title is level 1', 'M', 'Fixes every page; needs theme access.'),
  ],
  'skipped-heading-level': [
    o('Change the heading levels so none is skipped', 'S', 'Headings may change size; adjust the styles.'),
    o('Style headings by class instead of by level', 'M', 'Frees the levels from the look; needs a style change.'),
  ],
  'missing-alt': [
    o('Write short alt text for each image that carries meaning', 'S', 'Takes a few minutes per image.'),
    o('Mark decorative images with empty alt text', 'S', 'Only for images that add nothing to the text.'),
    o(
      'Make alt text a required field when images are uploaded',
      'M',
      'Fixes future images; needs a builder setting or plugin.'
    ),
  ],
  'broken-link': [
    o('Point the link at the right page', 'S', 'Needs the correct address.'),
    o('Remove the link', 'S', 'Visitors lose that path.'),
    o(
      'Redirect the old address to its new page',
      'M',
      'Fixes every link to it at once; needs server or builder access.'
    ),
  ],
  'unlinked-page': [
    o('Link the page from the menu or a related page', 'S', 'The menu grows, or the link is easy to miss.'),
    o('Remove the page if it is no longer needed', 'S', 'Its content is gone; redirect its address.'),
  ],
  'on-page-seo': [
    o('Fix the page’s title, description and headings by hand', 'S', 'One page at a time.'),
    o(
      'Install or configure an SEO setting in the site builder',
      'M',
      'Covers many pages; one more tool to look after.'
    ),
  ],
  schema: [
    o(
      'Add business details as structured data on the homepage',
      'M',
      'Needs care to keep it in step with the visible details.'
    ),
    o('Use the builder’s built-in business details setting', 'S', 'Less control over what is included.'),
  ],
  'internal-linking': [
    o('Add links between related pages in the body text', 'S', 'Takes writing time per page.'),
    o('Add a “related pages” block to the page template', 'M', 'Covers every page; the choice of links is automatic.'),
  ],
  'social-tags': [
    o('Add a sharing title, description and image to the homepage', 'S', 'Only the homepage looks right when shared.'),
    o('Set sharing tags for every page in the builder', 'M', 'Covers all pages; needs a default image.'),
  ],
  analytics: [
    o('Add a privacy-friendly visit counter', 'S', 'Fewer details than a full analytics tool.'),
    o('Add a full analytics tool with a cookie notice', 'M', 'More detail; a cookie notice is then needed.'),
  ],
  ctas: [
    o('Add one clear call to action near the top of the page', 'S', 'Takes space from other content.'),
    o('Repeat the call to action at the end of each long Section', 'M', 'Can feel pushy if overdone.'),
  ],
  'lead-forms': [
    o('Add a short enquiry form (name, phone or email, message)', 'M', 'Someone must answer the enquiries.'),
    o('Link to a booking or enquiry page from the main Sections', 'S', 'One more click for the visitor.'),
  ],
  'click-to-call': [
    o('Make the phone number a tap-to-call link', 'S', 'Only helps on phones.'),
    o('Add a call button to the header on phones', 'M', 'Uses header space.'),
  ],
  'trust-signals': [
    o('Show two or three real customer reviews with names', 'S', 'Needs permission from the customers.'),
    o('Add a Section with client names, years in business or awards', 'M', 'Needs facts that can be backed up.'),
  ],
  'local-signals': [
    o('Show the full address, phone and opening hours on every page footer', 'S', 'Must be kept up to date.'),
    o('Add a map and directions to the contact page', 'M', 'Adds a third-party map to the page.'),
  ],
};

/** When the rule has no entry: by area, then by group. */
const BY_AREA: Readonly<Partial<Record<AuditArea, readonly RuleText[]>>> = {
  accessibility: [
    o('Fix this item on the page where it was found', 'S', 'Other pages built the same way may need the same fix.'),
    o('Fix it in the shared template or component', 'M', 'Fixes every page that uses it; needs a template change.'),
  ],
  speed: [
    o('Shrink or lazy-load the heaviest images on this page', 'S', 'Images may look slightly softer.'),
    o('Turn on caching and compression on the server or builder', 'M', 'Needs hosting access; check the site after.'),
    o('Remove scripts the page does not need', 'L', 'Some features may stop; test each one.'),
  ],
};

const BY_GROUP: Readonly<Record<AuditFindingGroup, readonly RuleText[]>> = {
  technical: [
    o('Fix it on the page where it was found', 'S', 'Other pages may have the same problem.'),
    o('Fix it in the template that builds these pages', 'M', 'Covers every page; needs template access.'),
  ],
  marketing: [
    o('Change the wording or layout of this Section', 'S', 'One page at a time.'),
    o('Add the missing part to the page template', 'M', 'Shows on every page; check it fits each one.'),
  ],
  content: [
    o('Rewrite this Section', 'S', 'Takes writing time.'),
    o('Merge or remove the Section', 'M', 'Some text is lost; keep what visitors need.'),
  ],
};

/**
 * Which fixed text a finding's rule options come from: `rule:<rule>`, else `area:<area>`, else
 * `group:<group>`. The Tamil text (labels/fix-rules-ta.ts) is keyed the same way.
 */
export function ruleTextKey(finding: Pick<AuditFinding, 'rule' | 'area' | 'group'>): string {
  if (FIX_RULES[finding.rule]) return `rule:${finding.rule}`;
  if (BY_AREA[finding.area]) return `area:${finding.area}`;
  return `group:${BY_GROUP[finding.group] ? finding.group : 'technical'}`;
}

/** Every fixed text, by `ruleTextKey`, for the label coverage test. */
export function allRuleTexts(): Record<string, ReadonlyArray<{ title: string; tradeOff: string }>> {
  const out: Record<string, ReadonlyArray<{ title: string; tradeOff: string }>> = {};
  for (const [k, v] of Object.entries(FIX_RULES)) out[`rule:${k}`] = v;
  for (const [k, v] of Object.entries(BY_AREA)) out[`area:${k}`] = v ?? [];
  for (const [k, v] of Object.entries(BY_GROUP)) out[`group:${k}`] = v;
  return out;
}

function textsForKey(key: string): readonly RuleText[] {
  const [kind, name = ''] = key.split(/:(.*)/s);
  if (kind === 'rule') return FIX_RULES[name] ?? [];
  if (kind === 'area') return BY_AREA[name as AuditArea] ?? [];
  return BY_GROUP[name as AuditFindingGroup] ?? [];
}

/** The rule options of one finding: by rule, else by area, else by group. Always 2 or 3. */
export function ruleOptionsFor(finding: Pick<AuditFinding, 'id' | 'rule' | 'area' | 'group'>): FixOption[] {
  const texts = textsForKey(ruleTextKey(finding));
  return texts.slice(0, MAX_FIX_OPTIONS).map((t, i) => ({
    ...t,
    id: `${finding.id}-${String.fromCharCode(65 + i)}`,
    findingId: finding.id,
    source: 'rule',
  }));
}

/** The findings that get options: the first 10 (the version stores findings ranked). */
export function topFindingsForOptions<T extends Pick<AuditFinding, 'id'>>(
  findings: readonly T[],
  count = FIX_OPTION_TOP_FINDINGS
): T[] {
  return findings.slice(0, count);
}

/** Rule options for the top findings, by finding id. Works without an AI key. */
export function ruleFixOptions(
  findings: readonly Pick<AuditFinding, 'id' | 'rule' | 'area' | 'group'>[]
): Map<string, FixOption[]> {
  return new Map(topFindingsForOptions(findings).map((f) => [f.id, ruleOptionsFor(f)]));
}

/** The chosen option of a finding: the first one, until a choice can be stored. */
export function chosenFixOption(options: readonly FixOption[] | undefined): FixOption | undefined {
  return options?.[0];
}
