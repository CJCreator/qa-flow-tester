/**
 * Generating the documents of one finished audit version (REQ-018): the five Audit Documents (Structure,
 * Content, Findings, Improvement Roadmap, Proposal), the Pitch Glimpse and the Owner Audit.
 *
 * The edit overlay is applied once (`buildEditedView`) and every document is built from that one view, so
 * edits show the same way everywhere and removed pages show nowhere (REQ-020).
 *
 * Pure: no I/O. The Proposal date is `now` (the current time when not given).
 */

import {
  AUDIT_DOCUMENT_KINDS,
  type AuditDocumentKind,
  type AuditResult,
  type AuditSettings,
  type DocumentLanguage,
  type EditOverlay,
  type PageContent,
} from '@qa/types';
import { buildContentDocument } from './content.js';
import { buildEditedView, type EditedAuditView } from './edits.js';
import { buildFindingsDocument } from './findings.js';
import { labelsFor } from './labels/index.js';
import type { AuditDoc } from './model.js';
import { buildOwnerAudit } from './owner-audit.js';
import { buildPitchGlimpse, pitchGlimpseDoc } from './pitch.js';
import { fillProposal } from './proposal.js';
import { buildRoadmapDocument } from './roadmap-document.js';
import { defaultProposalTemplate } from './settings.js';
import { buildStructureDocument } from './structure.js';

/** The saved settings the documents use. The PageSpeed key is never needed here. */
export type DocumentSettings = Pick<AuditSettings, 'company' | 'proposalTemplate' | 'optOutText'>;

/** One finished version with its Page Content, the tool user's edits and the saved settings. */
export interface AuditDocumentsInput {
  result: AuditResult;
  contents: readonly PageContent[];
  edits: EditOverlay;
  settings: DocumentSettings;
  /** The document language; defaults to the version's language. */
  language?: DocumentLanguage;
  /** The Audit Documents wanted; all five when absent or empty. Always returned in the fixed order. */
  documents?: readonly AuditDocumentKind[];
  /** The Proposal's date; now when not given. */
  now?: Date | string;
}

/** The Audit Documents asked for, in the fixed order, each once. All five when none are asked for. */
export function selectedDocumentKinds(documents?: readonly AuditDocumentKind[]): AuditDocumentKind[] {
  if (!documents || documents.length === 0) return [...AUDIT_DOCUMENT_KINDS];
  return AUDIT_DOCUMENT_KINDS.filter((kind) => documents.includes(kind));
}

/** The edit overlay applied to the version: the one view every document is built from. */
export function editedViewOf(input: Pick<AuditDocumentsInput, 'result' | 'contents' | 'edits'>): EditedAuditView {
  return buildEditedView(input.result, input.contents, input.edits);
}

/**
 * The Proposal template for `language`: the saved one, or the default in that language when nothing was saved
 * or the saved one is the English default (settings resolve to the English default when nothing was saved).
 */
function proposalTemplateFor(settings: DocumentSettings, language: DocumentLanguage): string {
  const saved = settings.proposalTemplate;
  if (typeof saved !== 'string' || saved.trim() === '' || saved === defaultProposalTemplate('en')) {
    return defaultProposalTemplate(language);
  }
  return saved;
}

/** The Audit Documents of an already edited view. Used by the exports so the overlay is applied only once. */
export function documentsFromView(
  view: EditedAuditView,
  options: Pick<AuditDocumentsInput, 'settings' | 'language' | 'documents' | 'now'>
): AuditDoc[] {
  const lookup = labelsFor(options.language ?? view.result.language);
  const language = lookup.requested;
  const build: Record<AuditDocumentKind, () => AuditDoc> = {
    structure: () => buildStructureDocument(view, { language }),
    content: () => buildContentDocument(view, { language }),
    findings: () => buildFindingsDocument(view, { language }),
    roadmap: () => buildRoadmapDocument(view, lookup, { showEffort: true }),
    proposal: () =>
      fillProposal(
        proposalTemplateFor(options.settings, lookup.language),
        view,
        view.proposal,
        options.settings.company,
        lookup.labels,
        {
          language: lookup.requested ?? lookup.language,
          ...(options.now !== undefined ? { now: options.now } : {}),
        }
      ).doc,
  };
  return selectedDocumentKinds(options.documents).map((kind) => build[kind]());
}

/** The Audit Documents of one version with its edits applied, in the fixed order (REQ-018, REQ-020). */
export function generateAuditDocuments(input: AuditDocumentsInput): AuditDoc[] {
  return documentsFromView(editedViewOf(input), input);
}

export interface PitchGlimpseInput extends Pick<AuditDocumentsInput, 'result' | 'contents' | 'edits' | 'language'> {
  settings: Pick<DocumentSettings, 'optOutText'>;
  /** Screenshots as base64 `data:image/...` URIs, keyed by the finding's `screenshotPath`. */
  screenshots?: Readonly<Record<string, string>>;
}

/** The Pitch Glimpse of one version with its edits applied: the document and its one-page HTML (REQ-019). */
export function generatePitchGlimpse(input: PitchGlimpseInput): { doc: AuditDoc; html: string } {
  const view = editedViewOf(input);
  const options = {
    ...(input.language ? { language: input.language } : {}),
    optOutText: input.settings.optOutText,
    ...(input.screenshots ? { screenshots: input.screenshots } : {}),
  };
  return { doc: pitchGlimpseDoc(view, options), html: buildPitchGlimpse(view, options) };
}

export type OwnerAuditInput = Pick<AuditDocumentsInput, 'result' | 'contents' | 'edits' | 'language'>;

/**
 * The Owner Audit of one version with its edits applied (REQ-025). It takes no settings: the Proposal inputs
 * and company details never reach it.
 */
export function generateOwnerAudit(input: OwnerAuditInput): AuditDoc {
  const view = editedViewOf(input);
  return buildOwnerAudit(view, labelsFor(input.language ?? view.result.language));
}
