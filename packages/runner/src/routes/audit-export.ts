/**
 * Download routes of a Website Audit version (REQ-018, REQ-019, REQ-021, REQ-022, REQ-025):
 * `GET /api/audits/:id/export` (Audit Documents as md, html, pdf, docx or the bundle),
 * `GET /api/audits/:id/pitch` (Pitch Glimpse as html or pdf) and `GET /api/audits/:id/owner` (Owner Audit).
 *
 * Each reply is the file itself: Content-Type from `EXPORT_CONTENT_TYPES`, `Content-Disposition: attachment`
 * with a sanitized file name, `Cache-Control: no-store`. The edit overlay is applied by the documents module.
 * Nothing here sends anything anywhere: no mail, message, form or other outbound call. BE-190 registers the rows.
 */
import type http from 'http';
import {
  AUDIT_API,
  AUDIT_DOCUMENT_KINDS,
  EXPORT_CONTENT_TYPES,
  EXPORT_FORMATS,
  isAuditDocumentKind,
  isDocumentLanguage,
  isExportFormat,
  type AuditDocumentKind,
  type AuditResult,
  type DocumentLanguage,
  type EditOverlay,
  type ExportFormat,
  type PageContent,
  type ExportTranslationReply,
  type ImproveBestReply,
  type ImproveVariant,
  type StoredDocumentKind,
} from '@qa/types';
import {
  exportAudit,
  exportBaseName,
  exportOwnerAudit,
  exportPitchGlimpse,
  beforeAfterPairHtml,
  exportImprovedZip,
  improvePages,
  pageContentName,
  readImproveIndex,
  renderThumbnails,
  variantFileName,
  writeImproveIndex,
  type AuditExportFile,
  type ImprovedExport,
  type ImproveIo,
  type PitchImproved,
  type AuditStore,
  type ExportOptions,
  type AuditAiResolution,
  documentsFromView,
  editedViewOf,
  estimateTranslation,
  translateDocuments,
  translationCacheName,
  withLabelsOnlyNotice,
  type TranslationCache,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { readJsonBody, sendJson } from './body.js';
import type { AuditCaller } from './audit-store.js';
import { AUDIT_NOT_FOUND, refuse, refuseStoreFailure, pitchScreenshots, readEdits } from './audit-common.js';
import { loadResolvedSettings, type AuditSettingsStore } from './audit-settings.js';

/** What the download rows need: the Website Audit store (G6) and the stored audit settings (BE-508). */
export interface AuditExportDeps {
  store: AuditStore;
  settings: AuditSettingsStore;
  /** Prints HTML to PDF; the Chromium printer by default. Tests inject a stub. */
  exportOptions?: ExportOptions;
  /** How many PDFs may be made at once on this runner (they share one Chromium, a context each). Default 2. */
  maxConcurrentPdf?: number;
  /** Thumbnails of the Improved version's variants (T-415); one Chromium per call by default. */
  renderThumbnails?: (pages: readonly string[]) => Promise<Array<Buffer | null>>;
  /**
   * Who is asking, and the tool user's audit AI (T-420). Both given: an export in another language is
   * translated with the owner's key. Either missing, or the caller is a Helper: labels only.
   */
  caller?: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
  resolveAi?: () => Promise<AuditAiResolution>;
  aiTimeoutMs?: number;
}

/** Variants whose "after" image is drawn in an export; the rest list their changes only. */
const MAX_EXPORT_THUMBNAILS = 6;
const MAX_BEFORE_BYTES = 3_000_000;

/** A variant the Improved version shows: made, and not refused by the quality gate (T-414). */
const shown = (v: ImproveVariant) => v.status === 'made' && v.gate?.passed !== false;

function improveIo(store: AuditStore, auditId: string, version: number): Pick<ImproveIo, 'readJson' | 'writeJson'> {
  return {
    readJson: (name) => store.readVersionJson(auditId, version, name),
    writeJson: (name, value) => store.writeVersionJson(auditId, version, name, value),
  };
}

const jpegUri = (bytes: Buffer | null | undefined) =>
  bytes && bytes.byteLength > 0 ? `data:image/jpeg;base64,${bytes.toString('base64')}` : undefined;

async function pngUri(store: AuditStore, auditId: string, version: number, path: string | null | undefined) {
  if (!path || !/[.]png$/i.test(path)) return undefined;
  try {
    const bytes = await store.getVersionFile(auditId, version, path);
    return bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_BEFORE_BYTES
      ? `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
      : undefined;
  } catch {
    return undefined;
  }
}

const RUNNING = 'This version of the Website Audit is still running. Download it when it has finished.';
const NO_RESULT = 'This version of the Website Audit has no finished result to download.';
const FAILED = 'The file could not be made. Try again.';
const NO_VARIANT = 'No design variant of this version has passed the checks yet.';
const PDF_BUSY = 'Another PDF is being made. Try again in a moment.';
const PDF_RETRY_AFTER_SECONDS = 5;
const DEFAULT_MAX_CONCURRENT_PDF = 2;

const DOCUMENT_SLUGS: Readonly<Record<AuditDocumentKind, string>> = {
  structure: 'structure',
  content: 'content',
  findings: 'findings',
  roadmap: 'improvement-roadmap',
  proposal: 'proposal',
};

function invalid(res: http.ServerResponse, error: string): void {
  refuse(res, 400, 'ERR_INVALID_REQUEST', error);
}

/** The query values every row shares, checked. A string is the sentence of the first refusal. */
interface CommonQuery {
  version: number | undefined;
  language: DocumentLanguage | undefined;
}

function commonQuery(url: URL): CommonQuery | string {
  const rawVersion = url.searchParams.get('version');
  let version: number | undefined;
  if (rawVersion !== null) {
    if (!/^[1-9][0-9]{0,6}$/.test(rawVersion)) return 'version: a whole number from 1.';
    version = Number(rawVersion);
  }
  const rawLanguage = url.searchParams.get('language');
  let language: DocumentLanguage | undefined;
  if (rawLanguage !== null) {
    if (!isDocumentLanguage(rawLanguage)) return 'language: pick one of the document languages.';
    language = rawLanguage;
  }
  return { version, language };
}

/** `?format=`: one of `allowed`; `fallback` when absent (undefined fallback means required). */
function formatQuery<F extends ExportFormat>(url: URL, allowed: readonly F[], fallback: F | undefined): F | string {
  const raw = url.searchParams.get('format');
  if (raw === null) return fallback ?? `format: one of ${allowed.join(', ')}.`;
  if (!isExportFormat(raw) || !(allowed as readonly string[]).includes(raw))
    return `format: one of ${allowed.join(', ')}.`;
  return raw as F;
}

/** `?documents=a,b`: known kinds only; absent means all five (an empty list is refused). */
function documentsQuery(url: URL): AuditDocumentKind[] | undefined | string {
  const raw = url.searchParams.get('documents');
  if (raw === null) return undefined;
  const kinds = raw.split(',');
  const bad = kinds.find((k) => !isAuditDocumentKind(k));
  if (bad !== undefined) return `documents: a comma list of ${AUDIT_DOCUMENT_KINDS.join(', ')}.`;
  return [...new Set(kinds as AuditDocumentKind[])];
}

/** A file name safe in a header and on disk: letters, digits, dot, dash, underscore. */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120);
  return cleaned === '' ? 'audit' : cleaned;
}

function sendFile(res: http.ServerResponse, file: AuditExportFile): void {
  res.writeHead(200, {
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${safeFileName(file.fileName)}"`,
    'Content-Length': String(file.body.byteLength),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(file.body);
}

interface Loaded {
  auditId: string;
  version: number;
  result: AuditResult;
  contents: PageContent[];
  edits: EditOverlay;
}

/** The finished version with its Page Content and edits, or null after the refusal was sent. */
async function load(store: AuditStore, c: RouteContext, wanted: number | undefined): Promise<Loaded | null> {
  const auditId = c.params?.id;
  if (!auditId) {
    refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
    return null;
  }
  const record = await store.readAuditRecord(auditId);
  const version = wanted ?? record?.latestVersion;
  const found = record && version !== undefined ? await store.getVersion(auditId, version) : null;
  if (!record || version === undefined || !found) {
    refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
    return null;
  }
  if (found.status === 'running') {
    refuse(c.res, 409, 'ERR_AUDIT_RUNNING', RUNNING);
    return null;
  }
  const result = await store.getResult(auditId, version);
  if (!result) {
    refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NO_RESULT);
    return null;
  }
  // Read together: on the hosted copy each read is a Cloud Storage request. Order follows result.pages.
  const read = await Promise.all(
    result.pages.map((page) =>
      store
        .readVersionJson<PageContent>(auditId, version, pageContentName(page.urlPath))
        // A page without readable Page Content keeps its stored text.
        .catch(() => null)
    )
  );
  const contents: PageContent[] = read.filter((content): content is PageContent => !!content);
  const edits = await readEdits(store, auditId, version);
  return { auditId, version, result, contents, edits };
}

/** The download rows (export access: the owner's key, or a Helper with the export permission). */
export function auditExportRoutes(deps: AuditExportDeps): Route[] {
  const { store, settings } = deps;
  const options: ExportOptions = deps.exportOptions ?? {};
  const maxPdf = Math.max(1, Math.floor(deps.maxConcurrentPdf ?? DEFAULT_MAX_CONCURRENT_PDF));
  let activePdf = 0;

  /**
   * A PDF slot (a PDF needs its own Chromium; the runner is small). Other formats need none. When all slots
   * are taken the refusal is sent at once (no queue) and null is returned. The release is safe to call twice.
   * ERR_RUN_IN_PROGRESS is the closest existing code: "the runner is busy, try again".
   */
  const takeSlot = (res: http.ServerResponse, format: ExportFormat): (() => void) | null => {
    if (format !== 'pdf') return () => {};
    if (activePdf >= maxPdf) {
      res.setHeader('Retry-After', String(PDF_RETRY_AFTER_SECONDS));
      refuse(res, 503, 'ERR_RUN_IN_PROGRESS', PDF_BUSY);
      return null;
    }
    activePdf += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activePdf -= 1;
    };
  };

  /** The owner's working AI, or null: a Helper never spends the owner's key. */
  const ownerAi = async (c: RouteContext) => {
    if (!deps.caller || !deps.resolveAi) return null;
    try {
      if (!(await deps.caller(c)).owner) return null;
      const resolved = await deps.resolveAi();
      return resolved.ok ? resolved.ai : null;
    } catch {
      return null;
    }
  };

  const readTranslationCache = async (loaded: Loaded, language: DocumentLanguage): Promise<TranslationCache> => {
    const stored = await store
      .readVersionJson<TranslationCache>(loaded.auditId, loaded.version, translationCacheName(language))
      .catch(() => null);
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
  };

  /**
   * T-420: the hook that puts an export into `language`. The version's own language needs none. With the
   * owner's key the text is translated (cached per version, language and string); otherwise the documents say
   * "Labels only".
   */
  const translateHook = async (
    c: RouteContext,
    loaded: Loaded,
    language: DocumentLanguage | undefined
  ): Promise<ExportOptions['translate'] | undefined> => {
    if (!language || language === loaded.result.language) return undefined;
    const ai = await ownerAi(c);
    if (!ai) return async (docs) => withLabelsOnlyNotice(docs, loaded.result.language);
    return async (docs) => {
      const cache = await readTranslationCache(loaded, language);
      const done = await translateDocuments({ docs, language, ai, cache, timeoutMs: deps.aiTimeoutMs });
      if (done.cacheChanged) {
        await store
          .writeVersionJson(loaded.auditId, loaded.version, translationCacheName(language), cache)
          .catch(() => undefined);
      }
      // Nothing came back in the language: the export is labels only, and says so.
      return done.translated + done.fromCache === 0
        ? withLabelsOnlyNotice(done.docs, loaded.result.language)
        : done.docs;
    };
  };

  const translationRoute = async (c: RouteContext): Promise<void> => {
    const common = commonQuery(c.url);
    if (typeof common === 'string') return invalid(c.res, common);
    try {
      const loaded = await load(store, c, common.version);
      if (!loaded) return;
      const sourceLanguage = loaded.result.language;
      const language = common.language ?? sourceLanguage;
      const ai = await ownerAi(c);
      const needed = language !== sourceLanguage;
      let requests = 0;
      if (needed && ai) {
        const view = editedViewOf(loaded);
        const docs = documentsFromView(view, {
          settings: await loadResolvedSettings(settings),
          language,
          documents: undefined,
        });
        requests = estimateTranslation(docs, await readTranslationCache(loaded, language)).requests;
      }
      const reply: ExportTranslationReply = {
        needed,
        sourceLanguage,
        aiKey: ai !== null,
        requests,
        labelsOnly: needed && ai === null,
      };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err, { failed: FAILED });
    }
  };

  const thumbnails = deps.renderThumbnails ?? ((pages: readonly string[]) => renderThumbnails(pages));

  /**
   * The Improved version's shown variants (T-415), best first, with their stored pages and the phone
   * screenshot ("before"); the first `drawn` get a thumbnail ("after"). Null when there is none.
   */
  const loadImproved = async (loaded: Loaded, drawn: number): Promise<ImprovedExport | null> => {
    const index = await readImproveIndex(
      improveIo(store, loaded.auditId, loaded.version),
      loaded.version,
      loaded.result.language
    );
    const pages = new Map(improvePages(loaded.result).map((p) => [p.key, p]));
    const best = index.best;
    const isBest = (v: ImproveVariant) => !!best && best.page === v.page && best.variant === v.variant;
    const list = index.variants
      .filter((v) => shown(v) && pages.has(v.page))
      .sort((a, b) => Number(isBest(b)) - Number(isBest(a)));
    const variants: ImprovedExport['variants'] = [];
    for (const v of list) {
      const bytes = await store.getVersionFile(loaded.auditId, loaded.version, variantFileName(v.page, v.variant));
      if (!bytes) continue;
      const page = pages.get(v.page)!;
      const before = await pngUri(store, loaded.auditId, loaded.version, page.screenshotPath);
      variants.push({ page, variant: v, html: Buffer.from(bytes).toString('utf8'), ...(before ? { before } : {}) });
    }
    if (variants.length === 0) return null;
    const take = variants.slice(0, drawn);
    const shots = take.length > 0 ? await thumbnails(take.map((v) => v.html)).catch(() => []) : [];
    take.forEach((v, i) => {
      const after = jpegUri(shots[i]);
      if (after) v.after = after;
    });
    return { variants, findings: loaded.result.findings.map((f) => ({ id: f.id, title: f.title })) };
  };

  /** The starred variant, or the first that passed, as the Pitch Glimpse's before/after thumbnail. */
  const pitchImproved = async (loaded: Loaded): Promise<PitchImproved | undefined> => {
    const improved = await loadImproved(loaded, 1).catch(() => null);
    const best = improved?.variants[0];
    if (!best) return undefined;
    // Before and after in one thumbnail, so the Pitch Glimpse stays on one A4 page.
    const [pair] =
      best.before && best.after
        ? await thumbnails([beforeAfterPairHtml(best.before, best.after)]).catch(() => [null])
        : [null];
    const pairUri = jpegUri(pair);
    return {
      urlPath: best.page.urlPath,
      cites: best.variant.cites ?? [],
      ...(best.after ? { after: best.after } : {}),
      ...(pairUri ? { pair: pairUri } : {}),
    };
  };

  const improvedZipRoute = async (c: RouteContext): Promise<void> => {
    const common = commonQuery(c.url);
    if (typeof common === 'string') return invalid(c.res, common);
    try {
      const loaded = await load(store, c, common.version);
      if (!loaded) return;
      const improved = await loadImproved(loaded, 0);
      if (!improved) return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NO_VARIANT);
      sendFile(c.res, exportImprovedZip(improved, loaded.result.url, loaded.version));
    } catch (err) {
      refuseStoreFailure(c.res, err, { failed: FAILED });
    }
  };

  const bestRoute = async (c: RouteContext): Promise<void> => {
    let body: { version?: unknown; page?: unknown; variant?: unknown };
    try {
      body = await readJsonBody(c.req, 2_000);
    } catch {
      return invalid(c.res, 'The request is not valid JSON.');
    }
    if (!body || typeof body !== 'object' || typeof body.page !== 'string' || typeof body.variant !== 'number')
      return invalid(c.res, 'Name the page and the variant to star.');
    if (body.version !== undefined && (typeof body.version !== 'number' || !Number.isInteger(body.version)))
      return invalid(c.res, 'version: a whole number from 1.');
    try {
      const loaded = await load(store, c, body.version as number | undefined);
      if (!loaded) return;
      const io = improveIo(store, loaded.auditId, loaded.version);
      const index = await readImproveIndex(io, loaded.version, loaded.result.language);
      const entry = index.variants.find((v) => v.page === body.page && v.variant === body.variant && shown(v));
      if (!entry) return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NO_VARIANT);
      const best = { page: entry.page, variant: entry.variant };
      await writeImproveIndex(io, { ...index, best });
      const reply: ImproveBestReply = { best };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err, { failed: FAILED });
    }
  };

  const exportRoute = async (c: RouteContext): Promise<void> => {
    const common = commonQuery(c.url);
    if (typeof common === 'string') return invalid(c.res, common);
    const format = formatQuery(c.url, EXPORT_FORMATS, undefined);
    if (!isExportFormat(format)) return invalid(c.res, format);
    const documents = documentsQuery(c.url);
    if (typeof documents === 'string') return invalid(c.res, documents);
    const release = takeSlot(c.res, format);
    if (!release) return;
    try {
      const loaded = await load(store, c, common.version);
      if (!loaded) return;
      if (
        (format === 'md' || format === 'html') &&
        documents?.length === 1 &&
        documents[0] !== 'proposal' &&
        loaded.edits.updatedAt === null &&
        (!common.language || common.language === loaded.result.language)
      ) {
        const kind = documents[0]!;
        const docFormat = format === 'md' ? 'markdown' : 'html';
        const stored = await store.readAuditDocument(
          loaded.auditId,
          loaded.version,
          kind as StoredDocumentKind,
          docFormat
        );
        if (stored !== null) {
          const base = exportBaseName(loaded.result.url, loaded.result.version);
          const stem = `${base}-${DOCUMENT_SLUGS[kind] ?? kind}`;
          sendFile(c.res, {
            fileName: `${stem}.${format}`,
            contentType: EXPORT_CONTENT_TYPES[format],
            body: Buffer.from(stored, 'utf8'),
          });
          return;
        }
      }
      // The Improved version joins every export when a variant passed the checks (T-415).
      const improved = await loadImproved(loaded, format === 'bundle' ? 0 : MAX_EXPORT_THUMBNAILS);
      const translate = await translateHook(c, loaded, common.language);
      const exportOptions: ExportOptions = {
        ...options,
        ...(improved ? { improved } : {}),
        ...(translate ? { translate } : {}),
      };
      const file = await exportAudit(
        format,
        {
          result: loaded.result,
          contents: loaded.contents,
          edits: loaded.edits,
          settings: await loadResolvedSettings(settings),
          ...(common.language ? { language: common.language } : {}),
          ...(documents ? { documents } : {}),
        },
        exportOptions
      );
      sendFile(c.res, file);
    } catch (err) {
      refuseStoreFailure(c.res, err, { failed: FAILED });
    } finally {
      release();
    }
  };

  const pitchRoute = async (c: RouteContext): Promise<void> => {
    const common = commonQuery(c.url);
    if (typeof common === 'string') return invalid(c.res, common);
    const format = formatQuery(c.url, ['html', 'pdf'] as const, 'html');
    if (format !== 'html' && format !== 'pdf') return invalid(c.res, format);
    const release = takeSlot(c.res, format);
    if (!release) return;
    try {
      const loaded = await load(store, c, common.version);
      if (!loaded) return;
      const { optOutText } = await loadResolvedSettings(settings);
      const file = await exportPitchGlimpse(
        format,
        {
          result: loaded.result,
          contents: loaded.contents,
          edits: loaded.edits,
          settings: { optOutText },
          screenshots: await pitchScreenshots(store, loaded),
          ...(common.language ? { language: common.language } : {}),
        },
        options,
        await pitchImproved(loaded)
      );
      sendFile(c.res, file);
    } catch (err) {
      refuseStoreFailure(c.res, err, { failed: FAILED });
    } finally {
      release();
    }
  };

  const ownerRoute = async (c: RouteContext): Promise<void> => {
    const common = commonQuery(c.url);
    if (typeof common === 'string') return invalid(c.res, common);
    const format = formatQuery(c.url, ['md', 'html', 'pdf', 'docx'] as const, 'md');
    if (format !== 'md' && format !== 'html' && format !== 'pdf' && format !== 'docx') return invalid(c.res, format);
    const release = takeSlot(c.res, format);
    if (!release) return;
    try {
      const loaded = await load(store, c, common.version);
      if (!loaded) return;
      if (
        (format === 'md' || format === 'html') &&
        loaded.edits.updatedAt === null &&
        (!common.language || common.language === loaded.result.language)
      ) {
        const docFormat = format === 'md' ? 'markdown' : 'html';
        const stored = await store.readAuditDocument(loaded.auditId, loaded.version, 'owner-audit', docFormat);
        if (stored !== null) {
          const name = `${exportBaseName(loaded.result.url, loaded.result.version)}-owner-audit.${format}`;
          sendFile(c.res, {
            fileName: name,
            contentType: EXPORT_CONTENT_TYPES[format],
            body: Buffer.from(stored, 'utf8'),
          });
          return;
        }
      }
      const file = await exportOwnerAudit(
        format,
        {
          result: loaded.result,
          contents: loaded.contents,
          edits: loaded.edits,
          ...(common.language ? { language: common.language } : {}),
        },
        options
      );
      sendFile(c.res, file);
    } catch (err) {
      refuseStoreFailure(c.res, err, { failed: FAILED });
    } finally {
      release();
    }
  };

  return [
    {
      method: AUDIT_API.export.method,
      path: AUDIT_API.export.path,
      access: AUDIT_API.export.access,
      handle: exportRoute,
    },
    { method: AUDIT_API.pitch.method, path: AUDIT_API.pitch.path, access: AUDIT_API.pitch.access, handle: pitchRoute },
    { method: AUDIT_API.owner.method, path: AUDIT_API.owner.path, access: AUDIT_API.owner.access, handle: ownerRoute },
    {
      method: AUDIT_API.exportImproved.method,
      path: AUDIT_API.exportImproved.path,
      access: AUDIT_API.exportImproved.access,
      handle: improvedZipRoute,
    },
    {
      method: AUDIT_API.exportTranslation.method,
      path: AUDIT_API.exportTranslation.path,
      access: AUDIT_API.exportTranslation.access,
      handle: translationRoute,
    },
    {
      method: AUDIT_API.setImproveBest.method,
      path: AUDIT_API.setImproveBest.path,
      access: AUDIT_API.setImproveBest.access,
      handle: bestRoute,
    },
  ];
}
