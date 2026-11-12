/**
 * The improved-homepage preview (REQ-024, Q-16): one 'preview' stage AI request with the tool user's key,
 * its answer sanitised into one self-contained HTML page (ADR 0021). Every menu link of the homepage is in
 * the page; homepage images are requested only through the injected makeOutboundFetch function (BE-101)
 * and inlined as data: images, or left as their alt text. Nothing here opens a browser or changes the site.
 */
import type { AIMessage } from '@qa/types';
import type { AuditAi } from '../ai/stage-ai.js';
import { findClaimWords, stripClaimWords } from '../ai/claim-words.js';
import { labelsFor } from '../documents/labels/index.js';
import { sameSiteUrl } from '../../safe-net.js';
import { previewFacts, previewMessages, previewRetryPrompt, type PreviewFacts, type PreviewInput } from './prompt.js';
import { buildTemplateHtml, pathOf } from './template.js';
import {
  previewNodesText,
  renderPreviewDocument,
  sanitizePreviewHtml,
  type PreviewNode,
  type SanitizedPreview,
} from './sanitize.js';

/** The version file the page is stored as (`audits/<id>/v<n>/preview.html`). */
export const PREVIEW_FILE_NAME = 'preview.html';
/** Deadline of the AI request. */
export const PREVIEW_AI_TIMEOUT_MS = 120_000;
/** Largest image inlined, in bytes; a bigger one stays as its alt text. */
export const PREVIEW_IMAGE_MAX_BYTES = 400_000;
/** Deadline of one image request. */
export const PREVIEW_IMAGE_TIMEOUT_MS = 8_000;
const MAX_TOTAL_IMAGE_BYTES = 2_500_000;
const MAX_ANSWER_ECHO_CHARS = 60_000;

/** An image response. `bytes` is the body as sent; a response without it cannot be inlined. */
export interface PreviewImageResponse {
  status: number;
  headers: Record<string, string>;
  bytes?: () => Promise<Uint8Array>;
}

/** Outbound image requests: the runner passes makeOutboundFetch's function (byte cap, timeout, SSRF guard). */
export type PreviewImageFetch = (url: string) => Promise<PreviewImageResponse | null>;

