/**
 * Renders an `AuditDoc` to one self-contained HTML file (ADR 0021): inline CSS, images only as `data:`
 * URIs, no script, link, font file or remote address. The `lang` and `dir` attributes come from the
 * document's language, the font stack covers Tamil, and the print CSS lays it out on A4.
 *
 * All text is HTML-escaped, so page text cannot add markup.
 */

import { DOCUMENT_LANGUAGE_INFO } from '@qa/types';
import { escapeHtml } from '../../html-report.js';
import { isEmbeddableImage, normalizedRows, type AuditDoc, type DocBlock } from './model.js';
import { documentBetaNote, labelsFor } from './labels/index.js';

/** Fonts that have Tamil glyphs on Android/Linux, Windows and older Windows, then a fallback. */
export const TAMIL_FONT_STACK = "'Noto Sans Tamil', 'Nirmala UI', 'Latha', 'FreeSerif', sans-serif";

// Nothing may load: only inline styles and data: images. A copy of the file opened anywhere stays offline.
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: ${TAMIL_FONT_STACK}; color: #0f172a; background: #ffffff; line-height: 1.6; margin: 0; }
  main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.5rem; }
  h1 { font-size: 1.75rem; margin: 0 0 1.25rem; }
  h2 { font-size: 1.35rem; margin: 1.75rem 0 0.75rem; }
  h3 { font-size: 1.15rem; margin: 1.5rem 0 0.5rem; }
  h4, h5 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
  p { margin: 0 0 0.75rem; white-space: pre-line; overflow-wrap: anywhere; }
  ul, ol { margin: 0 0 0.75rem; padding-inline-start: 1.5rem; }
  li { margin: 0.2rem 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 1rem; font-size: 0.9rem; }
  th, td { border: 1px solid #cbd5e1; padding: 0.4rem 0.55rem; text-align: start; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #f1f5f9; }
  figure { margin: 0 0 1rem; }
  figure img { max-width: 100%; height: auto; border: 1px solid #e2e8f0; }
  figcaption { font-size: 0.85rem; color: #475569; margin-top: 0.35rem; }
  .note { border-inline-start: 4px solid #64748b; background: #f8fafc; padding: 0.6rem 0.9rem; margin: 0 0 1rem; }
  .pagebreak { break-after: page; page-break-after: always; height: 0; }
  @page { size: A4; margin: 18mm 16mm; }
  @media print {
    main { max-width: none; padding: 0; }
    h1, h2, h3, h4, h5 { break-after: avoid; page-break-after: avoid; }
    tr, figure, .note { break-inside: avoid; page-break-inside: avoid; }
    thead { display: table-header-group; }
  }
`;

function renderBlock(block: DocBlock, doc: AuditDoc): string {
  switch (block.type) {
    case 'heading': {
      const tag = `h${Math.min(6, block.level + 1)}`;
      return `<${tag}>${escapeHtml(block.text)}</${tag}>`;
    }
    case 'paragraph':
      return block.text.trim() ? `<p>${escapeHtml(block.text)}</p>` : '';
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
    }
    case 'table': {
      if (block.columns.length === 0) return '';
      const head = `<thead><tr>${block.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr></thead>`;
      const body = normalizedRows(block)
        .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
        .join('');
      return `<table>${head}<tbody>${body}</tbody></table>`;
    }
    case 'image': {
      const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : '';
      if (!isEmbeddableImage(block.src)) {
        const missing = labelsFor(doc.language).labels.status.imageNotIncluded;
        return `<p class="note">${escapeHtml(missing)}: ${escapeHtml(block.alt)}</p>${block.caption ? `<p>${escapeHtml(block.caption)}</p>` : ''}`;
      }
      return `<figure><img src="${block.src}" alt="${escapeHtml(block.alt)}">${caption}</figure>`;
    }
    case 'note':
      return `<div class="note" role="note"><p>${escapeHtml(block.text)}</p></div>`;
    case 'pagebreak':
      return '<div class="pagebreak"></div>';
  }
}

/** The document as one HTML file. */
export function renderHtml(doc: AuditDoc): string {
  const rendered = labelsFor(doc.language).language;
  const dir = DOCUMENT_LANGUAGE_INFO[rendered]?.dir ?? 'ltr';
  const beta = documentBetaNote(doc.language);
  const body = [...(beta ? [{ type: 'note', text: beta } as DocBlock] : []), ...doc.blocks]
    .map((block) => renderBlock(block, doc))
    .filter(Boolean)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="${escapeHtml(rendered)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(doc.title)}</h1>
${body}
</main>
</body>
</html>
`;
}
