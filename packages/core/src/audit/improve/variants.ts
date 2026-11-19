/**
 * Design variants of the Improved version (ADR 0049): the homepage plus one Sample Page per Layout Group,
 * 1 to 5 variants each, every variant one 'preview' stage AI request on the tool user's key. Each variant has
 * its own design direction (VARIANT_STYLES) and keeps the site's menu links, logo and colours. Pages are
 * stored as `improved/<page>/<variant>.html` in the version folder, indexed by `improved/variants.json`.
 * Nothing here opens a browser, changes the site or requests anything from it except the images it shows.
 */
import {
  MAX_VARIANTS_PER_PAGE,
  VARIANT_STYLES,
  type AuditResult,
  type DocumentLanguage,
  type EditOverlay,
  type ImproveIndex,
  type ImprovePage,
  type ImproveVariant,
  type PageContent,
  type VariantStyle,
} from '@qa/types';
import type { AIProviderType } from '@qa/types';
import { knownPrice, type ModelPrice } from '../../ai/model-prices.js';
import type { AuditAi } from '../ai/stage-ai.js';
import { stopIfAborted } from '../../abort.js';
import { generateVariantPage, type PreviewImageFetch } from '../preview/generate.js';
import { previewFacts, MAX_PREVIEW_IMAGES, type VariantDirection } from '../preview/prompt.js';
import { siteBrand, type SiteBrand } from './brand.js';
import { chromium, type Browser } from 'playwright';
import { gateVariant, labAxeScan, type VariantAxeScan } from './quality-gate.js';
import { previewNodesText } from '../preview/sanitize.js';
import { copiesCompetitor } from '../competitors/examples.js';

/** The index of every variant made for one version (a version JSON object: `improved/variants.json`). */
export const IMPROVE_INDEX_NAME = 'improved/variants';

/** Where one variant is stored in the version folder. Page keys come from `improvePages`, never from a request. */
export function variantFileName(page: string, variant: number): string {
  return `improved/${page}/${variant}.html`;
}

/** What each design direction asks of the page, in one sentence. */
export const VARIANT_BRIEFS: Readonly<Record<VariantStyle, string>> = {
  clean: 'plenty of white space, a simple layout and few elements, so the main message stands out.',
  bold: 'large headings, strong contrast and big blocks of the brand colours.',
  'trust-first': 'put the facts that build trust first: who runs the site, contact details and what others say.',
  'content-first': 'lead with the most useful text, in short sections with clear headings.',
  'conversion-first': 'make the main call to action the first thing seen, and repeat it after each section.',
};

/** Tokens one request is assumed to use, for the cost estimate: the prompt with its data, and the page. */
export const IMPROVE_PROMPT_TOKENS = 8_000;
export const IMPROVE_COMPLETION_TOKENS = 6_000;

/** Requests sent at once. */
const CONCURRENCY = 3;

/** The price of one request in US dollars, or null when the model's price is not known. */
export function improveRequestPrice(price: ModelPrice | undefined): number | null {
  if (!price) return null;
  return (IMPROVE_PROMPT_TOKENS * price.prompt + IMPROVE_COMPLETION_TOKENS * price.completion) / 1_000_000;
}

/** The price of one request on a provider's model, from the list prices (`model-prices.ts`). */
export function improvePriceFor(provider: AIProviderType, model: string | null | undefined): number | null {
  return improveRequestPrice(knownPrice(provider, model ?? undefined));
}

/** The AI requests a batch makes (pages × variants), and their cost when the price is known. */
export function improveEstimate(
  pages: number,
  variants: number,
  usdPerRequest: number | null
): { requests: number; usd: number | null } {
  const requests = Math.max(0, pages) * Math.max(0, variants);
  return { requests, usd: usdPerRequest === null ? null : requests * usdPerRequest };
}

function keyFor(urlPath: string, used: Set<string>): string {
  const slug = urlPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const base = `p-${slug || 'page'}`;
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  used.add(key);
  return key;
}

/**
 * The pages of the Improved version: the homepage, then one page per Layout Group other than the homepage's,
 * its Sample Page when it has one, in the order the groups first appear. Keys are stable for one result.
 */
export function improvePages(result: AuditResult): ImprovePage[] {
  const rootPath = result.hierarchy.root.urlPath;
  const root = result.pages.find((p) => p.urlPath === rootPath);
  const used = new Set<string>(['home']);
  const out: ImprovePage[] = [
    {
      key: 'home',
      urlPath: rootPath,
      title: root?.title ?? null,
      layoutGroup: null,
      screenshotPath: root?.phone?.screenshotPath ?? null,
    },
  ];
  const groups = new Map<string, AuditResult['pages']>();
  for (const page of result.pages) {
    if (!page.layoutGroup) continue;
    groups.set(page.layoutGroup, [...(groups.get(page.layoutGroup) ?? []), page]);
  }
  for (const [group, pages] of groups) {
    if (root?.layoutGroup === group) continue;
    const sampled = pages.find((p) => p.coverage === 'sample') ?? pages[0];
    const sample = (sampled.sampleUrlPath && pages.find((p) => p.urlPath === sampled.sampleUrlPath)) || sampled;
    if (sample.urlPath === rootPath) continue;
    out.push({
      key: keyFor(sample.urlPath, used),
      urlPath: sample.urlPath,
      title: sample.title,
      layoutGroup: group,
      screenshotPath: sample.phone?.screenshotPath ?? null,
    });
  }
  return out;
}

