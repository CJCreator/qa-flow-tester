import { useState } from 'react';
import { AUDIT_DOCUMENT_KINDS, type AuditDocumentKind, type ExportFormat } from '@qa/types/src/browser.js';
import { FocusHeading } from '../../../components/text';
import {
  EXPORT_LANGUAGES,
  OWNER_AUDIT_FORMATS,
  PITCH_FORMATS,
  defaultExportChoice,
  defaultOwnerAuditChoice,
  defaultPitchChoice,
  exportUrl,
  ownerAuditUrl,
  pitchUrl,
  setDocument,
  type ExportChoice,
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

const DOWNLOAD_CLASS = 'btn-primary inline-block rounded-control px-4 py-2 text-sm font-bold shadow-level-1';

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
}

/**
 * The export panel itself, without state. Every download is a link to a GET route: the tool user hands
 * the files over; the tool sends nothing (REQ-019 AC-4).
 */
export function ExportDocumentsView({ auditId, version, choice, pitch, owner, onChoice, onPitch, onOwner }: ExportDocumentsViewProps) {
  const documentsHref = exportUrl(auditId, choice, version);
  return (
    <div className="space-y-10">
      <section aria-labelledby="export-documents-title" className="rounded border border-rule p-4">
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
            <a href={documentsHref} download className={DOWNLOAD_CLASS}>
              {`Download the Audit Documents (${FORMAT_LABEL[choice.format]}, ${LANGUAGE_LABEL[choice.language]})`}
            </a>
          )}
        </div>
      </section>

      <section aria-labelledby="export-pitch-title" className="rounded border border-rule p-4">
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
          <a href={pitchUrl(auditId, pitch, version)} download className={DOWNLOAD_CLASS}>
            {`Download the Pitch Glimpse (${FORMAT_LABEL[pitch.format]}, ${LANGUAGE_LABEL[pitch.language]})`}
          </a>
        </div>
      </section>

      <section aria-labelledby="export-owner-title" className="rounded border border-rule p-4">
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
          <a href={ownerAuditUrl(auditId, owner, version)} download className={DOWNLOAD_CLASS}>
            {`Download the Owner Audit (${FORMAT_LABEL[owner.format]}, ${LANGUAGE_LABEL[owner.language]})`}
          </a>
        </div>
      </section>
    </div>
  );
}

export interface ExportDocumentsScreenProps {
  auditId: string;
  /** The version to export; the latest when not given. */
  version?: number;
}

/** Export a Website Audit version: the Audit Documents, the Pitch Glimpse and the Owner Audit (REQ-021, REQ-022). */
export function ExportDocumentsScreen({ auditId, version }: ExportDocumentsScreenProps) {
  const [choice, setChoice] = useState<ExportChoice>(defaultExportChoice);
  const [pitch, setPitch] = useState<PitchChoice>(defaultPitchChoice);
  const [owner, setOwner] = useState<OwnerAuditChoice>(defaultOwnerAuditChoice);

  return (
    <div className="mx-auto max-w-[64rem] px-4 py-10 sm:px-6 sm:py-14">
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
      />
    </div>
  );
}
