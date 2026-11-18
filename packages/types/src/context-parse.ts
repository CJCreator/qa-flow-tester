/**
 * Pure Product Context parser. No Node imports: the Wizard imports this module directly
 * (`@qa/types/src/context-parse.js`) to count what it read from a document.
 */

export type ParsedHintKind = 'section' | 'journey' | 'negative' | 'route' | 'capability';

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
  /** What kind of unit this is. Absent on hints from older callers (treated as 'section'). */
  kind?: ParsedHintKind;
  /** Who the unit is about: from a Persona line, else the nearest heading ("Employee" in "4.1 Employee — Aarav"). */
  persona?: string;
  /** Set later by the planner when the persona is matched to a configured role. */
  personaRole?: string;
  preconditions?: string[];
  steps?: string[];
  assert?: string[];
  /** `route` hints: the path, e.g. "/report". */
  route?: string;
  /** `route` hints: the raw Roles cell, e.g. "lead / manager / HR". */
  rolesText?: string;
  /** `capability` hints: cell text by column header (role names). */
  cells?: Record<string, string>;
}

export interface ParsedProductContext {
  summary: string;
  requirements: ParsedRequirementHint[];
  rawContent: string;
}

export interface ParseDocumentOptions {
  /** When set, hints carry `document` and `section`. */
  document?: string;
  /** First id number; ids are `REQ-<n>`. Default 1. */
  startIndex?: number;
}

export interface ParseDocumentResult {
  hints: ParsedRequirementHint[];
  /** Next unused id number, so several documents share one counter. */
  nextIndex: number;
  /** Number of Markdown tables found. */
  tables: number;
}

export interface DocumentSummary {
  /** Sections, route rows, capability rows and negative-spec lines. */
  requirements: number;
  journeys: number;
  tables: number;
  rules: number;
}

export type ContextNameCheck = { ok: true } | { ok: false; message: string };

const UNSUPPORTED_CONTEXT_MESSAGE = 'PDF and old .doc files are not supported. Save as .docx, .md or .txt.';

/** Product Context files: .md, .markdown, .txt, .docx. */
export function isSupportedContextName(name: string): ContextNameCheck {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === 'docx') return { ok: true };
  if (ext === 'pdf' || ext === 'doc') return { ok: false, message: UNSUPPORTED_CONTEXT_MESSAGE };
  return { ok: false, message: 'Only .md, .txt and .docx files can be used as Product Context.' };
}

const BULLET = /^[-*+]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const FIELD =
  /^(persona|role|preconditions?|given|steps?|when|expected(?:\s+results?)?|assert(?:ion)?s?|then)\s*(?::\s*(.*))?$/i;
const AS_A = /^as an?\s+(.+?)(?:\s*,|\s+i\s|\s+who\b|\s*$)/i;
const JID = String.raw`(?:\d[\w.]*|[A-Za-z]\d[\w.]*|[A-Z]\b)`;
/** "J1 — title", "Journey 2: title", "Flow A - title", "Scenario: title", "User story 3 — title". */
const JOURNEY_HEADING = new RegExp(
  String.raw`^(J\d+|Journey\s+${JID}|Flow\s+${JID}|Scenario(?:\s+${JID})?|User story(?:\s+${JID})?)(?:\s*[—–:-]\s*(.*))?$`,
  'i'
);
const JOURNEY = /^\*\*\s*Journey\b([^*]*:[^*]*)\*\*(.*)$/i;
const NEGATIVE = /^\*\*\s*Negative specs?\s*:?\s*\*\*\s*:?\s*(.*)$/i;

function stripBold(s: string): string {
  return s.replace(/\*\*/g, '').trim();
}

function splitCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => stripBold(c.replace(/\\\|/g, '|')));
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')));
}

function splitList(text: string, seps: RegExp): string[] {
  return text
    .split(seps)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitSteps(text: string): string[] {
  return splitList(text, /\s*(?:→|->|;|(?:^|\s)\d+[.)]\s+)\s*/);
}

