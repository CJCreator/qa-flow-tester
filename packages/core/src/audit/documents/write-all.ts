/**
 * Writing all seven Audit Documents when an audit ends (T-83, ADR 0042):
 * - The five Audit Documents: Structure, Content, Findings, Improvement Roadmap, Proposal
 * - Pitch Glimpse
 * - Owner Audit
 *
 * Each document is rendered in parallel as Markdown and HTML using `Promise.allSettled`,
 * in the audit's language.
 *
 * Stored via the audit store as:
 * - `{ kind, status: 'ready', title, formats: ['markdown', 'html'], updatedAt }`
 * - or `{ kind, status: 'not-written', title, reason }` (fixed wording, never the error's message)
 *
 * PDF and Word stay on export (not generated at audit end).
 */

import {
  type AuditResult,
  type AuditSettings,
  type DocumentLanguage,
  type EditOverlay,
  type PageContent,
  type StoredAuditDocument,
  type StoredDocumentKind,
} from '@qa/types';
import { documentsFromView, editedViewOf, type DocumentSettings } from './generate.js';
import { defaultProposalTemplate } from './settings.js';
import { pitchGlimpseDoc, renderPitchGlimpse } from './pitch.js';
import { buildOwnerAudit } from './owner-audit.js';
import { emptyOverlay } from './edits.js';
import { labelsFor } from './labels/index.js';
import type { AuditDoc } from './model.js';
import { renderMarkdown } from './render-markdown.js';
import { renderHtml } from './render-html.js';
import { STORED_DOCUMENT_KINDS } from '../store/keys.js';
import type { AuditVersionUpdate } from '../store/audit-store.js';
import { pageContentName } from '../pipeline/pipeline.js';

/** Fixed wording for the version record: never the error's own text (it can hold paths or storage details). */
const NOT_BUILT = 'The document could not be built.';
const NOT_SAVED = 'The document could not be saved.';

export type { StoredAuditDocument, StoredDocumentKind };

/** Settings accepted by writeAllDocuments: full AuditSettings or document subset. */
export type WriteAllSettings = Partial<Pick<AuditSettings, 'company' | 'proposalTemplate' | 'optOutText'>>;

export interface WriteAllDocumentsStore {
  saveAuditDocument(
    auditId: string,
    version: number,
    kind: StoredDocumentKind,
    format: 'markdown' | 'html',
    content: string
  ): Promise<void>;
  readVersionJson?<T = unknown>(auditId: string, version: number, name: string): Promise<T | null>;
  updateVersion?(auditId: string, version: number, update: AuditVersionUpdate): Promise<unknown>;
}

export interface WriteAllDocumentsOptions {
  /** Page content already in memory. When absent, loaded from store if store.readVersionJson exists. */
  contents?: readonly PageContent[];
  /** Tool user edits overlay. Loaded from store or defaults to emptyOverlay(). */
  edits?: EditOverlay;
  /** Language override; defaults to result.language. */
  language?: DocumentLanguage;
  /** Screenshots keyed by finding screenshotPath (data URIs). */
  screenshots?: Readonly<Record<string, string>>;
  /** Proposal date / time; defaults to current time. */
  now?: Date | string;
  /** Custom Markdown renderer (useful for tests or overrides). */
  renderMarkdown?: (doc: AuditDoc) => string | Promise<string>;
  /** Custom HTML renderer (useful for tests or overrides). */
  renderHtml?: (doc: AuditDoc) => string | Promise<string>;
}

/**
 * Writes all 7 Audit Documents when an audit completes (T-83, ADR 0042).
 * Renders Markdown and HTML in parallel using `Promise.allSettled`.
 * If any document fails to render or store, it is recorded as `not-written` with a reason,
 * leaving other documents written and marked `ready`.
 */
