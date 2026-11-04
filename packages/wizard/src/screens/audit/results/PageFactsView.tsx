import type {
  AuditMarketing,
  AuditPage,
  ExternalSpeed,
  PageSpeed,
  PhoneLayout,
  TechnologyResult,
} from '@qa/types/src/browser.js';
import { auditFileUrl } from './analysis-client';
import {
  SPEED_LIMITS,
  SPEED_METRIC_LABEL,
  SPEED_NOT_MEASURED_TEXT,
  speedMethodText,
  speedValueText,
  ACCESSIBILITY_NOTE,
  ACCESSIBILITY_STANDARD,
  NONE,
  NOT_IDENTIFIED,
  NOT_SET,
  SIGNAL_STATUS_LABEL,
  TECHNOLOGY_KIND_LABEL,
  declaredLanguageText,
  foundText,
  otherLanguagesText,
  primaryLanguageText,
} from './analysis-text';

type MarketingSignal = AuditMarketing['signals'][number];

export interface PageFactsViewProps {
  /** The page whose language, SEO basics and accessibility basics are shown. */
  page: AuditPage;
  /** What the whole site is built with. */
  technology: TechnologyResult;
  /** The ten marketing signals of the whole site, in report order. */
  signals: MarketingSignal[];
  /** With the version, lets the phone screenshot load through the file endpoint. Without an id it is left out. */
  auditId?: string;
  version?: number;
}

