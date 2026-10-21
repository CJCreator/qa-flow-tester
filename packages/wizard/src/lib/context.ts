import { summarizeDocument, type DocumentSummary } from '@qa/types/src/browser.js';
import { plainError } from '../api';

export interface ReferenceFile {
  name: string;
  content: string;
  /** What the document yielded, counted in the browser. */
  summary?: DocumentSummary;
  /** Notes from reading a Word file. */
  warnings?: string[];
  /** Nothing was read (no headings, lists or tables). Kept as plain context but not counted as read. */
  unread?: boolean;
}

export const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt'];
export const DOCX_EXTENSION = '.docx';
/** Text and Markdown cap. */
export const MAX_FILE_BYTES = 500 * 1024;
/** Raw .docx cap, before conversion on the server. */
export const MAX_DOCX_BYTES = 2 * 1024 * 1024;

const NAMED_FORMATS: Record<string, string> = {
  '.pdf': 'a PDF',
  '.doc': 'an old Word document',
  '.docx': 'a Word document',
  '.pages': 'a Pages document',
  '.rtf': 'a rich-text document',
  '.odt': 'an OpenDocument file',
  '.png': 'an image',
  '.jpg': 'an image',
  '.jpeg': 'an image',
};

/**
 * Returns null when the file can be used, otherwise a sentence saying why not and what to do instead.
 * `allowDocx` is true only for the Documents picker; the single-file text boxes stay text-only.
 */
export function rejectReason(name: string, sizeBytes: number, options: { allowDocx?: boolean } = {}): string | null {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  const isDocx = options.allowDocx === true && ext === DOCX_EXTENSION;
  if (!isDocx && !ACCEPTED_EXTENSIONS.includes(ext)) {
    const kind = NAMED_FORMATS[ext] ?? 'not a text file';
    const allowed = options.allowDocx
      ? 'Only text (.txt), Markdown (.md) and Word (.docx) files can be added.'
      : 'Only text (.txt) and Markdown (.md) files can be added.';
    return `“${name}” is ${kind}. ${allowed} Copy its text into the box below instead.`;
  }
  if (isDocx && sizeBytes > MAX_DOCX_BYTES) {
    return `“${name}” is larger than 2 MB. Save only the parts that describe how the product should work.`;
  }
  if (!isDocx && sizeBytes > MAX_FILE_BYTES) {
    return `“${name}” is larger than 500 KB. Add the parts that describe how the product should work.`;
  }
  return null;
}

/**
 * Joins every file and the pasted notes into one Product Context document. Each source gets its
 * own top-level heading, so the heading-based context parser keeps them apart and still sees each
 * file's own headings as separate requirements. Returns undefined when there is nothing to send.
 */
export function buildProductContext(files: ReferenceFile[], pasted: string): string | undefined {
  const parts = files
    .filter((f) => f.content.trim())
    .map((f) => `# Reference file: ${f.name}\n\n${f.content.trim()}\n`);
  if (pasted.trim()) parts.push(`# Pasted notes\n\n${pasted.trim()}\n`);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/** What the file picker gives us; a browser `File` fits. */
export interface PickedFile {
  name: string;
  size: number;
  text(): Promise<string>;
  /** Needed for .docx files, which the QA Tool converts to Markdown. */
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export interface ReadDeps {
  convertDocx?: (name: string, base64: string) => Promise<{ text: string; warnings?: string[] }>;
}

export const MAX_CONTEXT_FILES = 10;

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** One plain line for the per-document read report, such as "3 requirements, 4 User Flows, 2 tables". */
export function describeSummary(summary: DocumentSummary): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    count(summary.requirements, 'requirement', 'requirements'),
    count(summary.journeys, 'User Flow', 'User Flows'),
    count(summary.tables, 'table', 'tables'),
  ].join(', ');
}

export function isUnread(summary: DocumentSummary): boolean {
  return summary.requirements === 0 && summary.journeys === 0 && summary.tables === 0;
}

export function unreadMessage(name: string): string {
  return `Nothing was read from ${name}. Make sure it has headings, lists or tables.`;
}

/** Documents that yielded something; flagged ones are not counted. */
export function readCount(files: ReferenceFile[]): number {
  return files.filter((f) => !f.unread).length;
}

/**
 * Reads picked files one by one. Accepted files keep their own name (so a Source can say which
 * document it came from); rejected ones come back as plain sentences to show next to the picker.
 */
export async function readContextFiles(
  files: PickedFile[],
  alreadyAdded = 0,
  deps: ReadDeps = {}
): Promise<{ accepted: ReferenceFile[]; rejected: string[] }> {
  const accepted: ReferenceFile[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const why = rejectReason(file.name, file.size, { allowDocx: true });
    if (why) {
      rejected.push(why);
      continue;
    }
    if (alreadyAdded + accepted.length >= MAX_CONTEXT_FILES) {
      rejected.push(`“${file.name}” was not added. You can add up to ${MAX_CONTEXT_FILES} files.`);
      continue;
    }
    try {
      let content: string;
      let warnings: string[] | undefined;
      if (file.name.toLowerCase().endsWith(DOCX_EXTENSION)) {
        if (!file.arrayBuffer || !deps.convertDocx) throw new Error('no converter');
        const converted = await deps.convertDocx(file.name, arrayBufferToBase64(await file.arrayBuffer()));
        content = converted.text;
        warnings = converted.warnings?.length ? converted.warnings : undefined;
      } else {
        content = await file.text();
      }
      if (!content.trim()) {
        rejected.push(`“${file.name}” is empty.`);
        continue;
      }
      const summary = summarizeDocument(content);
      accepted.push({
        name: file.name,
        content,
        summary,
        ...(warnings ? { warnings } : {}),
        ...(isUnread(summary) ? { unread: true } : {}),
      });
    } catch (err) {
      const message = plainError(err, '');
      rejected.push(message || `“${file.name}” couldn’t be read. Try adding it again.`);
    }
  }
  return { accepted, rejected };
}

/** The run-body form of the picked files: one entry per document. */
export function toContextDocuments(files: ReferenceFile[]): Array<{ name: string; text: string }> {
  return files.filter((f) => f.content.trim()).map((f) => ({ name: f.name, text: f.content }));
}

/**
 * Splits a stored product-context.md back into the typed text and the named documents it was built
 * from, so a re-run sends the documents again and Sources keep their names.
 */
export function splitStoredContext(text: string | undefined): {
  productContext?: string;
  documents?: Array<{ name: string; text: string }>;
} {
  if (!text) return {};
  const parts = text.split(/^# Document: (.*)$/m);
  const head = parts[0].trim();
  const documents: Array<{ name: string; text: string }> = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i + 1] ?? '').replace(/^\n/, '').trim();
    if (body) documents.push({ name: parts[i].trim(), text: body });
  }
  return { productContext: head || undefined, documents: documents.length ? documents : undefined };
}