/** A checked create body: the pages and how many variants, or a plain sentence saying what is wrong. */
export function checkImproveBody(
  raw: unknown,
  pages: readonly ImprovePage[]
): { pages: ImprovePage[]; variants: number; only?: number; version?: number } | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'The request must be a JSON object.';
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!['version', 'pages', 'variants', 'only'].includes(key)) return `Unknown field: ${key.slice(0, 40)}.`;
  }
  const whole = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  if (body.version !== undefined && !whole(body.version, 1, 9_999_999))
    return 'The version must be a whole number from 1.';
  if (!whole(body.variants, 1, MAX_VARIANTS_PER_PAGE))
    return `Pick from 1 to ${MAX_VARIANTS_PER_PAGE} variants per page.`;
  if (!Array.isArray(body.pages) || body.pages.length === 0 || body.pages.length > pages.length)
    return 'Pick at least one page.';
  const chosen: ImprovePage[] = [];
  for (const key of body.pages) {
    const page = pages.find((p) => p.key === key);
    if (!page) return 'A page is not one of the pages of this version.';
    if (!chosen.includes(page)) chosen.push(page);
  }
  if (body.only !== undefined) {
    if (!whole(body.only, 1, MAX_VARIANTS_PER_PAGE)) return 'The variant must be a whole number from 1 to 5.';
    if (chosen.length !== 1) return 'Try again works on one page at a time.';
  }
  return {
    pages: chosen,
    variants: body.variants as number,
    ...(body.only !== undefined ? { only: body.only as number } : {}),
    ...(body.version !== undefined ? { version: body.version as number } : {}),
  };
}

/** The version files the Improved version reads and writes; the runner passes its AuditStore's. */
export interface ImproveIo {
  readContent(urlPath: string): Promise<PageContent | null>;
  readFile(name: string): Promise<Uint8Array | null>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  /** A version JSON object by name (the store adds `.json`). */
  readJson(name: string): Promise<unknown>;
  writeJson(name: string, value: unknown): Promise<void>;
}

/** The stored index, or an empty one. */
export async function readImproveIndex(
  io: Pick<ImproveIo, 'readJson'>,
  version: number,
  language: DocumentLanguage
): Promise<ImproveIndex> {
  const parsed = (await io.readJson(IMPROVE_INDEX_NAME).catch(() => null)) as ImproveIndex | null;
  // A broken index is started again; the stored pages are overwritten as they are made.
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.variants)) return parsed;
  return { version, language, variants: [] };
}

/** The index with the variant starred as the best (T-415), saved. */
export async function writeImproveIndex(io: Pick<ImproveIo, 'writeJson'>, index: ImproveIndex): Promise<void> {
  await io.writeJson(IMPROVE_INDEX_NAME, index);
}

export interface MakeVariantsInput {
  result: AuditResult;
  edits: EditOverlay;
  /** The language chosen at the audit's start. */
  language: DocumentLanguage;
  pages: ImprovePage[];
  /** 1 to 5 per page. */
  variants: number;
  /** Only this variant number ("Try again"): one request. */
  only?: number;
  /**
   * T-418, optional: what similar sites show ("borrow what works"). `ideas` go into the prompt, each cited by
   * site and page; `texts` are their words, which a variant must never copy (the rewrite overlap check).
   */
  competitor?: { ideas: string[]; texts: string[] };
}

export interface MakeVariantsOptions {
  io: ImproveIo;
  ai?: AuditAi;
  fetchImage?: PreviewImageFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => Date;
  /** The quality gate's axe scan (T-414). Default: one lab browser for the whole batch. */
  scanAxe?: VariantAxeScan;
}

interface Job {
  page: ImprovePage;
  variant: number;
  style: VariantStyle;
}

/** The jobs of a request: every page × variant 1..n, or the one variant asked for. */
export function variantJobs(pages: readonly ImprovePage[], variants: number, only?: number): Job[] {
  const numbers = only !== undefined ? [only] : Array.from({ length: variants }, (_, i) => i + 1);
  return pages.flatMap((page) =>
    numbers.map((variant) => ({ page, variant, style: VARIANT_STYLES[(variant - 1) % VARIANT_STYLES.length] }))
  );
}

/** The homepage's brand, read once per batch from stored files. */
async function readBrand(result: AuditResult, io: ImproveIo): Promise<SiteBrand> {
  const rootPath = result.hierarchy.root.urlPath;
  const home = await io.readContent(rootPath).catch(() => null);
  const shotPath = result.pages.find((p) => p.urlPath === rootPath)?.phone?.screenshotPath ?? null;
  const screenshot = shotPath ? await io.readFile(shotPath).catch(() => null) : null;
  return siteBrand({ home, siteUrl: result.url, screenshot });
}

