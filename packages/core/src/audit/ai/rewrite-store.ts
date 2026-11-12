/**
 * The Section rewrites of one audit version (REQ-030), kept in the audit store as `rewrites.json` in the version
 * folder (ADR 0036), so it is deleted with the audit. One RewriteState per (urlPath, sectionId): the tool user
 * approves the Section, the AI writes new copy, the tool user accepts (edited) copy, which becomes a SectionEdit
 * marked `by: 'rewrite'` for the edit overlay. The file holds no key: only paths, ids, copy and times.
 *
 * Nothing here reaches the audited site: the original is the Section text from Page Content (ADR 0030).
 */
import {
  isDocumentLanguage,
  sectionText,
  type AuditErrorCode,
  type DocumentLanguage,
  type OverlapFlag,
  type PageContent,
  type RewriteState,
  type SectionEdit,
} from '@qa/types';
import type { AuditStore } from '../store/audit-store.js';
import { AuditStoreError } from '../store/backend.js';
import { BAD_CONTROL, ID_PATTERN as SECTION_ID, MAX_SECTION_EDIT_CHARS, editPathProblem } from '../documents/edits.js';
import { findOverlaps, overlapThreshold, writeRewrite, type RewriteAiProblem } from './rewrite.js';
import type { AuditAiResolution } from './stage-ai.js';

export const REWRITES_FILE = 'rewrites.json';
const REWRITES_NAME = 'rewrites';
const SCHEMA_VERSION = 1;

export type RewriteStoreBackend = Pick<AuditStore, 'readVersionJson' | 'writeVersionJson'>;

interface StoredFile {
  schemaVersion: number;
  rewrites: RewriteState[];
}

export interface RewriteSection {
  urlPath: string;
  sectionId: string;
}

export type RewriteRefusalCode = Extract<
  AuditErrorCode,
  'ERR_INVALID_REQUEST' | 'ERR_NOT_APPROVED' | 'ERR_NO_AI_KEY' | 'ERR_OVERLAP'
>;

export type RewriteFailure =
  | {
      ok: false;
      code: RewriteRefusalCode;
      /** Plain words for the tool user; no internals. */
      message: string;
      /** ERR_INVALID_REQUEST: a message per field. */
      fields?: Record<string, string>;
      /** ERR_OVERLAP: the runs the copy still shares with the original. */
      overlaps?: OverlapFlag[];
    }
  /** The AI did not give usable copy (spent budget, provider failure, claim words after the retry). */
  | { ok: false; code: 'ai-failed'; problem: RewriteAiProblem; message: string };

export type RewriteResult = { ok: true; rewrite: RewriteState } | RewriteFailure;
export type RewriteAcceptResult = { ok: true; rewrite: RewriteState; edit: SectionEdit } | RewriteFailure;

export interface RewriteRunInput extends RewriteSection {
  /** The document language the copy is written in. */
  language: DocumentLanguage;
}

export interface RewriteRunDeps {
  /** Called only once the Section is approved, so no key is looked up before. */
  resolveAi: () => Promise<AuditAiResolution>;
  /** The page's Page Content, as the crawl recorded it. */
  content: PageContent | null;
  /** AuditSettings.rewriteOverlapWords. */
  overlapWords?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => Date;
}

export interface RewriteAcceptInput extends RewriteSection {
  text: string;
}

export interface RewriteAcceptDeps {
  content: PageContent | null;
  overlapWords?: number;
  now?: () => Date;
}

const keyOf = (s: RewriteSection): string => `${s.urlPath}\n${s.sectionId}`;

function sectionProblems(input: Partial<RewriteSection>): Record<string, string> {
  const fields: Record<string, string> = {};
  const pathProblem = editPathProblem(input.urlPath);
  if (pathProblem) fields.urlPath = pathProblem;
  if (typeof input.sectionId !== 'string' || !SECTION_ID.test(input.sectionId)) {
    fields.sectionId = 'must be a Section id such as s1.';
  }
  return fields;
}

function invalid(fields: Record<string, string>): RewriteFailure {
  return { ok: false, code: 'ERR_INVALID_REQUEST', message: 'Some values are not valid.', fields };
}

const NOT_APPROVED: RewriteFailure = {
  ok: false,
  code: 'ERR_NOT_APPROVED',
  message: 'Approve this Section for a rewrite first.',
};

