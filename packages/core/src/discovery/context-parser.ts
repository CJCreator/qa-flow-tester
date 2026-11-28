import { promises as fs } from 'fs';
import { parseDocumentText } from '@qa/types';
import type { ParsedProductContext, ParsedRequirementHint } from '@qa/types';

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
      const parsed = parseDocumentText(doc.text, { document: doc.name, startIndex: reqCounter });
      reqCounter = parsed.nextIndex;
      requirements.push(...parsed.hints);

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
    const requirements: ParsedRequirementHint[] = parseDocumentText(content).hints;

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