/** "4.1 Employee — Aarav Sharma" gives "Employee". */
function personaFromHeading(title: string): { text: string; hasSeparator: boolean } {
  const noNumber = title.replace(/^\d+(?:\.\d+)*[.)]?\s+/, '');
  const m = /^(.*?)(?:\s+[—–-]\s+|\s*:\s+)/.exec(noNumber);
  const text = stripBold((m ? m[1] : noNumber).replace(/`/g, ''));
  return { text, hasSeparator: Boolean(m) };
}

function personaFromStack(stack: Array<{ level: number; title: string }>): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = personaFromHeading(stack[i].title);
    if (p.hasSeparator && p.text) return p.text;
  }
  const last = stack[stack.length - 1];
  return last ? personaFromHeading(last.title).text || undefined : undefined;
}

/**
 * Parse one document's text into units: headings, bold-line journeys, `**Negative specs:**` lines and
 * table rows. Deterministic: ids follow document order.
 */
export function parseDocumentText(text: string, options: ParseDocumentOptions = {}): ParseDocumentResult {
  const { document } = options;
  let counter = options.startIndex ?? 1;
  const hints: ParsedRequirementHint[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  const lines = text.split(/\r?\n/);

  let section: ParsedRequirementHint | null = null;
  /** The unit that bullets and numbered items attach to (a section, journey or negative line). */
  let current: ParsedRequirementHint | null = null;
  let pendingField: 'preconditions' | 'steps' | 'assert' | 'persona' | null = null;
  let tables = 0;
  let tableRows: string[][] = [];
  let fence: string[] | null = null;

  const path = (): string => stack.map((s) => s.title).join(' > ');
  const make = (
    name: string,
    sectionPath: string,
    extra: Partial<ParsedRequirementHint> = {}
  ): ParsedRequirementHint => {
    const hint: ParsedRequirementHint = { id: `REQ-${counter++}`, name, description: '', rules: [], ...extra };
    if (document !== undefined) {
      hint.document = document;
      hint.section = sectionPath;
    }
    hints.push(hint);
    return hint;
  };

  const flushTable = (): void => {
    if (tableRows.length === 0) return;
    const rows = tableRows;
    tableRows = [];
    tables++;
    const header = rows[0];
    const body = rows.slice(1).filter((r) => !isSeparatorRow(r));
    const lower = header.map((h) => h.toLowerCase());
    const routeCol = lower.findIndex((h) => /^(route|url|path)$/.test(h));
    const rolesCol = lower.findIndex((h) => /^(roles?|who|access)$/.test(h));
    const sectionPath = path();
    if (routeCol >= 0 && rolesCol >= 0) {
      const pageCol = lower.findIndex(
        (h, i) => i !== routeCol && i !== rolesCol && /^(page|screen|name|title)$/.test(h)
      );
      for (const row of body) {
        const route = (row[routeCol] ?? '').replace(/`/g, '').trim();
        if (!route) continue;
        const page = pageCol >= 0 ? (row[pageCol] ?? '').trim() : '';
        make(page || route, sectionPath, {
          kind: 'route',
          route,
          rolesText: (row[rolesCol] ?? '').trim(),
          ...(page ? { description: page } : {}),
        });
      }
      return;
    }
    if (/^capabilit/.test(lower[0] ?? '')) {
      for (const row of body) {
        const capability = (row[0] ?? '').trim();
        if (!capability) continue;
        const cells: Record<string, string> = {};
        for (let i = 1; i < header.length; i++) cells[header[i]] = (row[i] ?? '').trim();
        make(capability, sectionPath, { kind: 'capability', cells });
      }
      return;
    }
    const target = section;
    if (!target) return;
    for (const row of body) {
      const parts = header.map((h, i) => ((row[i] ?? '').trim() ? `${h}: ${row[i].trim()}` : '')).filter(Boolean);
      if (parts.length > 0) target.rules.push(parts.join('; '));
    }
  };

  const applyField = (clean: string): boolean => {
    if (!current) return false;
    const f = FIELD.exec(clean);
    if (!f) return false;
    const key = f[1].toLowerCase();
    const value = (f[2] ?? '').trim();
    if (key === 'persona' || key === 'role') {
      if (value) current.persona = personaFromHeading(value).text || value;
      pendingField = null;
    } else if (key.startsWith('precondition') || key === 'given') {
      if (value) current.preconditions = [...(current.preconditions ?? []), ...splitList(value, /\s*;\s*/)];
      pendingField = 'preconditions';
    } else if (key.startsWith('step') || key === 'when') {
      if (value) current.steps = [...(current.steps ?? []), ...splitSteps(value)];
      pendingField = 'steps';
    } else {
      if (value) current.assert = [...(current.assert ?? []), ...splitList(value, /\s*;\s*/)];
      pendingField = 'assert';
    }
    return true;
  };

  const addBullet = (item: string): void => {
    if (!current) return;
    if (current.kind === 'journey') {
      const clean = stripBold(item);
      if (applyField(clean)) return;
      const asA = AS_A.exec(clean);
      if (asA) {
        current.persona = asA[1].trim();
        return;
      }
      if (pendingField === 'preconditions') (current.preconditions ??= []).push(clean);
      else if (pendingField === 'steps') (current.steps ??= []).push(...splitSteps(clean));
      else if (pendingField === 'assert') (current.assert ??= []).push(clean);
      else current.rules.push(item);
      return;
    }
    current.rules.push(item);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (fence) {
      if (line.startsWith('```') || line.startsWith('~~~')) {
        const body = fence;
        fence = null;
        const target = current ?? section;
        if (target && body.some((l) => l.trim())) {
          target.expectedFlow = body.join('\n').trim();
          for (const l of body) {
            if (!/→|->/.test(l)) continue;
            for (const seg of splitList(l, /\s*(?:→|->)\s*/)) target.rules.push(seg);
          }
        }
      } else {
        fence.push(rawLine);
      }
      continue;
    }

    if (line.startsWith('|')) {
      tableRows.push(splitCells(line));
      continue;
    }
    flushTable();

    if (line.startsWith('```') || line.startsWith('~~~')) {
      fence = [];
      continue;
    }

    const heading = /^(#+)\s*(\S.*)$/.exec(line);
    if (heading && line.length > 2) {
      const level = heading[1].length;
      const title = heading[2].trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      const jh = JOURNEY_HEADING.exec(stripBold(title).replace(/^\d+(?:\.\d+)*[.)]?\s+/, ''));
      if (jh) {
        // A journey heading is a unit, not a persona source: it stays off the heading stack.
        const jt = (jh[2] ?? '').trim() || jh[1].trim();
        const persona = personaFromStack(stack);
        section = make(jt, [path(), jt].filter(Boolean).join(' > '), {
          kind: 'journey',
          description: jh[1].trim(),
          ...(persona ? { persona } : {}),
        });
        current = section;
        pendingField = null;
        continue;
      }
      stack.push({ level, title });
      section = make(title, path(), { kind: 'section', description: '' });
      current = section;
      pendingField = null;
      continue;
    }

    const journey = JOURNEY.exec(line);
    if (journey) {
      const inner = journey[1].replace(/^\s+/, '');
      const colon = inner.indexOf(':');
      const label = colon >= 0 ? inner.slice(0, colon).trim() : '';
      const title = (colon >= 0 ? inner.slice(colon + 1) : inner).trim() || `Journey ${label}`.trim();
      const ref = /\*\(([^)]*)\)\*/.exec(journey[2])?.[1]?.trim();
      const desc = ['Journey', label].filter(Boolean).join(' ') + (ref ? ` (${ref})` : '');
      const persona = personaFromStack(stack);
      current = make(title, [path(), title].filter(Boolean).join(' > '), {
        kind: 'journey',
        description: desc,
        ...(persona ? { persona } : {}),
      });
      pendingField = null;
      continue;
    }

    const negative = NEGATIVE.exec(line);
    if (negative) {
      const persona = personaFromStack(stack);
      current = make('Negative specs', path(), {
        kind: 'negative',
        ...(persona ? { persona } : {}),
      });
      current.rules.push(...splitList(negative[1], /\s*;\s*/));
      pendingField = null;
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      addBullet(bullet[1].trim());
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      addBullet(numbered[1].trim());
      continue;
    }
    if (line.length > 0 && current && current.kind === 'journey') {
      const clean = stripBold(line);
      if (applyField(clean)) continue;
      const asA = AS_A.exec(clean);
      if (asA) current.persona = asA[1].trim();
      continue;
    }
    if (
      line.length > 0 &&
      current &&
      current.kind !== 'journey' &&
      current.kind !== 'negative' &&
      !current.description
    ) {
      current.description = line;
    }
  }
  flushTable();

  return { hints, nextIndex: counter, tables };
}

/** What a document yielded. All of `requirements`, `journeys` and `tables` zero means nothing was read. */
export function summarizeDocument(text: string): DocumentSummary {
  const { hints, tables } = parseDocumentText(text);
  let journeys = 0;
  let rules = 0;
  for (const h of hints) {
    if (h.kind === 'journey') journeys++;
    rules += h.rules.length;
  }
  return { requirements: hints.length - journeys, journeys, tables, rules };
}
