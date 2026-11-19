import { AUDIT_API, auditPath, type ImprovePage, type ImproveVariant } from '@qa/types/src/browser.js';
import { Spinner } from '../../../components/text';
import { PATHS } from '../../../lib/router';

/** The label every before/after view carries (ADR 0049): a variant is a suggestion. */
export const SUGGESTION_LABEL = 'Suggestion, not the live site';

/** The widths the variant is shown at: the desktop and the phone layout. */
export const FRAME_WIDTHS = [1440, 375] as const;

/** The stored phone screenshot of a page, as the browser opens it (`AUDIT_API.file`). */
export function screenshotUrl(auditId: string, version: number, path: string): string {
  const base = auditPath(AUDIT_API.file.path, { id: auditId });
  return `${base}?version=${encodeURIComponent(String(version))}&path=${encodeURIComponent(path)}`;
}

/** Where a change marker leads: the finding on the results screen, or nothing for a Section id. */
export function markerHref(auditId: string, version: number, id: string): string | null {
  return /^AF-/.test(id) ? `${PATHS.auditVersion(auditId, version)}#${encodeURIComponent(id)}` : null;
}

export interface BeforeAfterProps {
  auditId: string;
  version: number;
  page: ImprovePage;
  variant: ImproveVariant;
  /** The variant page; null while it loads. */
  html: string | null;
  /** Finding titles by id, for the change list. */
  findingTitles?: Readonly<Record<string, string>>;
}

/**
 * One design variant beside the page it improves: the stored phone screenshot ("before") and the variant
 * framed at 1440 and 375 px ("after"), each change marker linking to its finding. The variant runs in a
 * sandboxed frame with no script, from its own text: nothing is loaded from the site.
 */
export function BeforeAfter({ auditId, version, page, variant, html, findingTitles = {} }: BeforeAfterProps) {
  const cites = variant.cites ?? [];
  const id = `before-after-${variant.page}-${variant.variant}`;
  return (
    <section aria-labelledby={id} className="card-1 bg-surface mt-3 p-4">
      <h3 id={id} className="font-semibold">
        {`Before and after: ${page.urlPath}, variant ${variant.variant} (${variant.style})`}
      </h3>
      <p className="mt-1 text-sm font-semibold text-stamp" data-label="suggestion">
        {SUGGESTION_LABEL}
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        {page.desktopScreenshotPath && (
          <figure className="w-[360px]">
            <img
              src={screenshotUrl(auditId, version, page.desktopScreenshotPath)}
              alt={`Before: the live page ${page.urlPath} at 1440 pixels, when it was audited`}
              className="w-full border border-rule"
            />
            <figcaption className="mt-1 text-sm">Before, 1440 px</figcaption>
          </figure>
        )}
        <figure className="w-[200px]">
          {page.screenshotPath ? (
            <img
              src={screenshotUrl(auditId, version, page.screenshotPath)}
              alt={`Before: the live page ${page.urlPath} on a phone, when it was audited`}
              className="w-full border border-rule"
            />
          ) : (
            <p className="text-sm text-ink-soft">No screenshot of this page was stored.</p>
          )}
          <figcaption className="mt-1 text-sm">Before, phone</figcaption>
        </figure>
        {FRAME_WIDTHS.map((width) => (
          <figure key={width} className="overflow-hidden" style={{ width: width === 1440 ? 360 : 188 }}>
            {html === null ? (
              <Spinner label="Loading the variant…" />
            ) : (
              <div style={{ width: width === 1440 ? 360 : 188, height: 300, overflow: 'hidden' }}>
                <iframe
                  title={`After: variant ${variant.variant} of ${page.urlPath} at ${width} pixels (${SUGGESTION_LABEL})`}
                  srcDoc={html}
                  sandbox=""
                  width={width}
                  height={width === 1440 ? 1200 : 600}
                  style={{ transform: `scale(${width === 1440 ? 0.25 : 0.5})`, transformOrigin: '0 0', border: 0 }}
                />
              </div>
            )}
            <figcaption className="mt-1 text-sm">{`After, ${width} px`}</figcaption>
          </figure>
        ))}
      </div>
      <h4 className="mt-3 text-sm font-semibold">Changes and what they answer</h4>
      {cites.length === 0 ? (
        <p className="text-sm text-ink-soft">This variant names no finding.</p>
      ) : (
        <ul className="mt-1 list-disc pl-5 text-sm">
          {cites.map((cite) => {
            const href = markerHref(auditId, version, cite);
            const title = findingTitles[cite];
            return (
              <li key={cite} data-marker={cite}>
                {href ? (
                  <a href={href} className="btn-link">
                    {title ? `${cite}: ${title}` : cite}
                  </a>
                ) : (
                  `Section ${cite}`
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
