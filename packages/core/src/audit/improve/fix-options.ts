/**
 * Fix options per finding (T-417, ADR 0049): the rule options of `fix-rules.ts`, plus, with an AI key,
 * site-specific options from one AI request per batch of 5 findings. Every AI option cites its finding id;
 * one that cites another finding, uses claim words or gives a score is dropped (ADR 0018). Each request goes
 * through `AuditAi.ask`, so it counts toward the run's AI request counter (T-398).
 */
import type { AIMessage, AuditFinding, DocumentLanguage } from '@qa/types';
import { CLAIM_WORDS_PROMPT, hasClaimWords } from '../ai/claim-words.js';
import { clip, languageName, type AuditAi } from '../ai/stage-ai.js';
import { MAX_FIX_OPTIONS, ruleFixOptions, topFindingsForOptions, type FixEffort, type FixOption } from './fix-rules.js';

export * from './fix-rules.js';

/** Findings per AI request. */
export const FIX_OPTION_BATCH = 5;

type OptionFinding = Pick<
  AuditFinding,
  'id' | 'rule' | 'area' | 'group' | 'title' | 'detail' | 'suggestion' | 'urlPath'
>;

/** Words or marks that make a statement a score: a number out of something, a percentage or a rating. */
const SCORE = /\b\d+\s*(\/|out of)\s*\d+\b|\d+\s*%|\bscore\b|\brating\b/i;

export function fixOptionMessages(batch: readonly OptionFinding[], language: DocumentLanguage): AIMessage[] {
  const system = [
    'You suggest practical ways to fix website findings for a small business.',
    'For each finding, give 1 or 2 options specific to this site, different from its suggested fix.',
    'Each option: a short title, an effort of S, M or L, and a one-line trade-off.',
    'Each option must cite the id of the finding it answers in "findingId".',
    `Never use these words: ${CLAIM_WORDS_PROMPT}. No scores, no percentages, nothing about the whole site.`,
    `Write in ${languageName(language)}.`,
    'Answer with JSON only: {"options":[{"findingId":"AF-001","title":"...","effort":"S","tradeOff":"..."}]}',
  ].join('\n');
  const user = JSON.stringify(
    batch.map((f) => ({
      id: f.id,
      page: f.urlPath,
      title: clip(f.title, 160),
      found: clip(f.detail, 300),
      suggestedFix: clip(f.suggestion, 200),
    }))
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const isEffort = (v: unknown): v is FixEffort => v === 'S' || v === 'M' || v === 'L';

/** The usable options of one answer: cite a finding of the batch, no claim words, no score. */
export function parseFixOptions(text: string, batchIds: ReadonlySet<string>): Array<Omit<FixOption, 'id'>> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { options?: unknown })?.options;
  if (!Array.isArray(list)) return [];
  const out: Array<Omit<FixOption, 'id'>> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { findingId, title, effort, tradeOff } = item as Record<string, unknown>;
    if (typeof findingId !== 'string' || !batchIds.has(findingId)) continue;
    if (typeof title !== 'string' || typeof tradeOff !== 'string' || !isEffort(effort)) continue;
    const words = `${title} ${tradeOff}`;
    if (!title.trim() || hasClaimWords(words) || SCORE.test(words)) continue;
    out.push({ findingId, title: clip(title.trim(), 120), effort, tradeOff: clip(tradeOff.trim(), 200), source: 'ai' });
  }
  return out;
}

export interface FixOptionsInput {
  findings: readonly OptionFinding[];
  language: DocumentLanguage;
  /** With an AI: one request per 5 top findings adds site-specific options. Without: rule options only. */
  ai?: AuditAi;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Options for each of the top 10 findings: 2 or 3 by rule, then AI options while there is room (at most 3 in
 * all, rule options first). An AI request that fails or is past the budget leaves that batch with rule options.
 */
export async function fixOptionsFor(input: FixOptionsInput): Promise<Map<string, FixOption[]>> {
  const options = ruleFixOptions(input.findings);
  if (!input.ai) return options;
  const top = topFindingsForOptions(input.findings);
  for (let i = 0; i < top.length; i += FIX_OPTION_BATCH) {
    const batch = top.slice(i, i + FIX_OPTION_BATCH);
    let text: string;
    try {
      const answer = await input.ai.ask('documents', fixOptionMessages(batch, input.language), {
        responseFormat: 'json',
        temperature: 0.3,
        maxTokens: 1500,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      });
      if (!answer.ok) break;
      text = answer.completion.text;
    } catch {
      continue;
    }
    for (const option of parseFixOptions(text, new Set(batch.map((f) => f.id)))) {
      const list = options.get(option.findingId) ?? [];
      if (list.length >= MAX_FIX_OPTIONS) {
        // Rule options take two places; the third goes to the first site-specific option.
        if (list.length > 2 && list[2].source === 'rule') list.pop();
        else continue;
      }
      list.push({ ...option, id: `${option.findingId}-${String.fromCharCode(65 + list.length)}` });
      options.set(option.findingId, list);
    }
  }
  return options;
}
