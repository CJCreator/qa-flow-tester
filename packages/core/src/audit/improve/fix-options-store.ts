/**
 * The runtime caller of the fix options (T-417 follow-up, ADR 0049): the options of one version's top findings,
 * with AI options (stage `documents`) when a key works, rule options otherwise. The AI answer is stored per
 * version, so the screen, the Findings document and the Improvement Roadmap show the same options and a
 * later request makes no AI call. A stored answer is used by anyone who may view the version; only a caller
 * with a working AI (the owner) makes a new one.
 */
import { createHash } from 'crypto';
import type { AuditFinding, DocumentLanguage } from '@qa/types';
import type { AuditAi } from '../ai/stage-ai.js';
import { fixOptionsFor } from './fix-options.js';
import { ruleFixOptions, topFindingsForOptions, type FixOption } from '@qa/types';

/** The stored name (a version JSON file) of the AI options. */
export const FIX_OPTIONS_NAME = 'fix-options';

type OptionFinding = Pick<
  AuditFinding,
  'id' | 'rule' | 'area' | 'group' | 'title' | 'detail' | 'suggestion' | 'urlPath'
>;

interface StoredFixOptions {
  /** Language and the top findings they were written from: a different set starts again. */
  key: string;
  options: Record<string, FixOption[]>;
}

export interface FixOptionsIo {
  readJson(name: string): Promise<unknown>;
  writeJson(name: string, value: unknown): Promise<void>;
}

export function fixOptionsKey(findings: readonly OptionFinding[], language: DocumentLanguage): string {
  const top = topFindingsForOptions(findings).map((f) => [f.id, f.rule, f.title, f.detail, f.suggestion]);
  return createHash('sha256')
    .update(JSON.stringify([language, top]))
    .digest('hex')
    .slice(0, 24);
}

export interface LoadFixOptionsInput {
  findings: readonly OptionFinding[];
  language: DocumentLanguage;
  io: FixOptionsIo;
  /** The caller's working AI, or none: then only a stored answer or rule options are returned. */
  ai?: AuditAi;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LoadedFixOptions {
  options: Map<string, FixOption[]>;
  /** True when some option was written by the AI. */
  ai: boolean;
}

const hasAi = (options: ReadonlyMap<string, readonly FixOption[]>) =>
  [...options.values()].some((list) => list.some((o) => o.source === 'ai'));

/** The fix options of a version: stored AI options, else new ones with `ai`, else rule options. */
export async function loadFixOptions(input: LoadFixOptionsInput): Promise<LoadedFixOptions> {
  const key = fixOptionsKey(input.findings, input.language);
  const stored = (await input.io.readJson(FIX_OPTIONS_NAME).catch(() => null)) as StoredFixOptions | null;
  if (stored && typeof stored === 'object' && stored.key === key && stored.options) {
    const options = new Map(Object.entries(stored.options));
    return { options, ai: hasAi(options) };
  }
  if (!input.ai) return { options: ruleFixOptions(input.findings), ai: false };
  const options = await fixOptionsFor({
    findings: input.findings,
    language: input.language,
    ai: input.ai,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
  const ai = hasAi(options);
  // Only an answer that holds AI options is kept: a failed or refused request is tried again next time.
  if (ai) {
    const value: StoredFixOptions = { key, options: Object.fromEntries(options) };
    await input.io.writeJson(FIX_OPTIONS_NAME, value).catch(() => undefined);
  }
  return { options, ai };
}
