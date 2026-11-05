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
  type AuditErrorCode,
  type AuditErrorReply,
  type AuditResult,
  type DocumentLanguage,
  type EditOverlay,
  type ExportFormat,
  type PageContent,
  type StoredDocumentKind,
} from '@qa/types';
import {
  AuditRecordError,
  AuditStoreError,
  PITCH_TOP_FINDINGS,
  applySettingsUpdate,
  editedViewOf,
  emptyAuditSettings,
  emptyOverlay,
  exportAudit,
  exportBaseName,
  exportOwnerAudit,
  exportPitchGlimpse,
  pageContentName,
  resolveAuditSettings,
  type AuditExportFile,
  type AuditStore,
  type ExportOptions,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { sendJson } from './body.js';
import type { AuditSettingsStore } from './audit-settings.js';

/** What the download rows need: the Website Audit store (G6) and the stored audit settings (BE-508). */
export interface AuditExportDeps {
  store: AuditStore;
  settings: AuditSettingsStore;
  /** Prints HTML to PDF; the Chromium printer by default. Tests inject a stub. */
  exportOptions?: ExportOptions;
  /** How many PDFs may be made at once on this runner (each starts a Chromium). Default 2. */
  maxConcurrentPdf?: number;
}

const EDITS_NAME = 'edits';
const NOT_FOUND = 'This Website Audit was not found. It may have been deleted.';
const RUNNING = 'This version of the Website Audit is still running. Download it when it has finished.';
const NO_RESULT = 'This version of the Website Audit has no finished result to download.';
const FAILED = 'The file could not be made. Try again.';
const PDF_BUSY = 'Another PDF is being made. Try again in a moment.';
const PDF_RETRY_AFTER_SECONDS = 5;
const DEFAULT_MAX_CONCURRENT_PDF = 2;
const MAX_SCREENSHOT_BYTES = 3_000_000;
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const DOCUMENT_SLUGS: Readonly<Record<AuditDocumentKind, string>> = {
  structure: 'structure',
  content: 'content',
  findings: 'findings',
  roadmap: 'improvement-roadmap',
  proposal: 'proposal',
};

function refuse(res: http.ServerResponse, status: number, code: AuditErrorCode, error: string): void {
  const body: AuditErrorReply = { error, code };
  sendJson(res, status, body);
}

function invalid(res: http.ServerResponse, error: string): void {
  refuse(res, 400, 'ERR_INVALID_REQUEST', error);
}

/** Store failures become fixed sentences: no keys, paths or provider text reach the caller. */
function refuseStoreFailure(res: http.ServerResponse, err: unknown): void {
  if (err instanceof AuditRecordError) {
    if (err.code === 'not-found') return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
    return invalid(res, 'The request is not valid.');
  }
  if (err instanceof AuditStoreError && err.code === 'invalid-key') return invalid(res, 'The request is not valid.');
  sendJson(res, 500, { error: FAILED });
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
    refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
    return null;
  }
  const record = await store.readAuditRecord(auditId);
  const version = wanted ?? record?.latestVersion;
  const found = record && version !== undefined ? await store.getVersion(auditId, version) : null;
  if (!record || version === undefined || !found) {
    refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
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
  const contents: PageContent[] = [];
  for (const page of result.pages) {
    try {
      const content = await store.readVersionJson<PageContent>(auditId, version, pageContentName(page.urlPath));
      if (content) contents.push(content);
    } catch {
      // A page without readable Page Content keeps its stored text.
    }
  }
  const edits = (await store.readVersionJson<EditOverlay>(auditId, version, EDITS_NAME)) ?? emptyOverlay();
  return { auditId, version, result, contents, edits };
}

/** Screenshots of the findings the Pitch Glimpse shows, as data: URIs. A missing or odd one is left out. */
async function pitchScreenshots(store: AuditStore, l: Loaded): Promise<Record<string, string>> {
  const shots: Record<string, string> = {};
  const top = editedViewOf({ result: l.result, contents: l.contents, edits: l.edits }).result.findings.slice(
    0,
    PITCH_TOP_FINDINGS
  );
  for (const finding of top) {
    const name = finding.screenshotPath;
    if (!name || Object.prototype.hasOwnProperty.call(shots, name)) continue;
    const type = IMAGE_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
    if (!type) continue;
    try {
      const bytes = await store.getVersionFile(l.auditId, l.version, name);
      if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_SCREENSHOT_BYTES) {
        shots[name] = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
      }
    } catch {
      // A path the store refuses is shown as "no screenshot", never as an error.
    }
  }
  return shots;
}

/** The saved settings over the defaults. A damaged stored object reads as the defaults. */
async function loadSettings(settings: AuditSettingsStore) {
  const raw = await settings.load();
  const checked = raw === null || raw === undefined ? null : applySettingsUpdate(emptyAuditSettings(), raw);
  const stored = checked && checked.ok ? checked.settings : emptyAuditSettings();
  return resolveAuditSettings(stored, false);
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
      const file = await exportAudit(
        format,
        {
          result: loaded.result,
          contents: loaded.contents,
          edits: loaded.edits,
          settings: await loadSettings(settings),
          ...(common.language ? { language: common.language } : {}),
          ...(documents ? { documents } : {}),
        },
        options
      );
      sendFile(c.res, file);
    } catch (err) {
      refuseStoreFailure(c.res, err);
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
      if (format === 'html' && (!common.language || common.language === loaded.result.language)) {
        const stored = await store.readAuditDocument(loaded.auditId, loaded.version, 'pitch-glimpse', 'html');
        if (stored !== null) {
          const name = `${exportBaseName(loaded.result.url, loaded.result.version)}-pitch-glimpse.html`;
          sendFile(c.res, {
            fileName: name,
            contentType: 'text/html; charset=utf-8',
            body: Buffer.from(stored, 'utf8'),
          });
          return;
        }
      }
      const { optOutText } = await loadSettings(settings);
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
        options
      );
      sendFile(c.res, file);
    } catch (err) {
      refuseStoreFailure(c.res, err);
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
      if ((format === 'md' || format === 'html') && (!common.language || common.language === loaded.result.language)) {
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
      refuseStoreFailure(c.res, err);
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
  ];
}