export interface GeneratePreviewOptions {
  ai?: AuditAi;
  /** Absent: no image is requested and each image shows its alt text. */
  fetchImage?: PreviewImageFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type PreviewProblem = 'budget-spent' | 'failed' | 'claim-words';

export type GeneratedPreview = {
  ok: true;
  html: string;
  /** 'ai' when the AI's page was used; 'template' when the page was built from the findings and Page Content. */
  source: 'ai' | 'template';
  /** Set when the AI was asked but its answer was not used: why the template was used instead. */
  problem?: PreviewProblem;
};

/**
 * Writes the improved homepage (REQ-024, ADR 0042, T-81).
 * When AI succeeds, the AI-improved preview is rendered.
 * When AI fails, has claim words, or no AI key is configured, falls back to the template.
 * Returns `source: 'template'` and, when the AI was asked, the `problem`.
 */
export async function generatePreview(input: PreviewInput, options: GeneratePreviewOptions): Promise<GeneratedPreview> {
  const facts = previewFacts(input);

  let chosen: ReturnType<typeof buildNodes> | null = null;
  let problem: PreviewProblem | undefined;

  if (options.ai) {
    const base = previewMessages(facts);
    try {
      const first = await askOnce(options, base);
      if ('text' in first && first.text.trim()) {
        const candidate = buildNodes(first.text, facts);
        const claims = findClaimWords(previewNodesText(candidate.nodes));

        if (claims.length > 0) {
          const retry = await askOnce(options, [
            ...base,
            { role: 'assistant', content: first.text.slice(0, MAX_ANSWER_ECHO_CHARS) },
            { role: 'user', content: previewRetryPrompt(claims) },
          ]);
          if ('text' in retry && retry.text.trim()) {
            const retriedCandidate = buildNodes(retry.text, facts);
            const retryClaims = findClaimWords(previewNodesText(retriedCandidate.nodes));
            if (retryClaims.length === 0) {
              chosen = retriedCandidate;
            } else {
              problem = 'claim-words';
            }
          } else {
            problem = 'problem' in retry ? retry.problem : 'failed';
          }
        } else {
          chosen = candidate;
        }
      } else {
        problem = 'problem' in first ? first.problem : 'failed';
      }
    } catch (err) {
      if (options.signal?.aborted) throw err;
      problem = 'failed';
    }
  }

  // Fall back to template when AI fails or key is missing
  let page = chosen;
  if (!page) {
    page = buildNodes(buildTemplateHtml(facts), facts);
    if (findClaimWords(previewNodesText(page.nodes)).length > 0) {
      page = { ...page, nodes: scrubClaimWords(page.nodes) };
    }
  }

  const nodes = await inlineImages(page.nodes, facts, options);
  return {
    ok: true,
    html: renderPreviewDocument({ nodes, css: page.css, language: facts.language, host: facts.host }),
    source: chosen ? 'ai' : 'template',
    ...(chosen || !problem ? {} : { problem }),
  };
}

async function askOnce(
  options: GeneratePreviewOptions,
  messages: AIMessage[]
): Promise<{ text: string } | { problem: 'budget-spent' | 'failed' }> {
  if (!options.ai) return { problem: 'failed' };
  try {
    const answer = await options.ai.ask('preview', messages, {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? PREVIEW_AI_TIMEOUT_MS,
      responseFormat: 'text',
      temperature: 0.6,
      maxTokens: 8000,
    });
    if (!answer.ok) return { problem: 'budget-spent' };
    const text = stripFences(answer.completion.text);
    return text === '' ? { problem: 'failed' } : { text };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    return { problem: 'failed' }; // no provider text is kept
  }
}

function stripFences(text: string): string {
  const trimmed = String(text ?? '').trim();
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

function scrubClaimWords(nodes: readonly PreviewNode[]): PreviewNode[] {
  return nodes.map((node) => {
    if (node.kind === 'text') {
      return findClaimWords(node.text).length > 0 ? { kind: 'text', text: stripClaimWords(node.text) } : node;
    }
    if (node.kind === 'open') {
      let changed = false;
      const attrs: Array<[string, string]> = node.attrs.map(([name, val]) => {
        if (name === 'alt' || name === 'title' || name.startsWith('aria-')) {
          if (findClaimWords(val).length > 0) {
            changed = true;
            return [name, stripClaimWords(val)];
          }
        }
        return [name, val];
      });
      return changed ? { kind: 'open', name: node.name, attrs } : node;
    }
    return node;
  });
}

/** The sanitised body, with every homepage menu link the AI left out added in a menu of its own. */
function buildNodes(answer: string, facts: PreviewFacts): SanitizedPreview {
  const page = sanitizePreviewHtml(answer, facts.siteUrl);
  const present = new Set<string>();
  for (const node of page.nodes) {
    if (node.kind !== 'open' || node.name !== 'a') continue;
    const href = node.attrs.find(([name]) => name === 'href')?.[1];
    if (href) present.add(withoutHash(href));
  }
  const missing = facts.menu.filter((link) => !present.has(withoutHash(link.href)));
  if (missing.length === 0) return page;

  const { labels } = labelsFor(facts.language);
  const menu: PreviewNode[] = [
    {
      kind: 'open',
      name: 'nav',
      attrs: [
        ['class', 'qa-preview-menu'],
        ['aria-label', labels.headings.navigationLinks],
      ],
    },
  ];
  for (const link of missing) {
    menu.push(
      { kind: 'open', name: 'a', attrs: [['href', link.href]] },
      { kind: 'text', text: stripClaimWords(link.text) || pathOf(link.href) },
      { kind: 'close', name: 'a' }
    );
  }
  menu.push({ kind: 'close', name: 'nav' });
  return { nodes: [...menu, ...page.nodes], css: page.css };
}

function withoutHash(href: string): string {
  try {
    const url = new URL(href);
    url.hash = '';
    return url.href;
  } catch {
    return href;
  }
}

/** The image type from the first bytes; null for anything that is not PNG, JPEG, GIF or WebP. */
export function sniffImageType(bytes: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Each image the homepage itself shows (same site, listed in its Page Content) is requested once and
 * inlined as a data: image. A refused, failed, oversized or non-image answer leaves the image's src empty,
 * so the page shows its alt text. Images the homepage does not list are never requested.
 */
async function inlineImages(
  nodes: readonly PreviewNode[],
  facts: PreviewFacts,
  options: GeneratePreviewOptions
): Promise<PreviewNode[]> {
  const listed = new Set(facts.images.map((i) => i.src));
  const cache = new Map<string, string>();
  let total = 0;

  const dataUrl = async (src: string): Promise<string> => {
    if (!options.fetchImage || !listed.has(src) || !sameSiteUrl(src, facts.siteUrl)) return '';
    const known = cache.get(src);
    if (known !== undefined) return known;
    let out = '';
    try {
      const response = await options.fetchImage(src);
      if (response && response.status === 200 && response.bytes) {
        const bytes = await response.bytes();
        const type = sniffImageType(bytes);
        if (type && bytes.length <= PREVIEW_IMAGE_MAX_BYTES && total + bytes.length <= MAX_TOTAL_IMAGE_BYTES) {
          total += bytes.length;
          out = `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
        }
      }
    } catch {
      out = '';
    }
    cache.set(src, out);
    return out;
  };

  const out: PreviewNode[] = [];
  for (const node of nodes) {
    if (node.kind !== 'open' || node.name !== 'img') {
      out.push(node);
      continue;
    }
    const src = node.attrs.find(([name]) => name === 'src')?.[1] ?? '';
    const inlined = src === '' ? '' : await dataUrl(src);
    const attrs = node.attrs.filter(([name]) => name !== 'src');
    out.push({ kind: 'open', name: 'img', attrs: inlined ? [['src', inlined], ...attrs] : attrs });
  }
  return out;
}