/**
 * Makes the variants asked for, one AI request each, stores the pages and updates the index. Once the AI
 * Request Budget is spent, the remaining variants are recorded as failed without a request.
 */
export async function makeVariants(
  input: MakeVariantsInput,
  options: MakeVariantsOptions
): Promise<{ requests: number; variants: ImproveVariant[]; index: ImproveIndex }> {
  const { io } = options;
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const jobs = variantJobs(input.pages, input.variants, input.only);
  // TODO(T-398): check the shared AI request counter here for `jobs.length` requests before the batch starts,
  // and refuse the batch when it would pass the AI Request Budget. Until then, a budget passed to resolveAuditAi
  // stops the batch at the first 'budget-spent' answer.
  const brand = await readBrand(input.result, io);
  const contents = new Map<string, PageContent | null>();
  for (const page of input.pages) contents.set(page.urlPath, await io.readContent(page.urlPath).catch(() => null));

  let requests = 0;
  let spent = false;
  const made: ImproveVariant[] = [];

  const run = async (job: Job): Promise<void> => {
    stopIfAborted(options.signal);
    const base = { page: job.page.key, variant: job.variant, style: job.style };
    if (spent || !options.ai) {
      made.push({ ...base, status: 'failed', problem: spent ? 'budget-spent' : 'failed', createdAt: now() });
      return;
    }
    const facts = previewFacts({
      result: input.result,
      home: contents.get(job.page.urlPath) ?? null,
      urlPath: job.page.urlPath,
      edits: input.edits,
      language: input.language,
    });
    // The logo must be in the listed images, or it is never inlined.
    if (brand.logo && !facts.images.some((i) => i.src === brand.logo!.src)) {
      facts.images = [brand.logo, ...facts.images].slice(0, MAX_PREVIEW_IMAGES);
    }
    const ideas = input.competitor?.ideas ?? [];
    const direction: VariantDirection = {
      style: job.style,
      brief:
        ideas.length > 0
          ? `${VARIANT_BRIEFS[job.style]} Ideas seen on similar sites that you may borrow; cite each one you use by its site and page, and never copy their words: ${ideas.join('; ')}.`
          : VARIANT_BRIEFS[job.style],
      logo: brand.logo,
      colours: brand.colours,
    };
    const page = await generateVariantPage(facts, direction, {
      ai: options.ai,
      fetchImage: options.fetchImage,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    if (!page.ok && page.problem === 'budget-spent') {
      spent = true;
      made.push({ ...base, status: 'failed', problem: 'budget-spent', createdAt: now() });
      return;
    }
    requests++;
    if (!page.ok) {
      made.push({ ...base, status: 'failed', problem: 'failed', createdAt: now() });
      return;
    }
    // T-418: a variant that copies a similar site's words is never stored or shown.
    if (input.competitor && copiesCompetitor(previewNodesText(page.nodes), input.competitor.texts).length > 0) {
      made.push({ ...base, status: 'failed', problem: 'failed', createdAt: now() });
      return;
    }
    // The quality gate (T-414): a variant that fails is stored but never shown or served.
    const gate = await gateVariant(
      {
        answer: page.answer,
        nodes: page.nodes,
        html: page.html,
        facts,
        result: input.result,
        urlPath: job.page.urlPath,
      },
      scanAxe
    );
    await io.writeFile(variantFileName(job.page.key, job.variant), new TextEncoder().encode(page.html));
    made.push({ ...base, status: 'made', createdAt: now(), cites: page.cites, gate });
  };

  // One lab browser for the whole batch, launched on the first scan, unless a scan is given.
  const lab: { browser?: Promise<Browser> } = {};
  const scanAxe: VariantAxeScan =
    options.scanAxe ??
    (async (html) => {
      lab.browser ??= chromium.launch({ headless: true, args: ['--disable-extensions'] });
      return labAxeScan({ browser: await lab.browser })(html);
    });

  const queue = [...jobs];
  try {
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let job = queue.shift(); job; job = queue.shift()) await run(job);
      })
    );
  } finally {
    const open = lab.browser ? await lab.browser.catch(() => null) : null;
    await open?.close().catch(() => undefined);
  }

  const order = (v: ImproveVariant) => `${v.page}\u0000${String(v.variant).padStart(2, '0')}`;
  made.sort((a, b) => order(a).localeCompare(order(b)));
  const index = await readImproveIndex(io, input.result.version, input.language);
  const replaced = new Set(made.map(order));
  const next: ImproveIndex = {
    ...index,
    version: input.result.version,
    language: input.language,
    variants: [...index.variants.filter((v) => !replaced.has(order(v))), ...made].sort((a, b) =>
      order(a).localeCompare(order(b))
    ),
  };
  await writeImproveIndex(io, next);
  return { requests, variants: made, index: next };
}
