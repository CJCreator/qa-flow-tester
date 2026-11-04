import type { AuditFinding } from '@qa/types/src/browser.js';
import { ADVISORY_LABEL, SCALE_LABEL, SOURCE_LABEL, sectionLabel } from './analysis-text';

export interface FindingsListProps {
  /** In ranked order (impact, then lower effort); shown exactly as given. */
  findings: AuditFinding[];
}

/** A Website Audit's findings, each with its page, Section, impact, effort and source (REQ-014). */
export function FindingsList({ findings }: FindingsListProps) {
  return (
    <section aria-labelledby="audit-findings-title" className="space-y-3">
      <h2 id="audit-findings-title" className="text-xl font-bold">
        Findings
      </h2>
      {findings.length === 0 ? (
        <p className="text-sm text-ink-soft">No findings were recorded.</p>
      ) : (
        <ol className="space-y-3">
          {findings.map((finding) => {
            const isAi = finding.source === 'ai' || finding.advisory === true;
            const pages = finding.pages && finding.pages.length > 1 ? finding.pages : null;
            return (
              <li key={finding.id} className="rounded border border-rule p-3" data-finding-id={finding.id}>
                <h3 className="font-bold">{finding.title}</h3>
                {isAi && (
                  <p className="mt-1 inline-flex rounded-full bg-accent/10 px-2 text-xs font-semibold text-accent">
                    {ADVISORY_LABEL}
                  </p>
                )}
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="font-bold">Page</dt>
                  <dd className="break-all">{finding.urlPath}</dd>
                  <dt className="font-bold">Section</dt>
                  <dd>{sectionLabel(finding.sectionId)}</dd>
                  {pages && (
                    <>
                      <dt className="font-bold">All pages</dt>
                      <dd>
                        <ul>
                          {pages.map((page) => (
                            <li key={page} className="break-all">
                              {page}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  )}
                  <dt className="font-bold">Impact</dt>
                  <dd>{SCALE_LABEL[finding.impact]}</dd>
                  <dt className="font-bold">Effort</dt>
                  <dd>{SCALE_LABEL[finding.effort]}</dd>
                  <dt className="font-bold">Source</dt>
                  <dd>{SOURCE_LABEL[finding.source]}</dd>
                </dl>
                <p className="mt-2 text-sm text-ink">{finding.detail}</p>
                <p className="mt-1 text-sm text-ink-soft">{`How to repair: ${finding.suggestion}`}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
