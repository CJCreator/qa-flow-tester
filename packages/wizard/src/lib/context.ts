export interface ReferenceFile {
  name: string;
  content: string;
}

export const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt'];
export const MAX_FILE_BYTES = 1024 * 1024;

const NAMED_FORMATS: Record<string, string> = {
  '.pdf': 'a PDF',
  '.doc': 'a Word document',
  '.docx': 'a Word document',
  '.pages': 'a Pages document',
  '.rtf': 'a rich-text document',
  '.odt': 'an OpenDocument file',
  '.png': 'an image',
  '.jpg': 'an image',
  '.jpeg': 'an image',
};

/** Returns null when the file can be used, otherwise a sentence saying why not and what to do instead. */
export function rejectReason(name: string, sizeBytes: number): string | null {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    const kind = NAMED_FORMATS[ext] ?? 'not a text file';
    return `“${name}” is ${kind}. Only text (.txt) and Markdown (.md) files can be added. Copy its text into the box below instead.`;
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    return `“${name}” is larger than 1 MB. Add the parts that describe how the product should work.`;
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
}

export const MAX_CONTEXT_FILES = 10;

/**
 * Reads picked files one by one. Accepted files keep their own name (so a Source can say which
 * document it came from); rejected ones come back as plain sentences to show next to the picker.
 */
export async function readContextFiles(
  files: PickedFile[],
  alreadyAdded = 0
): Promise<{ accepted: ReferenceFile[]; rejected: string[] }> {
  const accepted: ReferenceFile[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const why = rejectReason(file.name, file.size);
    if (why) {
      rejected.push(why);
      continue;
    }
    if (alreadyAdded + accepted.length >= MAX_CONTEXT_FILES) {
      rejected.push(`“${file.name}” was not added. You can add up to ${MAX_CONTEXT_FILES} files.`);
      continue;
    }
    try {
      const content = await file.text();
      if (!content.trim()) {
        rejected.push(`“${file.name}” is empty.`);
        continue;
      }
      accepted.push({ name: file.name, content });
    } catch {
      rejected.push(`“${file.name}” couldn’t be read. Try adding it again.`);
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
