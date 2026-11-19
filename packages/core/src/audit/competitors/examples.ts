/**
 * Competitor examples (T-418, ADR 0049). Deterministic: no AI, no I/O.
 *
 * For each top finding, what each similar site shows on the same page type, from the comparison facts only.
 * Every example states only what was seen, on which page of which site ("a.example shows a phone link on
 * /contact"), never a score and nothing about a whole site (ADR 0018).
 *
 * Variants may borrow these ideas ("borrow what works"), each cited by site and page. Competitor text and images
 * are never copied: `copiesCompetitor` runs the rewrite overlap check against every competitor text.
 */
import type {
  AuditFinding,
  CompetitorContactOption,
  CompetitorExample,
  CompetitorPageFacts,
  CompetitorsState,
  OverlapFlag,
} from '@qa/types';
import { findOverlaps, overlapThreshold } from '../ai/rewrite.js';
import { pageTypeOf } from './light-crawl.js';

export type { CompetitorExample };

const CONTACT_WORDS: Record<CompetitorContactOption, string> = {
  phone: 'a phone link',
  email: 'an email link',
  whatsapp: 'a WhatsApp link',
  form: 'a contact form',
  address: 'a postal address',
  chat: 'a chat window',
};

const CONTACT_RULES = new Set(['click-to-call', 'local-signals', 'lead-forms']);
const CTA_RULES = new Set(['ctas', 'lead-forms']);
const TRUST_RULES = new Set(['trust-signals']);

/** What a page shows that bears on the finding's rule, as short phrases; empty when nothing bears on it. */
function seenFor(rule: string, page: CompetitorPageFacts): string[] {
  const seen: string[] = [];
  if (CTA_RULES.has(rule) && page.ctas.length > 0) {
    seen.push(`the call to action “${page.ctas[0]}”`);
  }
  if (CONTACT_RULES.has(rule) && page.contactOptions.length > 0) {
    seen.push(page.contactOptions.map((c) => CONTACT_WORDS[c]).join(', '));
  }
  if (TRUST_RULES.has(rule) && page.trustSignals.length > 0) {
    seen.push(page.trustSignals.join(', '));
  }
  if (seen.length === 0 && !CTA_RULES.has(rule) && !CONTACT_RULES.has(rule) && !TRUST_RULES.has(rule)) {
    if (page.sections.length > 0) seen.push(`${page.sections.length} Sections headed “${page.sections[0]}” first`);
    if (page.ctas.length > 0) seen.push(`the call to action “${page.ctas[0]}”`);
  }
  return seen;
}

/** For each finding: what each read similar site shows on the same page type. */
export function competitorExamples(
  findings: readonly Pick<AuditFinding, 'id' | 'rule' | 'urlPath'>[],
  state: Pick<CompetitorsState, 'sites'> | null
): Map<string, CompetitorExample[]> {
  const out = new Map<string, CompetitorExample[]>();
  const sites = (state?.sites ?? []).filter((s) => s.status === 'read');
  for (const finding of findings) {
    const type = pageTypeOf(finding.urlPath);
    const examples: CompetitorExample[] = [];
    for (const site of sites) {
      const page = site.pages.find((p) => p.pageType === type) ?? (type === 'other' ? site.pages[0] : undefined);
      if (!page) continue;
      for (const thing of seenFor(finding.rule, page)) {
        examples.push({
          findingId: finding.id,
          host: site.host,
          urlPath: page.urlPath,
          text: `${site.host} shows ${thing} on ${page.urlPath}`,
        });
      }
    }
    if (examples.length > 0) out.set(finding.id, examples);
  }
  return out;
}

/** The ideas a variant may borrow, one line each, with the finding it answers and the site and page it was seen on. */
export function competitorIdeas(examples: ReadonlyMap<string, readonly CompetitorExample[]>, max = 12): string[] {
  return [...examples.values()]
    .flat()
    .slice(0, max)
    .map((e) => `for ${e.findingId}: ${e.text}`);
}

/** Every piece of competitor text the facts hold: titles, Section headings and calls to action. */
export function competitorTexts(state: Pick<CompetitorsState, 'sites'> | null): string[] {
  return (state?.sites ?? []).flatMap((s) =>
    s.pages.flatMap((p) => [...(p.title ? [p.title] : []), ...p.sections, ...p.ctas])
  );
}

/** The runs a text shares with any competitor text (the rewrite overlap check); empty when it copies none. */
export function copiesCompetitor(text: string, texts: readonly string[], minWords?: number): OverlapFlag[] {
  const min = overlapThreshold(minWords);
  return texts.flatMap((t) => findOverlaps(t, text, min));
}
