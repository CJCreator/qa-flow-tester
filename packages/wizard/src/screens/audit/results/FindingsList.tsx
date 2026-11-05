import type { AuditFinding } from '@qa/types/src/browser.js';
import { auditFileUrl } from './analysis-client';
import { ADVISORY_LABEL, SCALE_LABEL, SOURCE_LABEL, sectionLabel } from './analysis-text';

export interface FindingsListProps {
  /** In ranked order (impact, then lower effort); shown exactly as given. */
  findings: AuditFinding[];
  /** With it, a finding's screenshot is shown; without it, no image. */
  auditId?: string;
  /** The version the screenshots belong to; the latest when not given. */
  version?: number;
}

/** Impact reads from strong to quiet; effort is a plain chip. Whole class names so Tailwind finds them. */
const IMPACT_CHIP = {
  high: 'bg-fail-tint text-fail',
  medium: 'bg-warn-tint text-warn',
  low: 'bg-panel text-ink-soft',
} as const;

const CHIP = 'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold';

/** A Website Audit's findings: the title with impact and effort first, where it was found one click away (REQ-014). */
export function FindingsList({ findings, auditId, version }: FindingsListProps) {
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
              <li key={finding.id} id={finding.id} className="card-1 bg-surface p-4" data-finding-id={finding.id}>
                <h3 className="font-bold">{finding.title}</h3>
                <p className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`${CHIP} ${IMPACT_CHIP[finding.impact]}`}>
                    {`Impact: ${SCALE_LABEL[finding.impact]}`}
                  </span>
                  <span className={`${CHIP} bg-panel text-ink`}>{`Effort: ${SCALE_LABEL[finding.effort]}`}</span>
                  {isAi && <span className={`${CHIP} bg-stamp-tint text-stamp`}>{ADVISORY_LABEL}</span>}
                </p>
                <p className="mt-2 text-sm text-ink">{finding.detail}</p>
                <p className="mt-1 text-sm text-ink-soft">{`How to repair: ${finding.suggestion}`}</p>
                {auditId && finding.screenshotPath && (
                  <img
                    src={auditFileUrl(auditId, finding.screenshotPath, version)}
                    alt={`Screenshot of the page ${finding.urlPath} showing: ${finding.title}`}
                    loading="lazy"
                    className="mt-2 max-h-72 max-w-full rounded-card border border-rule"
                  />
                )}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-bold text-stamp">Where it was found</summary>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
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
                    <dt className="font-bold">Source</dt>
                    <dd>{SOURCE_LABEL[finding.source]}</dd>
                  </dl>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
