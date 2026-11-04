import type { AuditResult, RoadmapItem } from '@qa/types/src/browser.js';
import { count } from '../../../lib/format';
import { SCALE_LABEL } from './analysis-text';

const CHIP = 'inline-flex rounded-full bg-panel px-2 py-0.5 text-xs font-semibold text-ink';

/** The Improvement Roadmap: items grouped by phase, phase 1 first. Each item says which findings it covers. */
export function RoadmapView({ roadmap }: { roadmap: RoadmapItem[] }) {
  const phases = [...new Set(roadmap.map((item) => item.phase))].sort((a, b) => a - b);
  return (
    <section aria-labelledby="audit-roadmap-title" className="space-y-3">
      <h2 id="audit-roadmap-title" className="text-xl font-bold">
        Improvement Roadmap
      </h2>
      {roadmap.length === 0 ? (
        <p className="text-sm text-ink-soft">No Improvement Roadmap items were made.</p>
      ) : (
        phases.map((phase) => (
          <div key={phase} className="space-y-2">
            <h3 className="font-bold">{`Phase ${phase}`}</h3>
            <ul className="space-y-2">
              {roadmap
                .filter((item) => item.phase === phase)
                .map((item) => (
                  <li key={item.id} className="card-1 bg-surface p-4" data-roadmap-id={item.id}>
                    <p className="font-bold">{item.title}</p>
                    <p className="mt-1 flex flex-wrap gap-2">
                      <span className={CHIP}>{`Priority: ${SCALE_LABEL[item.priority]}`}</span>
                      <span className={CHIP}>{`Effort: ${SCALE_LABEL[item.effort]}`}</span>
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {`Covers ${count(item.findingIds.length, 'finding', 'findings')} on ${count(item.pages.length, 'page', 'pages')}`}
                    </p>
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** Pages no recorded page links to, and how many recorded pages link to each page. */
export function InternalLinkingView({ linking }: { linking: AuditResult['internalLinking'] | undefined }) {
  const unlinked = linking?.unlinkedPages ?? [];
  const inbound = Object.entries(linking?.inboundCounts ?? {});
  return (
    <section aria-labelledby="audit-linking-title" className="space-y-3">
      <h2 id="audit-linking-title" className="text-xl font-bold">
        Internal linking
      </h2>
      <p className="text-sm text-ink-soft">Counted from the links found on the recorded pages.</p>
      {unlinked.length === 0 ? (
        <p className="text-sm">No recorded page was left without a link to it.</p>
      ) : (
        <>
          <p className="text-sm">{`${count(unlinked.length, 'page has', 'pages have')} no link to it from another recorded page:`}</p>
          <ul className="text-sm">
            {unlinked.map((path) => (
              <li key={path} className="break-all font-mono">
                {path}
              </li>
            ))}
          </ul>
        </>
      )}
      {inbound.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Links to it</th>
              </tr>
            </thead>
            <tbody>
              {inbound.map(([path, links]) => (
                <tr key={path}>
                  <th scope="row" className="break-all font-mono font-normal">
                    {path}
                  </th>
                  <td>{links}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Links on the audited pages that go to other websites. They were not followed. */
export function LeavingSiteView({ links }: { links: AuditResult['leavingSite'] }) {
  return (
    <section aria-labelledby="audit-leaving-title" className="space-y-3">
      <h2 id="audit-leaving-title" className="text-xl font-bold">
        Links that leave the website
      </h2>
      {links.length === 0 ? (
        <p className="text-sm text-ink-soft">No links to other websites were found.</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">These links go to other websites and were not checked.</p>
          <ul className="space-y-1 text-sm">
            {links.map((link) => (
              <li key={link.to}>
                <span className="break-all font-mono">{link.to}</span>
                {` · on ${link.from.join(', ')}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
