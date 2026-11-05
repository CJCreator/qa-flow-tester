import { useEffect, useState, type ReactNode } from 'react';
import {
  AUDIT_DOCUMENT_KINDS,
  type AuditDocumentKind,
  type AuditStatus,
  type ExportFormat,
} from '@qa/types/src/browser.js';
import { Notice, Spinner } from '../../../components/text';
import { Disclosure, LoadError, Page, PageHeader, Section } from '../../../components/ui';
import { PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import { AuditTabs } from '../AuditTabs';
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
  bundle: 'A bundle for AI coding tools',
};

const FORMAT_HINT: Partial<Record<ExportFormat, string>> = {
  bundle: 'A zip of the Markdown documents, site.json and a README index.',
};

const EXPORT_FORMATS_SHOWN: readonly ExportFormat[] = ['md', 'html', 'pdf', 'docx', 'bundle'];

const LANGUAGE_LABEL: Readonly<Record<ExportLanguage, string>> = { en: 'English', ta: 'Tamil' };

/** A button's name in a result line: the bundle's long label is shortened. */
const FORMAT_SHORT: Readonly<Record<ExportFormat, string>> = { ...FORMAT_LABEL, bundle: 'AI tools bundle' };

/** The Download buttons are quiet: the screen's one primary is the Audit Documents download. */
const DOWNLOAD_QUIET = 'btn-quiet';

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
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((option) => {
          const id = `${name}-${option}`;
          const hint = hints?.[option];
          return (
            <span key={option} className="inline-flex min-h-[44px] flex-wrap items-center gap-x-2">
              <input
                id={id}
                type="radio"
                name={name}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
                className="h-5 w-5 accent-stamp"
                {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
              />
              <label htmlFor={id} className="py-3 pr-2">
                {labels[option]}
              </label>
              {hint && (
                <span id={`${id}-hint`} className="text-sm text-ink-soft">
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

/** The result of the download just pressed, next to its button: working, done, or the refusal. */
function DownloadStatus({
  kind,
  busy,
  done,
  error,
  errorKind,
}: {
  kind: DownloadKind;
  busy: DownloadKind | null;
  done: { kind: DownloadKind; fileName: string } | null;
  error: string | null;
  errorKind: DownloadKind | null;
}): ReactNode {
  if (busy === kind) return <Spinner label="Making the file…" />;
  if (error !== null && errorKind === kind)
    return (
      <p role="alert" className="max-w-prose text-sm font-semibold text-fail">
        {error}
      </p>
    );
  if (done && done.kind === kind)
    return (
      <p role="status" className="break-all text-sm font-semibold text-pass">
        {`Downloaded: ${done.fileName}`}
      </p>
    );
  return null;
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
  /** Which download the refusal belongs to; without it the refusal shows at the top. */
  errorKind?: DownloadKind | null;
  /** The last download that worked, shown beside its button. */
  done?: { kind: DownloadKind; fileName: string } | null;
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
  errorKind = null,
  done = null,
  checking = false,
  loadError = null,
  onRetry = () => {},
}: ExportDocumentsViewProps) {
  const off = blockedReason !== null || busy !== null || checking || loadError !== null;
  const documentsHref = exportUrl(auditId, choice, version);
  return (
    <div className="space-y-12">
      {blockedReason !== null && (
        <Notice tone="warn" title="Download is not available yet">
          {blockedReason}
        </Notice>
      )}
      {checking && <Spinner label="Checking this version…" />}
      {loadError !== null && (
        <LoadError title="This version could not be read" onRetry={onRetry}>
          {loadError}
        </LoadError>
      )}
      {error !== null && errorKind === null && (
        <p role="alert" className="max-w-prose rounded-card border border-fail/40 bg-fail-tint px-4 py-3 text-fail">
          {error}
        </p>
      )}

      <Section id="export-documents" title="Audit Documents">
        <fieldset>
          <legend className="label text-ink">Audit Documents to include</legend>
          <ul className="mt-1">
            {AUDIT_DOCUMENT_KINDS.map((kind) => {
              const id = `export-document-${kind}`;
              return (
                <li key={kind} className="flex min-h-[44px] flex-wrap items-center gap-x-2 gap-y-0">
                  <input
                    id={id}
                    type="checkbox"
                    checked={choice.documents.includes(kind)}
                    aria-describedby={`${id}-hint`}
                    onChange={(e) => onChoice(setDocument(choice, kind, e.target.checked))}
                    className="h-5 w-5 accent-stamp"
                  />
                  <label htmlFor={id} className="py-3 pr-2 font-semibold">
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
        <div className="mt-3 max-w-prose">
          <Disclosure summary="Details for developers">
            <p className="text-sm text-ink-soft">
              The bundle is a zip made for Claude Code: the Markdown documents, site.json and a README index.
            </p>
          </Disclosure>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          {documentsHref === null ? (
            <p role="alert" className="text-sm font-semibold text-fail">
              Tick at least one Audit Document to download.
            </p>
          ) : (
            <button type="button" className="btn-primary" disabled={off} onClick={() => onDownload('documents')}>
              {`Download the Audit Documents (${FORMAT_SHORT[choice.format]}, ${LANGUAGE_LABEL[choice.language]})`}
            </button>
          )}
          <DownloadStatus kind="documents" busy={busy} done={done} error={error} errorKind={errorKind} />
        </div>
      </Section>

      <Section
        id="export-pitch"
        title="Pitch Glimpse"
        description="One A4 page for the site owner: the top 3 issues, a screenshot of each, and your opt-out text. Print it or hand the file over yourself."
      >
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
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button type="button" className={DOWNLOAD_QUIET} disabled={off} onClick={() => onDownload('pitch')}>
            {`Download the Pitch Glimpse (${FORMAT_SHORT[pitch.format]}, ${LANGUAGE_LABEL[pitch.language]})`}
          </button>
          <DownloadStatus kind="pitch" busy={busy} done={done} error={error} errorKind={errorKind} />
        </div>
      </Section>

      <Section
        id="export-owner"
        title="Owner Audit"
        description="A cleaned-up version of the Website Audit for the site owner, for when the owner asks for it. It leaves out your Shortlist mark, notes and outcome, the effort and the price, and starts with a plain-language summary."
      >
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
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button type="button" className={DOWNLOAD_QUIET} disabled={off} onClick={() => onDownload('owner')}>
            {`Download the Owner Audit (${FORMAT_SHORT[owner.format]}, ${LANGUAGE_LABEL[owner.language]})`}
          </button>
          <DownloadStatus kind="owner" busy={busy} done={done} error={error} errorKind={errorKind} />
        </div>
      </Section>
    </div>
  );
}

export interface ExportDocumentsScreenProps {
  auditId: string;
  /** The version to download; the latest when not given. */
  version?: number;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** For tests: saves the file. */
  saveFile?: (blob: Blob, fileName: string) => void;
}

/** Download a Website Audit version: the Audit Documents, the Pitch Glimpse and the Owner Audit (REQ-021, REQ-022). */
export function ExportDocumentsScreen({
  auditId,
  version,
  fetchImpl,
  saveFile = saveBlob,
}: ExportDocumentsScreenProps) {
  useDocumentTitle('Download documents');
  const [choice, setChoice] = useState<ExportChoice>(defaultExportChoice);
  const [pitch, setPitch] = useState<PitchChoice>(defaultPitchChoice);
  const [owner, setOwner] = useState<OwnerAuditChoice>(defaultOwnerAuditChoice);
  const [status, setStatus] = useState<AuditStatus | undefined>(undefined);
  const [shownVersion, setShownVersion] = useState<number | undefined>(version);
  const [busy, setBusy] = useState<DownloadKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<DownloadKind | null>(null);
  const [done, setDone] = useState<{ kind: DownloadKind; fileName: string } | null>(null);
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
    setErrorKind(null);
    setDone(null);
    const outcome = await fetchDownload(url, fallbackFileName(kind, format), fetchImpl);
    if (outcome.ok) {
      saveFile(outcome.blob, outcome.fileName);
      setDone({ kind, fileName: outcome.fileName });
    } else {
      setError(outcome.message);
      setErrorKind(kind);
    }
    setBusy(null);
  };

  return (
    <Page width="workspace">
      <PageHeader
        // Back to this audit, which a Helper may open too (the list of all audits is the owner's).
        back={{ to: PATHS.audit(auditId), label: 'Back to this Website Audit' }}
        meta={version !== undefined ? `Version ${version}` : undefined}
        title="Download documents"
        lede="Pick what to download, the language and the format. Downloads carry your saved edits. The tool never hands anything to the site owner for you: you decide what to give, and how."
      />
      {/* This screen doesn't know whether the caller is a Helper, so the owner-only tabs are left out. */}
      <AuditTabs auditId={auditId} version={shownVersion} current="download" hide={['share', 'helpers']} />
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
        errorKind={errorKind}
        done={done}
        checking={checking}
        loadError={loadError}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    </Page>
  );
}
