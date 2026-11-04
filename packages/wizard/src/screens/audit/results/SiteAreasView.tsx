import type { AreaAssessment } from '@qa/types/src/browser.js';
import { gradeClasses } from '../../../lib/grades';
import { AI_ADVISORY_CHIP, AREA_LABEL, GRADE_BASIS, NOT_DONE_REASON_TEXT, NO_GRADE } from './analysis-text';

/** One card per area of the whole site: the grade from automatic checks, and the AI's advisory note or why there is none. */
export function SiteAreasView({ areas }: { areas: AreaAssessment[] }) {
  return (
    <section aria-labelledby="audit-areas-title" className="space-y-3">
      <h2 id="audit-areas-title" className="text-xl font-bold">
        Site areas
      </h2>
      {areas.length === 0 ? (
        <p className="text-sm text-ink-soft">No areas were assessed.</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">{GRADE_BASIS}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {areas.map((area) => (
              <li key={area.area} className="card-1 bg-surface p-4" data-area={area.area}>
                <h3 className="font-bold">{AREA_LABEL[area.area]}</h3>
                {area.grade === null ? (
                  <p className="mt-1 text-sm text-ink-soft">{NO_GRADE}</p>
                ) : (
                  <p className={`mt-1 inline-flex rounded border px-2 text-sm font-bold ${gradeClasses(area.grade)}`}>
                    {`Grade ${area.grade}`}
                  </p>
                )}
                {area.status === 'done' ? (
                  <div className="mt-2 text-sm">
                    <span className="inline-flex rounded-full bg-stamp-tint px-2 py-0.5 text-xs font-semibold text-stamp">
                      {AI_ADVISORY_CHIP}
                    </span>
                    <p className="mt-1">{area.note}</p>
                    {area.evidence.length > 0 && (
                      <p className="mt-1 text-xs text-ink-soft">{`Based on findings ${area.evidence.join(', ')}`}</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-ink-soft">{NOT_DONE_REASON_TEXT[area.reason]}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