function SpeedResult({ title, speed }: { title: string; speed: ExternalSpeed }) {
  return (
    <div className="space-y-1">
      <h4 className="font-bold">{title}</h4>
      <p className="text-sm text-ink-soft">{speedMethodText(speed)}</p>
      {speed.status === 'measured' ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {speed.values.map((value) => (
              <div key={value.metric} className="contents">
                <dt className="font-bold">{SPEED_METRIC_LABEL[value.metric]}</dt>
                <dd>{speedValueText(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-ink-soft">{`Measured ${speed.measuredAt}.`}</p>
        </>
      ) : (
        <p className="text-sm">{`Not measured: ${SPEED_NOT_MEASURED_TEXT[speed.reason]}.`}</p>
      )}
    </div>
  );
}

function SpeedFacts({ speed }: { speed: PageSpeed }) {
  return (
    <>
      <h3 className="text-lg font-bold">Speed (PageSpeed Insights)</h3>
      <SpeedResult title="Lab test" speed={speed.lab} />
      <SpeedResult title="Real visitors" speed={speed.field} />
      <p className="text-xs text-ink-soft">{SPEED_LIMITS}</p>
    </>
  );
}

function PhoneFacts({
  page,
  phone,
  auditId,
  version,
}: {
  page: AuditPage;
  phone: PhoneLayout;
  auditId?: string;
  version?: number;
}) {
  const overflow =
    phone.overflow === null
      ? 'Not checked'
      : phone.overflow
        ? 'The page is wider than the screen'
        : 'The page fits the screen width';
  return (
    <>
      <h3 className="text-lg font-bold">Phone layout</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-bold">Screen width tested</dt>
        <dd>{`${phone.widthPx} px`}</dd>
        <dt className="font-bold">Width check</dt>
        <dd>{overflow}</dd>
      </dl>
      {phone.screenshotPath === null ? (
        <p className="text-sm text-ink-soft">No screenshot was taken.</p>
      ) : (
        auditId && (
          <img
            loading="lazy"
            src={auditFileUrl(auditId, phone.screenshotPath, version)}
            alt={`${page.urlPath} at ${phone.widthPx} px wide, as a phone shows it`}
            className="max-h-96 rounded border border-rule"
          />
        )
      )}
    </>
  );
}

function NapList({ signal }: { signal: MarketingSignal }) {
  if (!signal.nap || signal.nap.length === 0) return null;
  return (
    <ul className="mt-1 text-xs">
      {signal.nap.map((nap, i) => (
        <li key={`${nap.urlPath}-${i}`}>
          {`Name: ${nap.name ?? 'Not shown'} · Address: ${nap.address ?? 'Not shown'} · Phone: ${nap.phone ?? 'Not shown'} (on ${nap.urlPath})`}
        </li>
      ))}
    </ul>
  );
}

/** One page's facts and the site's technology and marketing signals (REQ-010, REQ-013, REQ-015, REQ-038). */
export function PageFactsView({ page, technology, signals, auditId, version }: PageFactsViewProps) {
  const { seo, accessibility } = page;
  return (
    <section aria-labelledby="page-facts-title" className="space-y-4">
      <h2 id="page-facts-title" className="text-xl font-bold">
        Page facts <span className="break-all text-base font-normal text-ink-soft">{page.urlPath}</span>
      </h2>
      <p className="text-sm text-ink-soft">
        {page.coverage === 'sample'
          ? 'Sample Page: checked itself.'
          : page.sampleUrlPath
            ? `Shares its layout with the Sample Page ${page.sampleUrlPath}, which was checked for it.`
            : 'Shares its layout with a Sample Page, which was checked for it.'}
      </p>

      {page.speed && <SpeedFacts speed={page.speed} />}
      {page.phone && <PhoneFacts page={page} phone={page.phone} auditId={auditId} version={version} />}

      <h3 className="text-lg font-bold">Language</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-bold">Detected language</dt>
        <dd>{primaryLanguageText(page.language)}</dd>
        <dt className="font-bold">Other languages</dt>
        <dd>{otherLanguagesText(page.language)}</dd>
        <dt className="font-bold">lang attribute</dt>
        <dd>{declaredLanguageText(page.language)}</dd>
      </dl>

      <h3 className="text-lg font-bold">SEO basics</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-bold">Title</dt>
        <dd>{foundText(seo.hasTitle)}</dd>
        <dt className="font-bold">Description</dt>
        <dd>{foundText(seo.hasDescription)}</dd>
        <dt className="font-bold">H1 headings</dt>
        <dd>{seo.h1Count}</dd>
        <dt className="font-bold">Heading levels</dt>
        <dd>{seo.skippedHeadingLevel ? 'A level is skipped' : 'No level is skipped'}</dd>
        <dt className="font-bold">Images without alt text</dt>
        <dd>{seo.imagesWithoutAlt}</dd>
        <dt className="font-bold">lang attribute</dt>
        <dd>{seo.htmlLang ?? NOT_SET}</dd>
      </dl>

      <h3 className="text-lg font-bold">Accessibility basics</h3>
      {accessibility ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-bold">Standard</dt>
          <dd>{ACCESSIBILITY_STANDARD}</dd>
          <dt className="font-bold">Violations found</dt>
          <dd>{accessibility.violations}</dd>
          <dt className="sr-only">Note</dt>
          <dd className="col-span-2 text-ink-soft">{ACCESSIBILITY_NOTE}</dd>
        </dl>
      ) : (
        <p className="text-sm text-ink-soft">
          {`Not checked on this page: ${ACCESSIBILITY_STANDARD}, made on Sample Pages only.`}
        </p>
      )}

      <h3 className="text-lg font-bold">Technology (whole site)</h3>
      {technology.status === 'not-identified' || technology.technologies.length === 0 ? (
        <p className="text-sm">{NOT_IDENTIFIED}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {technology.technologies.map((tech) => (
            <li key={tech.name}>
              <span className="font-bold">{tech.name}</span>
              {` · ${TECHNOLOGY_KIND_LABEL[tech.kind]}`}
              {tech.evidence.length > 0 && (
                <span className="text-ink-soft">{` · shown by ${tech.evidence.join(', ')}`}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-lg font-bold">Marketing signals (whole site)</h3>
      {signals.length === 0 ? (
        <p className="text-sm text-ink-soft">Not checked</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col">Status</th>
                <th scope="col">Pages</th>
                <th scope="col">What was seen</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((signal) => (
                <tr key={signal.key}>
                  <th scope="row" className="font-bold">
                    {signal.label}
                  </th>
                  <td>{SIGNAL_STATUS_LABEL[signal.status]}</td>
                  <td className="break-all">{signal.pages.length === 0 ? NONE : signal.pages.join(', ')}</td>
                  <td>
                    {signal.detail}
                    <NapList signal={signal} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