const AI_MESSAGES: Record<RewriteAiProblem, string> = {
  'budget-spent': 'The AI request limit for this audit is used up, so no rewrite was written.',
  failed: 'The AI did not answer with new copy. Try again later.',
  'claim-words': 'The AI copy used wording the documents do not allow. Try again.',
};

/** The Section's original text from Page Content, or undefined when the page or Section is not recorded. */
function originalText(content: PageContent | null, s: RewriteSection): string | undefined {
  if (!content || content.urlPath !== s.urlPath) return undefined;
  const section = content.sections.find((x) => x.id === s.sectionId);
  return section ? sectionText(content, section) : undefined;
}

/** Keeps only well-formed stored entries, one per Section. */
function cleanStates(raw: unknown): RewriteState[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, RewriteState>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (Object.keys(sectionProblems(e as Partial<RewriteSection>)).length > 0) continue;
    const time = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const p = e.proposal as Record<string, unknown> | null | undefined;
    const proposal =
      p &&
      typeof p === 'object' &&
      typeof p.text === 'string' &&
      isDocumentLanguage(p.language) &&
      typeof p.createdAt === 'string'
        ? {
            text: p.text,
            language: p.language,
            overlaps: Array.isArray(p.overlaps)
              ? (p.overlaps as unknown[]).filter(
                  (o): o is OverlapFlag =>
                    !!o &&
                    typeof (o as OverlapFlag).words === 'string' &&
                    typeof (o as OverlapFlag).wordCount === 'number'
                )
              : [],
            createdAt: p.createdAt,
          }
        : null;
    const state: RewriteState = {
      urlPath: e.urlPath as string,
      sectionId: e.sectionId as string,
      approvedAt: time(e.approvedAt),
      proposal,
      acceptedAt: time(e.acceptedAt),
    };
    out.set(keyOf(state), state);
  }
  return [...out.values()];
}

/**
 * One save queue per audit version, shared by every RewriteStore of this process: the runner builds a new
 * store for each request, so a queue kept on the instance would not stop two requests overwriting each other.
 */
const SAVE_QUEUES = new Map<string, Promise<unknown>>();

export class RewriteStore {
  /** The version's rewrites object in the audit store (`audits/<id>/v<n>/rewrites.json`), deleted with the audit. */
  constructor(
    private readonly store: RewriteStoreBackend,
    private readonly auditId: string,
    private readonly version: number
  ) {}

  private get queueKey(): string {
    return `${this.auditId}\n${this.version}`;
  }

  /** Every Section's rewrite state; empty when nothing is saved or the file is unreadable. */
  async list(): Promise<RewriteState[]> {
    let data: Partial<StoredFile> | null;
    try {
      data = await this.store.readVersionJson<Partial<StoredFile>>(this.auditId, this.version, REWRITES_NAME);
    } catch (err) {
      // An unreadable object reads as empty, as before; a store that cannot be reached is an error.
      if (err instanceof AuditStoreError && err.code === 'invalid-data') return [];
      throw err;
    }
    if (data && typeof data.schemaVersion === 'number' && data.schemaVersion > SCHEMA_VERSION) return [];
    return cleanStates(data?.rewrites);
  }

  async get(s: RewriteSection): Promise<RewriteState | undefined> {
    return (await this.list()).find((r) => keyOf(r) === keyOf(s));
  }

  /** Records the tool user's approval; approving again keeps the first time. */
  approve(s: RewriteSection, now: () => Date = () => new Date()): Promise<RewriteResult> {
    const fields = sectionProblems(s);
    if (Object.keys(fields).length > 0) return Promise.resolve(invalid(fields));
    return this.change(s, (state) => ({ ...state, approvedAt: state.approvedAt ?? now().toISOString() }));
  }

