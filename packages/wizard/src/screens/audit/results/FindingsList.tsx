import { useState } from 'react';
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

/** More than this many items after grouping: the rest wait behind "Show all". */
export const FINDINGS_SHOWN_FIRST = 8;

/** A full 44px target that reads as openable: underlined, with a chevron that turns when open. */
const SUMMARY =
  'inline-flex min-h-[44px] cursor-pointer items-center font-bold text-stamp underline decoration-2 underline-offset-4 after:ml-2 after:inline-flex after:h-2 after:w-2 after:rotate-45 after:border-b-2 after:border-r-2 after:border-current group-open:after:-rotate-[135deg]';

/** Findings that are the same issue (same title, same impact, same checker severity), in the order of the first one. */
function groupFindings(findings: AuditFinding[]): AuditFinding[][] {
  const groups = new Map<string, AuditFinding[]>();
  for (const finding of findings) {
    const key = JSON.stringify([finding.title, finding.impact, finding.severity ?? null]);
    const group = groups.get(key);
    if (group) group.push(finding);
    else groups.set(key, [finding]);
  }
  return [...groups.values()];
}

function pagesOf(finding: AuditFinding): string[] {
  return finding.pages && finding.pages.length > 1 ? finding.pages : [finding.urlPath];
}

function WhereFound({ group }: { group: AuditFinding[] }) {
  const first = group[0]!;
  if (group.length === 1) {
    const pages = first.pages && first.pages.length > 1 ? first.pages : null;
    return (
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-bold">Page</dt>
        <dd className="break-all">{first.urlPath}</dd>
        <dt className="font-bold">Section</dt>
        <dd>{sectionLabel(first.sectionId)}</dd>
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
        <dd>{SOURCE_LABEL[first.source]}</dd>
      </dl>
    );
  }
  const sources = [...new Set(group.map((f) => SOURCE_LABEL[f.source]))].join(', ');
  return (
    <>
      <ul className="mt-2 space-y-2">
        {group.map((f) => (
          <li key={f.id}>
            <span className="break-all font-bold">{pagesOf(f).join(', ')}</span>
            {` · ${sectionLabel(f.sectionId)}`}
            {f.target && <span className="flex break-all text-ink-soft">{`Element: ${f.target}`}</span>}
            {f.detail !== first.detail && <span className="flex text-ink-soft">{f.detail}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2">
        <span className="font-bold">Source</span> {sources}
      </p>
    </>
  );
}

function FindingItem({ group, auditId, version }: { group: AuditFinding[]; auditId?: string; version?: number }) {
  const finding = group[0]!;
  const count = group.length;
  const isAi = group.some((f) => f.source === 'ai' || f.advisory === true);
  const sameEffort = group.every((f) => f.effort === finding.effort);
  const shot = auditId ? group.find((f) => f.screenshotPath) : undefined;
  return (
    <li id={finding.id} className="card-1 bg-surface p-4 [overflow-wrap:anywhere]" data-finding-id={finding.id}>
      {/* Links to any finding of the group still land on the item. */}
      {group.slice(1).map((f) => (
        <span key={f.id} id={f.id} />
      ))}
      <h3 className="font-bold">
        {finding.title}
        {count > 1 && (
          <span className={`${CHIP} ml-2 bg-panel align-middle text-ink`}>
            <span aria-hidden="true">{`× ${count}`}</span>
            <span className="sr-only">{`Found ${count} times`}</span>
          </span>
        )}
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`${CHIP} ${IMPACT_CHIP[finding.impact]}`}>{`Impact: ${SCALE_LABEL[finding.impact]}`}</span>
        <span className={`${CHIP} bg-panel text-ink`}>
          {sameEffort ? `Effort: ${SCALE_LABEL[finding.effort]}` : 'Effort: Mixed'}
        </span>
        {isAi && <span className={`${CHIP} bg-stamp-tint text-stamp`}>{ADVISORY_LABEL}</span>}
      </p>
      <p className="mt-2 text-sm text-ink">{finding.detail}</p>
      <p className="mt-1 text-sm text-ink-soft">{`How to repair: ${finding.suggestion}`}</p>
      {auditId && shot?.screenshotPath && (
        <img
          src={auditFileUrl(auditId, shot.screenshotPath, version)}
          alt={`Screenshot of the page ${shot.urlPath} showing: ${shot.title}`}
          loading="lazy"
          className="mt-2 max-h-72 max-w-full rounded-card border border-rule"
        />
      )}
      <details className="group mt-2 text-sm">
        <summary className={SUMMARY}>Where it was found</summary>
        <WhereFound group={group} />
      </details>
    </li>
  );
}

/** A Website Audit's findings: the title with impact and effort first, where it was found one click away (REQ-014). */
export function FindingsList({ findings, auditId, version }: FindingsListProps) {
  const groups = groupFindings(findings);
  const [showAll, setShowAll] = useState(false);
  const overflow = groups.length > FINDINGS_SHOWN_FIRST;
  const visible = overflow && !showAll ? groups.slice(0, FINDINGS_SHOWN_FIRST) : groups;

  return (
    <section aria-labelledby="audit-findings-title" className="space-y-3">
      <h2 id="audit-findings-title" className="text-xl font-bold">
        Findings
      </h2>
      {findings.length === 0 ? (
        <p className="text-sm text-ink-soft">No findings were recorded.</p>
      ) : (
        <>
          <ol id="audit-findings-items" className="space-y-3">
            {visible.map((group) => (
              <FindingItem key={group[0]!.id} group={group} auditId={auditId} version={version} />
            ))}
          </ol>
          {overflow && (
            // The same button stays in place, so keyboard focus stays on it after it is pressed.
            <button
              type="button"
              className="btn-link"
              aria-expanded={showAll}
              aria-controls="audit-findings-items"
              onClick={() => setShowAll((open) => !open)}
            >
              {showAll ? `Show the first ${FINDINGS_SHOWN_FIRST}` : `Show all ${groups.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
