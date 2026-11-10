/**
 * The Improvement Roadmap Audit Document (REQ-026): the version's roadmap items by phase, phases in order,
 * each with its priority, phase and effort, and the findings and pages it covers. The Owner Audit uses it
 * with `showEffort: false`, which leaves out every effort value and the effort column.
 *
 * Built from the edited view only (REQ-020), so removed pages and findings never show and finding text
 * carries the tool user's edits. Never called a Plan; no claim that a site is fine (ADR 0018).
 */

import type { AuditFinding, DocumentLanguage, RoadmapItem } from '@qa/types';
import type { EditedAuditView } from './edits.js';
import { phaseLabel, type LabelLookup } from './labels/index.js';
import type { AuditDoc, DocBlock } from './model.js';

/** Fixed wording only this document uses. Same keys per language; a language without a table uses English. */
interface RoadmapWording {
  intro: string;
  /** The intro without any mention of effort, for `showEffort: false`. */
  introWithoutEffort: string;
  pagesCovered: string;
  nothingToOrder: string;
}

const EN: RoadmapWording = {
  intro: 'Work ordered by impact, then by lower effort. Each item brings together the findings of one kind.',
  introWithoutEffort: 'Work ordered by impact. Each item brings together the findings of one kind.',
  pagesCovered: 'Pages covered',
  nothingToOrder:
    'No findings were recorded in this audit, so there is nothing to order. This covers only what the audit checked; it does not mean the website has no issues.',
};

const TA: RoadmapWording = {
  intro:
    'தாக்கத்தின்படியும், பின்னர் குறைந்த முயற்சியின்படியும் வரிசைப்படுத்தப்பட்ட பணிகள். ஒவ்வொரு உருப்படியும் ஒரே வகைக் கண்டுபிடிப்புகளை ஒன்றாகக் கொண்டுள்ளது.',
  introWithoutEffort:
    'தாக்கத்தின்படி வரிசைப்படுத்தப்பட்ட பணிகள். ஒவ்வொரு உருப்படியும் ஒரே வகைக் கண்டுபிடிப்புகளை ஒன்றாகக் கொண்டுள்ளது.',
  pagesCovered: 'உள்ளடக்கிய பக்கங்கள்',
  nothingToOrder:
    'இந்த ஆய்வில் கண்டுபிடிப்புகள் எதுவும் பதிவு செய்யப்படவில்லை, எனவே வரிசைப்படுத்த எதுவும் இல்லை. இது ஆய்வு சரிபார்த்தவற்றை மட்டுமே குறிக்கிறது; இணையதளத்தில் சிக்கல்கள் இல்லை என்று இது பொருள்படாது.',
};

const WORDING: Partial<Record<DocumentLanguage, RoadmapWording>> = { en: EN, ta: TA };

/** This document's own wording for `language` (English when the language has no table yet). */
export function roadmapWording(language: DocumentLanguage): RoadmapWording {
  return WORDING[language] ?? EN;
}

export interface RoadmapDocumentOptions {
  /** False for the Owner Audit: no effort value, column or wording appears. */
  showEffort: boolean;
}

/** The roadmap items by phase, phases in ascending order, items in their roadmap order within a phase. */
function byPhase(items: readonly RoadmapItem[]): Array<[phase: number, items: RoadmapItem[]]> {
  const phases = new Map<number, RoadmapItem[]>();
  for (const item of items) {
    if (!phases.has(item.phase)) phases.set(item.phase, []);
    phases.get(item.phase)!.push(item);
  }
  return [...phases.entries()].sort((a, b) => a[0] - b[0]);
}

const findingPages = (f: AuditFinding): string => (f.pages && f.pages.length > 0 ? f.pages : [f.urlPath]).join(', ');

/**
 * The Improvement Roadmap document for one edited version. `lookup` is `labelsFor(language)`: its labels
 * give the shared wording and its language this document's own wording and the document language.
 */
export function buildRoadmapDocument(
  view: EditedAuditView,
  lookup: LabelLookup,
  options: RoadmapDocumentOptions
): AuditDoc {
  const { labels } = lookup;
  // The document is in the requested language even when its labels fall back to English (DEC-005).
  const language = lookup.requested;
  const words = roadmapWording(lookup.language);
  const { showEffort } = options;
  const findings = new Map(view.result.findings.map((f) => [f.id, f]));
  const blocks: DocBlock[] = [];

  const items = view.result.roadmap.filter((item) => item.findingIds.some((id) => findings.has(id)));
  if (items.length === 0) {
    blocks.push({ type: 'paragraph', text: words.nothingToOrder });
    return { kind: 'roadmap', title: labels.documentTitles.roadmap, language, blocks };
  }

  blocks.push({ type: 'paragraph', text: showEffort ? words.intro : words.introWithoutEffort });

  const columns = [labels.columns.issue, labels.columns.page, labels.columns.impact];
  if (showEffort) columns.push(labels.columns.effort);

  for (const [phase, phaseItems] of byPhase(items)) {
    const phaseName = phaseLabel(labels, phase);
    blocks.push({ type: 'heading', level: 1, text: phaseName });
    for (const item of phaseItems) {
      blocks.push({ type: 'heading', level: 2, text: item.title });
      const facts = [
        `${labels.columns.priority}: ${labels.scale[item.priority]}`,
        `${labels.columns.phase}: ${phaseName}`,
      ];
      if (showEffort) facts.push(`${labels.columns.effort}: ${labels.scale[item.effort]}`);
      blocks.push({ type: 'list', items: facts });

      const rows = item.findingIds
        .map((id) => findings.get(id))
        .filter((f): f is AuditFinding => f !== undefined)
        .map((f) => {
          const row = [f.title, findingPages(f), labels.scale[f.impact]];
          if (showEffort) row.push(labels.scale[f.effort]);
          return row;
        });
      blocks.push({ type: 'table', columns: [...columns], rows });
      blocks.push({ type: 'paragraph', text: `${words.pagesCovered}: ${item.pages.join(', ')}` });
    }
  }

  return { kind: 'roadmap', title: labels.documentTitles.roadmap, language, blocks };
}
