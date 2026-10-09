import { promises as fs } from 'fs';

export interface ParsedRequirementHint {
  id: string;
  name: string;
  description: string;
  expectedFlow?: string;
  rules: string[];
  /** Name of the document this came from (file name or page address). Set by `parseDocuments`. */
  document?: string;
  /** Heading path inside the document, e.g. "Admin > Users". Set by `parseDocuments`. */
  section?: string;
}

export interface ParsedProductContext {
  summary: string;
  requirements: ParsedRequirementHint[];
  rawContent: string;
}

export type ContextNameCheck = { ok: true } | { ok: false; message: string };

const UNSUPPORTED_CONTEXT_MESSAGE = 'PDF and Word files are not supported yet. Save the text as .md or .txt.';

/** Only plain-text Product Context files are accepted: .md, .markdown, .txt. */
export function isSupportedContextName(name: string): ContextNameCheck {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return { ok: true };
  if (ext === 'pdf' || ext === 'docx' || ext === 'doc') return { ok: false, message: UNSUPPORTED_CONTEXT_MESSAGE };
  return { ok: false, message: 'Only .md and .txt files can be used as Product Context.' };
}

export class ContextParser {
  /** Several documents at once. Ids are unique across all of them; each hint keeps its document and section. */
  parseDocuments(docs: Array<{ name: string; text: string }>): ParsedProductContext {
    const requirements: ParsedRequirementHint[] = [];
    const summaries: string[] = [];
    const raw: string[] = [];
    let reqCounter = 1;

    for (const doc of docs) {
      raw.push(`# Document: ${doc.name}\n${doc.text}`);
      const lines = doc.text.split('\n');
      const stack: Array<{ level: number; title: string }> = [];
      let current: ParsedRequirementHint | null = null;

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('#') && line.length > 2) {
          if (current) requirements.push(current);
          const level = /^#+/.exec(line)?.[0].length ?? 1;
          const title = line.replace(/^#+\s*/, '');
          while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
          stack.push({ level, title });
          current = {
            id: `REQ-${reqCounter++}`,
            name: title,
            description: title,
            rules: [],
            document: doc.name,
            section: stack.map((s) => s.title).join(' > '),
          };
        } else if (current && (line.startsWith('-') || line.startsWith('*'))) {
          current.rules.push(line.replace(/^[-*]\s*/, ''));
        } else if (current && line.length > 0 && !current.description) {
          current.description = line;
        }
      }
      if (current) requirements.push(current);

      const first = lines
        .filter((l) => l.trim().length > 0 && !l.startsWith('#'))
        .slice(0, 3)
        .join(' ');
      if (first) summaries.push(first);
    }

    return {
      summary: summaries.join(' ').slice(0, 600) || 'Extracted Product Context',
      requirements,
      rawContent: raw.join('\n\n'),
    };
  }

  async parseFile(filePath?: string): Promise<ParsedProductContext> {
    if (!filePath) {
      return {
        summary: 'No external product context provided.',
        requirements: [],
        rawContent: '',
      };
    }

    try {
      const content = await fs.readFile(filePath, 'utf8');
      return this.parseContent(content);
    } catch (err: unknown) {
      return {
        summary: `Could not read context file: ${err instanceof Error ? err.message : String(err)}`,
        requirements: [],
        rawContent: '',
      };
    }
  }

  parseContent(content: string): ParsedProductContext {
    const lines = content.split('\n');
    const requirements: ParsedRequirementHint[] = [];
    let reqCounter = 1;

    let currentReq: ParsedRequirementHint | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Look for headers like "## Invoice Creation" or "### User Story: Sign In"
      if (line.startsWith('#') && line.length > 2) {
        if (currentReq) {
          requirements.push(currentReq);
        }
        const headerTitle = line.replace(/^#+\s*/, '');
        currentReq = {
          id: `REQ-${reqCounter++}`,
          name: headerTitle,
          description: headerTitle,
          rules: [],
        };
      } else if (currentReq && (line.startsWith('-') || line.startsWith('*'))) {
        const item = line.replace(/^[-*]\s*/, '');
        currentReq.rules.push(item);
      } else if (currentReq && line.length > 0 && !currentReq.description) {
        currentReq.description = line;
      }
    }

    if (currentReq) {
      requirements.push(currentReq);
    }

    const firstFewLines = lines
      .filter((l) => l.trim().length > 0 && !l.startsWith('#'))
      .slice(0, 3)
      .join(' ');

    return {
      summary: firstFewLines || 'Extracted Product Context',
      requirements,
      rawContent: content,
    };
  }
}
