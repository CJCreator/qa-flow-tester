/**
 * The Findings Audit Document (REQ-018, REQ-017, Q-02): findings grouped as technical, marketing and
 * content, each group in ranking order (impact, then lower effort: the order the version stores them in).
 * Every finding cites its page and Section and shows its impact, effort, title, what was found and the
 * suggested fix; AI-written findings are marked as advice. Then the grade per area: grades come from fixed
 * checks only, AI notes are advice, and an area without a grade is listed as not checked.
 *
 * Built from the edited view only (REQ-020). `showEffort: false` (the Owner Audit) leaves effort out.
 * No release verdict and no site-wide pass or fail (ADR 0018, ADR 0029).
 */

import {
  AUDIT_AREAS,
  type AreaAssessment,
  type AuditArea,
  type AuditFinding,
  type AuditFindingGroup,
  type DocumentLanguage,
  type SectionSummary,
} from '@qa/types';
import { contentWording, sectionLabel } from './content.js';
import type { EditedAuditView } from './edits.js';
import { labelsFor, type DocumentLabels } from './labels/index.js';
import type { AuditDoc, DocBlock } from './model.js';

/** Fixed wording only this document uses. */
interface FindingsWording {
  pages: string;
  gradesByArea: string;
  gradesNote: string;
  aiNote: string;
}

const EN: FindingsWording = {
  pages: 'Pages',
  gradesByArea: 'Grades by area',
  gradesNote: 'Grades come from fixed checks only. An area without a grade was not checked.',
  aiNote: 'AI note',
};

const TA: FindingsWording = {
  pages: 'பக்கங்கள்',
  gradesByArea: 'துறைவாரியான தரங்கள்',
  gradesNote: 'தரங்கள் நிலையான சோதனைகளிலிருந்து மட்டுமே வருகின்றன. தரம் இல்லாத துறை சரிபார்க்கப்படவில்லை.',
  aiNote: 'AI குறிப்பு',
};

const WORDING: Partial<Record<DocumentLanguage, FindingsWording>> = { en: EN, ta: TA };

/** This document's own wording for `language` (English when the language has no table yet). */
export function findingsWording(language: DocumentLanguage): FindingsWording {
  return WORDING[language] ?? EN;
}

/** The order the groups are listed in. */
export const FINDING_GROUP_ORDER: readonly AuditFindingGroup[] = ['technical', 'marketing', 'content'];

export interface FindingsDocumentOptions {
  /** The language of the fixed wording; defaults to the version's language. */
  language?: DocumentLanguage;
  /** False leaves every effort value and the effort label out (the Owner Audit). Default true. */
  showEffort?: boolean;
}

/** True for a finding the AI wrote: shown as advice, it never changes a grade (ADR 0009, ADR 0029). */
function isAdvisory(finding: AuditFinding): boolean {
  return finding.advisory === true || finding.source === 'ai';
}

function findingBlocks(
  finding: AuditFinding,
  sectionsByPage: ReadonlyMap<string, readonly SectionSummary[]>,
  language: DocumentLanguage,
  labels: DocumentLabels,
  words: FindingsWording,
  showEffort: boolean
): DocBlock[] {
  const section = finding.sectionId
    ? sectionsByPage.get(finding.urlPath)?.find((s) => s.id === finding.sectionId)
    : undefined;
  const sectionText = finding.sectionId
    ? section
      ? sectionLabel(language, section)
      : finding.sectionId
    : contentWording(language).sectionKinds.page;

  const facts = [`${labels.columns.page}: ${finding.urlPath}`];
  if (finding.pages && finding.pages.length > 1) facts.push(`${words.pages}: ${finding.pages.join(', ')}`);
  facts.push(`${labels.columns.section}: ${sectionText}`);
  facts.push(`${labels.columns.area}: ${labels.areas[finding.area] ?? finding.area}`);
  facts.push(`${labels.columns.impact}: ${labels.scale[finding.impact] ?? finding.impact}`);
  if (showEffort) facts.push(`${labels.columns.effort}: ${labels.scale[finding.effort] ?? finding.effort}`);

  const blocks: DocBlock[] = [
    { type: 'heading', level: 2, text: finding.title },
    { type: 'list', items: facts },
  ];
  if (isAdvisory(finding)) blocks.push({ type: 'note', text: labels.status.aiNote });
  blocks.push({ type: 'paragraph', text: `${labels.columns.found}: ${finding.detail}` });
  blocks.push({ type: 'paragraph', text: `${labels.columns.suggestedFix}: ${finding.suggestion}` });
  return blocks;
}

/**
 * One area's row: its grade from fixed checks, or "Not checked" (also for an area the version has no entry
 * for); the AI note column holds the note, or why there is none.
 */
function areaRow(name: AuditArea, area: AreaAssessment | undefined, labels: DocumentLabels): string[] {
  const grade = area?.grade ?? labels.status.notChecked;
  const note = !area ? '' : area.status === 'done' ? area.note : (labels.aiNotDone[area.reason] ?? area.reason);
  return [labels.areas[name] ?? name, grade, note];
}

/** The Findings document for one edited version (REQ-018, REQ-020). */
export function buildFindingsDocument(view: EditedAuditView, options: FindingsDocumentOptions = {}): AuditDoc {
  const lookup = labelsFor(options.language ?? view.result.language);
  const { labels } = lookup;
  const language = lookup.language;
  const words = findingsWording(language);
  const showEffort = options.showEffort !== false;
  const { result } = view;
  const sectionsByPage = new Map(result.pages.map((p) => [p.urlPath, p.sections]));
  const blocks: DocBlock[] = [{ type: 'paragraph', text: `${contentWording(language).website}: ${result.url}` }];

  for (const group of FINDING_GROUP_ORDER) {
    blocks.push({ type: 'heading', level: 1, text: labels.groups[group] });
    // The version stores findings ranked; filtering keeps that order inside each group.
    const inGroup = result.findings.filter((f) => f.group === group);
    if (inGroup.length === 0) {
      blocks.push({ type: 'paragraph', text: labels.status.noneFound });
      continue;
    }
    for (const finding of inGroup) {
      blocks.push(...findingBlocks(finding, sectionsByPage, language, labels, words, showEffort));
    }
  }

  // Grades per area for the whole site: fixed checks decide the grade; the AI only writes the note.
  blocks.push({ type: 'heading', level: 1, text: words.gradesByArea });
  blocks.push({ type: 'paragraph', text: words.gradesNote });
  blocks.push({
    type: 'table',
    columns: [labels.columns.area, labels.columns.grade, words.aiNote],
    rows: AUDIT_AREAS.map((name) =>
      areaRow(
        name,
        result.siteAreas.find((a) => a.area === name),
        labels
      )
    ),
  });
  if (result.siteAreas.some((a) => a.status === 'done')) blocks.push({ type: 'note', text: labels.status.aiNote });

  return { kind: 'findings', title: labels.documentTitles.findings, language: lookup.requested ?? language, blocks };
}