  /**
   * Writes new copy for an approved Section and stores it as the proposal, with its overlaps. Refused,
   * with no AI request and no key lookup, when the Section is not approved (REQ-030 AC-1).
   */
  async run(input: RewriteRunInput, deps: RewriteRunDeps): Promise<RewriteResult> {
    const fields = sectionProblems(input);
    if (!isDocumentLanguage(input.language)) fields.language = 'must be one of the document languages.';
    if (Object.keys(fields).length > 0) return invalid(fields);

    if (!(await this.get(input))?.approvedAt) return NOT_APPROVED;
    const original = originalText(deps.content, input);
    if (original === undefined || original.trim() === '') {
      return invalid({ sectionId: 'is not a Section with text on this recorded page.' });
    }

    const resolution = await deps.resolveAi();
    if (!resolution.ok) {
      return { ok: false, code: 'ERR_NO_AI_KEY', message: 'Add an AI key to write new copy for this Section.' };
    }

    const written = await writeRewrite(resolution.ai, {
      sectionText: original,
      language: input.language,
      overlapWords: deps.overlapWords,
      signal: deps.signal,
      timeoutMs: deps.timeoutMs,
    });
    if (!written.ok)
      return { ok: false, code: 'ai-failed', problem: written.problem, message: AI_MESSAGES[written.problem] };

    const createdAt = (deps.now ?? (() => new Date()))().toISOString();
    return this.change(input, (state) =>
      state.approvedAt
        ? {
            ...state,
            proposal: { text: written.text, language: input.language, overlaps: written.overlaps, createdAt },
          }
        : undefined
    );
  }

  /**
   * Accepts (edited) copy for an approved Section: refused while it shares a run of at least the overlap
   * threshold with the original (REQ-030 AC-2). Returns the SectionEdit for the edit overlay.
   */
  async accept(input: RewriteAcceptInput, deps: RewriteAcceptDeps): Promise<RewriteAcceptResult> {
    const fields = sectionProblems(input);
    const text = input.text;
    if (typeof text !== 'string' || text.trim() === '') fields.text = 'must not be empty.';
    else if (text.length > MAX_SECTION_EDIT_CHARS) fields.text = `is longer than ${MAX_SECTION_EDIT_CHARS} characters.`;
    else if (BAD_CONTROL.test(text)) fields.text = 'must not contain invisible control characters.';
    if (Object.keys(fields).length > 0) return invalid(fields);

    if (!(await this.get(input))?.approvedAt) return NOT_APPROVED;
    const original = originalText(deps.content, input);
    if (original === undefined) return invalid({ sectionId: 'is not a Section on this recorded page.' });

    const overlaps = findOverlaps(original, text, overlapThreshold(deps.overlapWords));
    if (overlaps.length > 0) {
      return {
        ok: false,
        code: 'ERR_OVERLAP',
        message: 'This copy still repeats phrases from the original. Reword the marked phrases.',
        overlaps,
      };
    }

    const editedAt = (deps.now ?? (() => new Date()))().toISOString();
    const saved = await this.change(input, (state) =>
      state.approvedAt ? { ...state, acceptedAt: editedAt } : undefined
    );
    if (!saved.ok) return saved;
    const edit: SectionEdit = { urlPath: input.urlPath, sectionId: input.sectionId, text, by: 'rewrite', editedAt };
    return { ok: true, rewrite: saved.rewrite, edit };
  }

  /** Applies one change to a Section's state; saves run one at a time. `undefined` means it is not approved. */
  private change(s: RewriteSection, apply: (state: RewriteState) => RewriteState | undefined): Promise<RewriteResult> {
    const waitFor = SAVE_QUEUES.get(this.queueKey) ?? Promise.resolve();
    const run = waitFor.then(async (): Promise<RewriteResult> => {
      const states = await this.list();
      const at = states.findIndex((r) => keyOf(r) === keyOf(s));
      const current: RewriteState =
        at >= 0
          ? states[at]
          : { urlPath: s.urlPath, sectionId: s.sectionId, approvedAt: null, proposal: null, acceptedAt: null };
      const next = apply(current);
      if (!next) return NOT_APPROVED;
      if (at >= 0) states[at] = next;
      else states.push(next);
      const stored: StoredFile = { schemaVersion: SCHEMA_VERSION, rewrites: states };
      await this.store.writeVersionJson(this.auditId, this.version, REWRITES_NAME, stored);
      return { ok: true, rewrite: next };
    });
    const tail = run.catch(() => {});
    SAVE_QUEUES.set(this.queueKey, tail);
    // Drop the entry once nothing newer is waiting, so the map does not grow with every version ever edited.
    void tail.then(() => {
      if (SAVE_QUEUES.get(this.queueKey) === tail) SAVE_QUEUES.delete(this.queueKey);
    });
    return run;
  }
}
