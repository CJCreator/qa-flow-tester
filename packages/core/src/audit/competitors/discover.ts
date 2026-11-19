/**
 * Competitors, discovery (T-416, ADR 0049). One AI request with the tool user's key names 3 similar public
 * websites, from a short summary of the audit's Page Content. No search API is used.
 *
 * Every named address passes the same public-address check as an audit start (`checkAuditAddress`, safe-net):
 * a private or local address is refused and never read, on every runner. The tool user can drop any of the
 * three before the light crawl. The request goes through `AuditAi.ask`, so it counts toward the run's AI
 * request counter (T-398). Reasons have claim words removed (ADR 0018).
 */
import {
  COMPETITOR_COUNT,
  type AIMessage,
  type AuditResult,
  type CompetitorCandidate,
  type DocumentLanguage,
  type PageContent,
} from '@qa/types';
import { checkAuditAddress, type AuditAddressResult } from '../crawl/reachability.js';
import { stripClaimWords } from '../documents/wording.js';
import { clip, languageName, type AuditAi } from '../ai/stage-ai.js';
import { CLAIM_WORDS_PROMPT } from '../ai/claim-words.js';

/** An address the AI names without a scheme is read as https. A scheme, not a host: it names no external service. */
const DEFAULT_SCHEME = 'https:';

/** What the AI is told about the audited site. Facts from Page Content only. */
export interface CompetitorSummary {
  url: string;
  title: string | null;
  description: string | null;
  language: DocumentLanguage;
  /** Menu labels and top headings: what the site offers. */
  services: string[];
  /** A short excerpt of the homepage text (business type and location usually show here). */
  excerpt: string;
}

export function competitorSummary(
  result: Pick<AuditResult, 'url' | 'language'>,
  home: PageContent | null
): CompetitorSummary {
  const menu = (home?.links ?? []).filter((l) => l.region === 'menu' && !l.leavesSite).map((l) => l.text.trim());
  const headings = (home?.headings ?? []).filter((h) => h.level <= 2).map((h) => h.text.trim());
  const seen = new Set<string>();
  const services = [...menu, ...headings]
    .filter((t) => t && t.length <= 60 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 16);
  return {
    url: result.url,
    title: home?.title ?? null,
    description: home?.description ?? null,
    language: result.language,
    services,
    excerpt: clip((home?.text ?? '').replace(/\s+/g, ' ').trim(), 600),
  };
}

export function discoverMessages(summary: CompetitorSummary): AIMessage[] {
  const system = [
    'You name similar public business websites for a website review.',
    `Name exactly ${COMPETITOR_COUNT} websites of businesses that offer similar services, in the same country or region when the facts show one.`,
    'Each must be a public business homepage. Never the reviewed site itself, a marketplace, a directory, a social network or a search engine.',
    'Give a one-line reason per site that names which fact (business type, location, language or service) it shares.',
    `Never use these words: ${CLAIM_WORDS_PROMPT}. No scores, no ratings, no rankings.`,
    `Write the reasons in ${languageName(summary.language)}.`,
    'Answer with JSON only: {"competitors":[{"url":"the homepage address","reason":"..."}]}',
  ].join('\n');
  const user = JSON.stringify({
    site: summary.url,
    title: summary.title,
    description: summary.description,
    language: summary.language,
    services: summary.services,
    homepageText: summary.excerpt,
  });
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** The host without a leading www., lower case. */
function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** The answer's sites: http(s) only, reduced to their origin, minus the audited site and repeats, at most 3. */
export function parseCompetitorAnswer(
  text: string,
  auditedUrl: string
): Array<{ url: string; host: string; reason: string }> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { competitors?: unknown })?.competitors;
  if (!Array.isArray(list)) return [];
  let audited = '';
  try {
    audited = bareHost(new URL(auditedUrl).hostname);
  } catch {
    audited = '';
  }
  const seen = new Set<string>();
  const out: Array<{ url: string; host: string; reason: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const raw = (item as { url?: unknown }).url;
    const reason = (item as { reason?: unknown }).reason;
    if (typeof raw !== 'string') continue;
    let url: URL;
    try {
      const address = raw.trim();
      url = new URL(/^[a-z]+:\/\//i.test(address) ? address : `${DEFAULT_SCHEME}//${address}`);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.username || url.password) continue;
    const key = bareHost(url.hostname);
    if (!key || key === audited || seen.has(key)) continue;
    seen.add(key);
    out.push({
      url: url.origin,
      host: url.host.toLowerCase(),
      reason: clip(stripClaimWords(typeof reason === 'string' ? reason : ''), 200),
    });
    if (out.length >= COMPETITOR_COUNT) break;
  }
  return out;
}

export type DiscoverOutcome =
  { ok: true; candidates: CompetitorCandidate[] } | { ok: false; reason: 'budget-spent' | 'no-answer' };

export interface DiscoverOptions {
  /** The public-address check; default `checkAuditAddress` with private addresses refused. */
  checkAddress?: (url: string) => Promise<AuditAddressResult>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const REFUSED_PRIVATE = 'This address points to a private or local network, so it is not read.';
const REFUSED_UNREACHABLE = 'The site could not be reached, so it is not read.';

/** One AI request, then the public-address check of each named site. */
export async function discoverCompetitors(
  ai: AuditAi,
  summary: CompetitorSummary,
  options: DiscoverOptions = {}
): Promise<DiscoverOutcome> {
  const answer = await ai.ask('preview', discoverMessages(summary), {
    responseFormat: 'json',
    temperature: 0.3,
    maxTokens: 800,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  if (!answer.ok) return { ok: false, reason: 'budget-spent' };
  const named = parseCompetitorAnswer(answer.completion.text, summary.url);
  if (named.length === 0) return { ok: false, reason: 'no-answer' };

  // Never private, whatever the runner allows: the tool user did not name these sites.
  const check = options.checkAddress ?? ((url: string) => checkAuditAddress(url, { allowPrivateAddresses: false }));
  const candidates: CompetitorCandidate[] = [];
  for (const site of named) {
    let checked: AuditAddressResult;
    try {
      checked = await check(site.url);
    } catch {
      checked = { ok: false, code: 'ERR_UNREACHABLE', reason: REFUSED_UNREACHABLE };
    }
    candidates.push(
      checked.ok
        ? { ...site, status: 'ok' }
        : {
            ...site,
            status: 'refused',
            refusal: checked.code === 'ERR_PRIVATE_ADDRESS' ? REFUSED_PRIVATE : REFUSED_UNREACHABLE,
          }
    );
  }
  return { ok: true, candidates };
}
