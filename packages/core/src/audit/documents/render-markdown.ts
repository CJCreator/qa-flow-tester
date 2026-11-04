/**
 * Renders an `AuditDoc` to GitHub-flavoured Markdown.
 *
 * Every piece of text is escaped first: page text cannot start a heading, list, quote, table or code block,
 * cannot close a table cell, and cannot add HTML (`<`, `>` and `&` become entities). Characters outside
 * ASCII punctuation, Tamil included, are kept as they are.
 */

import { isEmbeddableImage, normalizedRows, type AuditDoc, type DocBlock } from './model.js';
import { documentBetaNote, labelsFor } from './labels/index.js';

/**
 * One line of text, safe anywhere inline: emphasis, code, link, strikethrough, table and HTML characters
 * are escaped, line breaks become spaces, and a line-start marker (`#`, `-`, `+`, `=`, `1.`) is escaped.
 */
export function escapeMarkdownInline(text: string): string {
  const oneLine = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const escaped = oneLine
    .replace(/[\\`*_[\]|~]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // GFM autolinks: an address in page text stays text.
    .replace(/:\/\//g, '\\://')
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}\\.`);
  return escapeLineStart(escaped);
}

function escapeLineStart(line: string): string {
  return line.replace(/^([#+=-])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');
}

/** A paragraph: each line escaped on its own, kept as a hard line break; empty lines dropped. */
function paragraph(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => escapeMarkdownInline(line))
    .filter((line) => line.length > 0)
    .join('  \n');
}

function renderBlock(block: DocBlock, doc: AuditDoc): string {
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(6, block.level + 1))} ${escapeMarkdownInline(block.text)}`;
    case 'paragraph':
      return paragraph(block.text);
    case 'list':
      return block.items
        .map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${escapeMarkdownInline(item)}`)
        .join('\n');
    case 'table': {
      if (block.columns.length === 0) return '';
      const row = (cells: string[]) => `| ${cells.map((c) => escapeMarkdownInline(c) || ' ').join(' | ')} |`;
      return [row(block.columns), `|${block.columns.map(() => ' --- ').join('|')}|`, ...normalizedRows(block).map(row)].join('\n');
    }
    case 'image': {
      const alt = escapeMarkdownInline(block.alt);
      const image = isEmbeddableImage(block.src)
        ? `![${alt}](${block.src})`
        : `${escapeMarkdownInline(labelsFor(doc.language).labels.status.imageNotIncluded)}: ${alt}`;
      return block.caption ? `${image}\n\n${paragraph(block.caption)}` : image;
    }
    case 'note':
      return paragraph(block.text)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'pagebreak':
      return '---';
  }
}

/** The document as Markdown: its title as the top heading, then each block, separated by a blank line. */
export function renderMarkdown(doc: AuditDoc): string {
  const parts = [`# ${escapeMarkdownInline(doc.title)}`];
  const beta = documentBetaNote(doc.language);
  if (beta) parts.push(`> ${escapeMarkdownInline(beta)}`);
  for (const block of doc.blocks) {
    const text = renderBlock(block, doc);
    if (text) parts.push(text);
  }
  return `${parts.join('\n\n')}\n`;
}
