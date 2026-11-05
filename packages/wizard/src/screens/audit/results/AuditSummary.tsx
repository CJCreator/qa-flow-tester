import type { AuditResult, AuditScale } from '@qa/types/src/browser.js';
import { AUDIT_SCALE } from '@qa/types/src/browser.js';
import { Notice } from '../../../components/text';
import { count } from '../../../lib/format';
import { Link, PATHS } from '../../../lib/router';
import { SCALE_LABEL, fixFirst, isAiNote } from './analysis-text';

/** What was recorded and found, in numbers that say how they were counted. No verdict on the whole site (ADR 0033). */
export function AuditSummary({ result }: { result: AuditResult }) {
  const { coverage, findings } = result;
  const byImpact = (scale: AuditScale) => findings.filter((f) => f.impact === scale).length;
  const first = fixFirst(findings);
  return (
    <section aria-labelledby="audit-summary-title" className="space-y-4">
      <h2 id="audit-summary-title" className="text-xl font-bold">
        Summary
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card-1 bg-surface p-4">
          <h3 className="font-bold">Pages</h3>
          <p className="mt-1 text-sm">{`${count(coverage.reached, 'page', 'pages')} recorded`}</p>
          <p className="text-sm">{`${count(coverage.skipped.length, 'page', 'pages')} skipped, not checked`}</p>
          <p className="mt-1 text-xs text-ink-soft">{`Counted from the ${coverage.found} found when the Website Audit followed links from the start address.`}</p>
        </div>
        <div className="card-1 bg-surface p-4">
          <h3 className="font-bold">Findings by impact</h3>
          <ul className="mt-1 text-sm">
            {AUDIT_SCALE.map((scale) => (
              <li key={scale}>{`${SCALE_LABEL[scale]}: ${byImpact(scale)}`}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-soft">
            Counted from the findings below. It is a count of what was found, not a grade for the website.
          </p>
        </div>
      </div>
      <div>
        <h3 className="font-bold">Fix first</h3>
        {first.length === 0 ? (
          <p className="text-sm text-ink-soft">No findings were recorded, so there is nothing to fix first.</p>
        ) : (
          <>
            <p className="text-sm text-ink-soft">Highest impact first, then the least effort.</p>
            <ol className="mt-2 space-y-2" aria-label="Fix first">
              {first.map((finding) => (
                <li key={finding.id} className="card-1 bg-surface px-4 py-2 text-sm" data-fix-first={finding.id}>
                  <span className="font-bold">{finding.title}</span>
                  <span className="text-ink-soft">{` · Impact: ${SCALE_LABEL[finding.impact]} · Effort: ${SCALE_LABEL[finding.effort]} · `}</span>
                  <span className="break-all font-mono text-xs">{finding.urlPath}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

/** The plain sentences the tool left for its user, such as "AI notes need an AI key", with the way to fix it. */
export function NotesBanner({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  // Any note about AI links to Audit settings (T-88).
  const aboutAi = notes.some(isAiNote);
  return (
    <Notice
      tone="warn"
      title="Notes about this Website Audit"
      actions={
        aboutAi && (
          <Link to={PATHS.auditSettings} className="btn-link">
            Audit settings
          </Link>
        )
      }
    >
      <ul className="list-disc pl-5">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </Notice>
  );
}
