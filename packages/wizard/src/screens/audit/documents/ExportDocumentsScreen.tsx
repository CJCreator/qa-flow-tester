import { useEffect, useState } from 'react';
import {
  AUDIT_DOCUMENT_KINDS,
  type AuditDocumentKind,
  type AuditStatus,
  type ExportFormat,
} from '@qa/types/src/browser.js';
import { ErrorMessage, FocusHeading, Notice, Spinner } from '../../../components/text';
import { Link, PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import { loadAudit } from './review-api';
import {
  EXPORT_LANGUAGES,
  OWNER_AUDIT_FORMATS,
  PITCH_FORMATS,
  defaultExportChoice,
  defaultOwnerAuditChoice,
  defaultPitchChoice,
  exportBlockedReason,
  exportUrl,
  fallbackFileName,
  fetchDownload,
  ownerAuditUrl,
  pitchUrl,
  saveBlob,
  setDocument,
  type DownloadKind,
  type ExportChoice,
  type Fetch,
  type ExportLanguage,
  type OwnerAuditChoice,
  type PitchChoice,
} from './export-api';

const DOCUMENT_LABEL: Readonly<Record<AuditDocumentKind, string>> = {
  structure: 'Structure',
  content: 'Content',
  findings: 'Findings',
  roadmap: 'Improvement Roadmap',
  proposal: 'Proposal',
};

const DOCUMENT_HINT: Readonly<Record<AuditDocumentKind, string>> = {
  structure: 'The page hierarchy and navigation.',
  content: 'The Page Content of every page, Section by Section.',
  findings: 'Technical, marketing and content findings, ranked by impact.',
  roadmap: 'The findings turned into ordered work.',
  proposal: 'Website-only work, filled from your Proposal template.',
};

const FORMAT_LABEL: Readonly<Record<ExportFormat, string>> = {
  md: 'Markdown',
  html: 'HTML',
  pdf: 'PDF',
  docx: 'Word',
  bundle: 'Claude Code bundle',
};

const FORMAT_HINT: Partial<Record<ExportFormat, string>> = {
  bundle: 'A zip of the Markdown documents, site.json and a README index.',
};

const EXPORT_FORMATS_SHOWN: readonly ExportFormat[] = ['md', 'html', 'pdf', 'docx', 'bundle'];

const LANGUAGE_LABEL: Readonly<Record<ExportLanguage, string>> = { en: 'English', ta: 'Tamil' };

const DOWNLOAD_CLASS =
  'btn-primary inline-block min-h-[44px] rounded-control px-4 py-2 text-sm font-bold shadow-level-1';

function RadioGroup<V extends string>({
  name,
  legend,
  options,
  value,
  labels,
  hints,
  onChange,
}: {
  name: string;
  legend: string;
  options: readonly V[];
  value: V;
  labels: Readonly<Record<NoInfer<V>, string>>;
  hints?: Partial<Record<NoInfer<V>, string>>;
  onChange: (value: V) => void;
}) {
  return (
    <fieldset className="mt-4">
      <legend className="label text-ink">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
        {options.map((option) => {
          const id = `${name}-${option}`;
          const hint = hints?.[option];
          return (
            <span key={option} className="inline-flex items-center gap-1.5">
              <input
                id={id}
                type="radio"
                name={name}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
                {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
              />
              <label htmlFor={id}>{labels[option]}</label>
              {hint && (
                <span id={`${id}-hint`} className="text-xs text-ink-soft">
                  {hint}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface ExportDocumentsViewProps {
  auditId: string;
  version?: number;
  choice: ExportChoice;
  pitch: PitchChoice;
  owner: OwnerAuditChoice;
  onChoice: (choice: ExportChoice) => void;
  onPitch: (choice: PitchChoice) => void;
  onOwner: (choice: OwnerAuditChoice) => void;
  /** Starts one download; the screen fetches the GET route and saves the file. */
  onDownload?: (kind: DownloadKind) => void;
  /** The download in progress, if any. */
  busy?: DownloadKind | null;
  /** Why export is off for this version (still running, or failed); null when it is on. */
  blockedReason?: string | null;
  /** The last download's refusal, in the runner's words. */
  error?: string | null;
  /** The version read has not answered yet: every download stays off. */
  checking?: boolean;
  /** The version read failed, in the runner's words: every download stays off. */
  loadError?: string | null;
  /** Reads the version again. */
  onRetry?: () => void;
}

/**
 * The export panel itself, without state. Every download is a GET of the tool saved as a file: the tool
 * user hands the files over; the tool sends nothing (REQ-019 AC-4).
 */
export function ExportDocumentsView({
  auditId,
  version,
  choice,
  pitch,
  owner,
  onChoice,
  onPitch,
  onOwner,
  onDownload = () => {},
  busy = null,
  blockedReason = null,
  error = null,
  checking = false,
  loadError = null,
  onRetry = () => {},
}: ExportDocumentsViewProps) {
  const off = blockedReason !== null || busy !== null || checking || loadError !== null;
  const documentsHref = exportUrl(auditId, choice, version);
  return (
    <div className="space-y-10">
      {blockedReason !== null && (
        <Notice tone="warn" title="Export is not available yet">
          {blockedReason}
        </Notice>
      )}
      {checking && <Spinner label="Checking this version…" />}
      {loadError !== null && (
        <>
          <ErrorMessage>{loadError}</ErrorMessage>
          <button type="button" className="btn-quiet min-h-[44px] px-4 text-sm" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
      {busy !== null && <Spinner label="Making the file…" />}
      {error !== null && <ErrorMessage>{error}</ErrorMessage>}
      <section aria-labelledby="export-documents-title" className="card-1 bg-surface p-4">
        <h2 id="export-documents-title" className="text-xl font-bold">
          Audit Documents
        </h2>
        <fieldset className="mt-4">
          <legend className="label text-ink">Audit Documents to include</legend>
          <ul className="mt-1 space-y-2">
            {AUDIT_DOCUMENT_KINDS.map((kind) => {
              const id = `export-document-${kind}`;
              return (
                <li key={kind} className="flex flex-wrap items-center gap-2">
                  <input
                    id={id}
                    type="checkbox"
                    checked={choice.documents.includes(kind)}
                    aria-describedby={`${id}-hint`}
                    onChange={(e) => onChoice(setDocument(choice, kind, e.target.checked))}
                  />
                  <label htmlFor={id} className="font-semibold">
                    {DOCUMENT_LABEL[kind]}
                  </label>
                  <span id={`${id}-hint`} className="text-sm text-ink-soft">
                    {DOCUMENT_HINT[kind]}
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <RadioGroup
          name="export-language"
          legend="Language"
          options={EXPORT_LANGUAGES}
          value={choice.language}
          labels={LANGUAGE_LABEL}
          onChange={(language) => onChoice({ ...choice, language })}
        />
        <RadioGroup
          name="export-format"
          legend="Format"
          options={EXPORT_FORMATS_SHOWN}
          value={choice.format}
          labels={FORMAT_LABEL}
          hints={FORMAT_HINT}
          onChange={(format) => onChoice({ ...choice, format })}
        />
        <div className="mt-5">
          {documentsHref === null ? (
            <p role="alert" className="text-sm font-semibold text-fail">
              Tick at least one Audit Document to download.
            </p>
          ) : (
            <button type="button" className={DOWNLOAD_CLASS} disabled={off} onClick={() => onDownload('documents')}>
              {`Download the Audit Documents (${FORMAT_LABEL[choice.format]}, ${LANGUAGE_LABEL[choice.language]})`}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="export-pitch-title" className="card-1 bg-surface p-4">
        <h2 id="export-pitch-title" className="text-xl font-bold">
          Pitch Glimpse
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          One A4 page for the site owner: the top 3 issues, a screenshot of each, and your opt-out text. Print it or
          hand the file over yourself.
        </p>
        <RadioGroup
          name="pitch-language"
          legend="Language"
          options={EXPORT_LANGUAGES}
          value={pitch.language}
          labels={LANGUAGE_LABEL}
          onChange={(language) => onPitch({ ...pitch, language })}
        />
        <RadioGroup
          name="pitch-format"
          legend="Format"
          options={PITCH_FORMATS}
          value={pitch.format}
          labels={FORMAT_LABEL}
          onChange={(format) => onPitch({ ...pitch, format })}
        />
        <div className="mt-5">
          <button type="button" className={DOWNLOAD_CLASS} disabled={off} onClick={() => onDownload('pitch')}>
            {`Download the Pitch Glimpse (${FORMAT_LABEL[pitch.format]}, ${LANGUAGE_LABEL[pitch.language]})`}
          </button>
        </div>
      </section>

      <section aria-labelledby="export-owner-title" className="card-1 bg-surface p-4">
        <h2 id="export-owner-title" className="text-xl font-bold">
          Owner Audit
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          A cleaned-up version of the Website Audit for the site owner, for when the owner asks for it. It leaves out
          your Shortlist mark, notes and outcome, the effort and the price, and starts with a plain-language summary.
        </p>
        <RadioGroup
          name="owner-language"
          legend="Language"
          options={EXPORT_LANGUAGES}
          value={owner.language}
          labels={LANGUAGE_LABEL}
          onChange={(language) => onOwner({ ...owner, language })}
        />
        <RadioGroup
          name="owner-format"
          legend="Format"
          options={OWNER_AUDIT_FORMATS}
          value={owner.format}
          labels={FORMAT_LABEL}
          onChange={(format) => onOwner({ ...owner, format })}
        />
        <div className="mt-5">
          <button type="button" className={DOWNLOAD_CLASS} disabled={off} onClick={() => onDownload('owner')}>
            {`Download the Owner Audit (${FORMAT_LABEL[owner.format]}, ${LANGUAGE_LABEL[owner.language]})`}
          </button>
        </div>
      </section>
    </div>
  );
}

export interface ExportDocumentsScreenProps {
  auditId: string;
  /** The version to export; the latest when not given. */
  version?: number;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** For tests: saves the file. */
  saveFile?: (blob: Blob, fileName: string) => void;
}

/** Export a Website Audit version: the Audit Documents, the Pitch Glimpse and the Owner Audit (REQ-021, REQ-022). */
export function ExportDocumentsScreen({
  auditId,
  version,
  fetchImpl,
  saveFile = saveBlob,
}: ExportDocumentsScreenProps) {
  useDocumentTitle('Export Audit Documents');
  const [choice, setChoice] = useState<ExportChoice>(defaultExportChoice);
  const [pitch, setPitch] = useState<PitchChoice>(defaultPitchChoice);
  const [owner, setOwner] = useState<OwnerAuditChoice>(defaultOwnerAuditChoice);
  const [status, setStatus] = useState<AuditStatus | undefined>(undefined);
  const [shownVersion, setShownVersion] = useState<number | undefined>(version);
  const [busy, setBusy] = useState<DownloadKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Read the version first: a running or failed one has nothing to download, and nothing downloads before it answers.
  useEffect(() => {
    let live = true;
    setChecking(true);
    setLoadError(null);
    void loadAudit(auditId, version, fetchImpl).then((outcome) => {
      if (!live) return;
      setChecking(false);
      if (!outcome.ok) {
        setLoadError(outcome.message);
        return;
      }
      setStatus(outcome.value.version.status);
      setShownVersion(outcome.value.version.version);
    });
    return () => {
      live = false;
    };
  }, [auditId, version, fetchImpl, attempt]);

  const download = async (kind: DownloadKind) => {
    const url =
      kind === 'documents'
        ? exportUrl(auditId, choice, version)
        : kind === 'pitch'
          ? pitchUrl(auditId, pitch, version)
          : ownerAuditUrl(auditId, owner, version);
    if (url === null) return;
    const format = kind === 'documents' ? choice.format : kind === 'pitch' ? pitch.format : owner.format;
    setBusy(kind);
    setError(null);
    const outcome = await fetchDownload(url, fallbackFileName(kind, format), fetchImpl);
    if (outcome.ok) saveFile(outcome.blob, outcome.fileName);
    else setError(outcome.message);
    setBusy(null);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link to={PATHS.audit(auditId)} className="btn-link min-h-[44px]">
          Back to this Website Audit
        </Link>
        {shownVersion !== undefined && (
          <Link to={PATHS.auditReview(auditId, shownVersion)} className="btn-link min-h-[44px]">
            Review the Audit Documents
          </Link>
        )}
      </p>
      <FocusHeading className="mb-2 break-words text-question font-bold">Export the Audit Documents</FocusHeading>
      <p className="mb-6 max-w-prose text-ink-soft">
        Pick what to download, the language and the format. Downloads carry your saved edits. The tool never hands
        anything to the site owner for you: you decide what to give, and how.
      </p>
      {version !== undefined && <p className="mb-6 text-sm text-ink-soft">{`Version ${version}`}</p>}
      <ExportDocumentsView
        auditId={auditId}
        version={version}
        choice={choice}
        pitch={pitch}
        owner={owner}
        onChoice={setChoice}
        onPitch={setPitch}
        onOwner={setOwner}
        onDownload={(kind) => void download(kind)}
        busy={busy}
        blockedReason={exportBlockedReason(status)}
        error={error}
        checking={checking}
        loadError={loadError}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    </div>
  );
}