export async function writeAllDocuments(
  result: AuditResult,
  settings: WriteAllSettings,
  store: WriteAllDocumentsStore,
  options: WriteAllDocumentsOptions = {}
): Promise<StoredAuditDocument[]> {
  const language = options.language ?? result.language;
  const lookup = labelsFor(language);
  const resolvedSettings: DocumentSettings = {
    company: { name: '', address: '', email: '', phone: '', website: '', terms: '', ...settings.company },
    proposalTemplate: settings.proposalTemplate ?? defaultProposalTemplate(language),
    optOutText: settings.optOutText ?? {},
  };

  // 1. Resolve contents and edits
  let contents: readonly PageContent[] = options.contents ?? [];
  if (!options.contents && typeof store.readVersionJson === 'function') {
    const loaded: PageContent[] = [];
    for (const page of result.pages) {
      try {
        const c = await store.readVersionJson<PageContent>(
          result.auditId,
          result.version,
          pageContentName(page.urlPath)
        );
        if (c) loaded.push(c);
      } catch {
        // tolerate missing content
      }
    }
    if (loaded.length > 0) contents = loaded;
  }

  let edits = options.edits;
  if (!edits && typeof store.readVersionJson === 'function') {
    try {
      const loaded = await store.readVersionJson<EditOverlay>(result.auditId, result.version, 'edits');
      if (loaded) edits = loaded;
    } catch {
      // tolerate missing edits
    }
  }
  if (!edits) edits = emptyOverlay();

  // 2. Build the edited view once
  let view;
  try {
    view = editedViewOf({ result, contents, edits });
  } catch {
    return STORED_DOCUMENT_KINDS.map((kind) => ({
      kind,
      status: 'not-written' as const,
      title: lookup.labels.documentTitles[kind] ?? kind,
      reason: NOT_BUILT,
    }));
  }

  // 3. Define the document specs in STORED_DOCUMENT_KINDS order
  interface DocSpec {
    kind: StoredDocumentKind;
    title: string;
    generate: () => { doc: AuditDoc; customHtml?: string };
  }

  const specs: DocSpec[] = [
    {
      kind: 'structure',
      title: lookup.labels.documentTitles.structure,
      generate: () => ({
        doc: documentsFromView(view, {
          settings: resolvedSettings,
          language,
          documents: ['structure'],
          now: options.now,
        })[0]!,
      }),
    },
    {
      kind: 'content',
      title: lookup.labels.documentTitles.content,
      generate: () => ({
        doc: documentsFromView(view, {
          settings: resolvedSettings,
          language,
          documents: ['content'],
          now: options.now,
        })[0]!,
      }),
    },
    {
      kind: 'findings',
      title: lookup.labels.documentTitles.findings,
      generate: () => ({
        doc: documentsFromView(view, {
          settings: resolvedSettings,
          language,
          documents: ['findings'],
          now: options.now,
        })[0]!,
      }),
    },
    {
      kind: 'roadmap',
      title: lookup.labels.documentTitles.roadmap,
      generate: () => ({
        doc: documentsFromView(view, {
          settings: resolvedSettings,
          language,
          documents: ['roadmap'],
          now: options.now,
        })[0]!,
      }),
    },
    {
      kind: 'proposal',
      title: lookup.labels.documentTitles.proposal,
      generate: () => ({
        doc: documentsFromView(view, {
          settings: resolvedSettings,
          language,
          documents: ['proposal'],
          now: options.now,
        })[0]!,
      }),
    },
    {
      kind: 'pitch-glimpse',
      title: lookup.labels.documentTitles['pitch-glimpse'],
      generate: () => {
        const pitchOpts = {
          language,
          optOutText: resolvedSettings.optOutText,
          ...(options.screenshots ? { screenshots: options.screenshots } : {}),
        };
        const doc = pitchGlimpseDoc(view, pitchOpts);
        const customHtml = renderPitchGlimpse(doc);
        return { doc, customHtml };
      },
    },
    {
      kind: 'owner-audit',
      title: lookup.labels.documentTitles['owner-audit'],
      generate: () => ({
        doc: buildOwnerAudit(view, lookup),
      }),
    },
  ];

  // 4. Render and write each document in parallel
  const docTasks = specs.map(async (spec): Promise<StoredAuditDocument> => {
    let generated: { doc: AuditDoc; customHtml?: string };
    try {
      generated = spec.generate();
    } catch {
      return {
        kind: spec.kind,
        status: 'not-written',
        title: spec.title,
        reason: NOT_BUILT,
      };
    }

    const { doc, customHtml } = generated;
    const title = doc.title || spec.title;

    const renderMd = options.renderMarkdown ?? renderMarkdown;
    const renderH = (d: AuditDoc) => {
      if (options.renderHtml) return options.renderHtml(d);
      if (d.kind === 'pitch-glimpse' && customHtml) return customHtml;
      return renderHtml(d);
    };

    // Render Markdown and HTML in parallel using Promise.allSettled
    const [mdOutcome, htmlOutcome] = await Promise.allSettled([
      Promise.resolve().then(async () => {
        const md = await renderMd(doc);
        await store.saveAuditDocument(result.auditId, result.version, spec.kind, 'markdown', md);
        return md;
      }),
      Promise.resolve().then(async () => {
        const html = await renderH(doc);
        await store.saveAuditDocument(result.auditId, result.version, spec.kind, 'html', html);
        return html;
      }),
    ]);

    if (mdOutcome.status === 'fulfilled' && htmlOutcome.status === 'fulfilled') {
      return {
        kind: spec.kind,
        status: 'ready',
        title,
        formats: ['markdown', 'html'],
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      kind: spec.kind,
      status: 'not-written',
      title,
      reason: NOT_SAVED,
    };
  });

  const storedDocs = await Promise.all(docTasks);

  // 5. Record on version if updateVersion is available
  if (typeof store.updateVersion === 'function') {
    try {
      await store.updateVersion(result.auditId, result.version, { documents: storedDocs });
    } catch {
      // Non-fatal if updateVersion fails
    }
  }

  return storedDocs;
}
