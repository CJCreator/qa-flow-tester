import type { AuditVersion, StoredAuditDocument, StoredDocumentKind } from '@qa/types/src/browser.js';
import { Link, PATHS } from '../../../lib/router';

export const ALL_STORED_DOCUMENT_KINDS: readonly StoredDocumentKind[] = [
  'structure',
  'content',
  'findings',
  'roadmap',
  'proposal',
  'pitch-glimpse',
  'owner-audit',
];

export const DOCUMENT_TITLES: Readonly<Record<StoredDocumentKind, string>> = {
  structure: 'Structure',
  content: 'Content',
  findings: 'Findings',
  roadmap: 'Improvement Roadmap',
  proposal: 'Proposal',
  'pitch-glimpse': 'Pitch Glimpse',
  'owner-audit': 'Owner Audit',
};

export const DOCUMENT_DESCRIPTIONS: Readonly<Record<StoredDocumentKind, string>> = {
  structure: 'The page hierarchy and navigation.',
  content: 'The Page Content of every page, Section by Section.',
  findings: 'Technical, marketing and content findings, ranked by impact.',
  roadmap: 'The findings turned into ordered work.',
  proposal: 'Website-only work, filled from your Proposal template.',
  'pitch-glimpse': 'Top issues found on the website for quick pitching.',
  'owner-audit': 'A summary for the site owner.',
};

export interface DocumentsReadyProps {
  version: AuditVersion;
  auditId?: string;
}

/** Lists the 7 documents produced by a Website Audit with their readiness state (T-88, ADR 0042). */
export function DocumentsReady({ version, auditId }: DocumentsReadyProps) {
  const id = auditId ?? version.auditId;
  const versionNum = version.version;
  const docs = version.documents ?? [];
  const docMap = new Map<StoredDocumentKind, StoredAuditDocument>();
  for (const doc of docs) {
    docMap.set(doc.kind, doc);
  }

  const reviewUrl = PATHS.auditReview(id, versionNum);
  const exportUrl = PATHS.auditExport(id, versionNum);

  return (
    <section aria-labelledby="audit-documents-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="audit-documents-title" className="text-xl font-bold">
            Audit Documents ready
          </h2>
          <p className="text-sm text-ink-soft">
            The 7 documents prepared for this Website Audit version.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={reviewUrl} className="btn-quiet btn-sm">
            Open
          </Link>
          <Link to={exportUrl} className="btn-secondary btn-sm">
            Download all
          </Link>
        </div>
      </div>
      <ul className="space-y-2">
        {ALL_STORED_DOCUMENT_KINDS.map((kind) => {
          const stored = docMap.get(kind);
          const isReady = stored?.status === 'ready';
          const title = stored?.title || DOCUMENT_TITLES[kind];
          const description = DOCUMENT_DESCRIPTIONS[kind];

          return (
            <li
              key={kind}
              data-document-kind={kind}
              data-document-status={stored?.status ?? 'not-written'}
              className="card-1 flex flex-wrap items-center justify-between gap-3 bg-surface p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{title}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isReady ? 'bg-pass-tint text-pass' : 'bg-panel text-ink-soft'
                    }`}
                  >
                    {isReady ? 'Ready' : 'Not written'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{description}</p>
                {!isReady && (
                  <p className="mt-1 text-xs text-ink-soft">
                    {`Reason: ${stored?.reason ?? 'Not written for this version.'}`}
                  </p>
                )}
              </div>
              <div className="shrink-0">
                {isReady ? (
                  <Link to={reviewUrl} className="btn-link text-sm">
                    Open
                  </Link>
                ) : (
                  <span className="text-xs text-ink-soft">Not written</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
