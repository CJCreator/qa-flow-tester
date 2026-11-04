/**
 * The block model every Audit Document, the Pitch Glimpse and the Owner Audit is built in, before it is
 * rendered to Markdown (render-markdown.ts) or self-contained HTML (render-html.ts).
 *
 * All text in a block is plain text: page text, labels and the tool user's edits alike. The renderers
 * escape it, so nothing in a block can add Markdown structure or HTML markup.
 */

import type { AuditDocumentKind, DocumentLanguage } from '@qa/types';

/** The five Audit Documents, plus the two documents made from a Website Audit that are not Audit Documents. */
export type AuditDocKind = AuditDocumentKind | 'pitch-glimpse' | 'owner-audit';

/** 1 is the first level under the document title (the title itself is the top heading). */
export type HeadingLevel = 1 | 2 | 3 | 4;

export type DocBlock =
  | { type: 'heading'; level: HeadingLevel; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  /** Every row has one cell per column; a short row is padded, extra cells are dropped. */
  | { type: 'table'; columns: string[]; rows: string[][] }
  /** `src` must be a base64 `data:image/...` URI (ADR 0021); anything else renders as a text note. */
  | { type: 'image'; src: string; alt: string; caption?: string }
  | { type: 'note'; text: string }
  | { type: 'pagebreak' };

export interface AuditDoc {
  kind: AuditDocKind;
  /** Rendered as the top heading and, in HTML, the page title. */
  title: string;
  /** The language the document is written in: the HTML `lang` attribute and the fixed labels. */
  language: DocumentLanguage;
  blocks: DocBlock[];
}

const DATA_IMAGE_URI = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** True for a base64 PNG, JPEG, GIF or WebP data URI: the only image source a document embeds. */
export function isEmbeddableImage(src: string): boolean {
  return DATA_IMAGE_URI.test(src);
}

/** A table's rows cut or padded to the column count. */
export function normalizedRows(block: Extract<DocBlock, { type: 'table' }>): string[][] {
  const width = block.columns.length;
  return block.rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''));
}
