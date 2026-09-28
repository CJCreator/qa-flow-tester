import { useState } from 'react';
import type { ReleaseReport } from '@qa/types';
import { downloadReportFiles, RunnerError } from '../api';
import { ErrorMessage, FocusHeading, Spinner } from '../components/Shell';
import { summarizeReport } from '../lib/summary';
import { displayHost } from '../lib/url';

const SEVERITY_TONE: Record<string, string> = {
  Blocker: 'text-fail',
  Major: 'text-fail',
  Minor: 'text-warn',
  Suggestion: 'text-ink-soft',
};

export function ReportScreen({
  report,
  checkedUrl,
  onCheckAnother,
}: {
  report: ReleaseReport;
  /** The address as the person typed it (the runner may have rewritten localhost when running in Docker). */
  checkedUrl?: string;
  onCheckAnother: () => void;
}) {
  const summary = summarizeReport(report);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadReportFiles();
    } catch (err) {
      setDownloadError(err instanceof RunnerError ? err.message : 'The report files couldn’t be downloaded. Try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section>
      <div className="mb-10 flex flex-col-reverse gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-prose">
          <p className="mb-2 text-ink-soft">Report for {displayHost(checkedUrl ?? report.targetUrl)}</p>
          <FocusHeading className="text-question font-bold">{summary.headline}</FocusHeading>
        </div>
        <div
          aria-hidden="true"
          className={
            'stamp shrink-0 self-start rounded-md border-[5px] border-double px-5 py-3 font-stamp text-4xl font-extrabold uppercase leading-none tracking-wide ' +
            (summary.ready ? 'border-pass text-pass' : 'border-fail text-fail')
          }
        >
          {summary.stamp}
        </div>
      </div>
      <p className="sr-only">Verdict: {summary.stamp}.</p>

      {summary.readOnly && (
        <p className="mb-8 max-w-prose rounded-md border-l-4 border-stamp bg-stamp-tint px-4 py-3">
          <strong>This was a read-only scan.</strong> The site was only looked at: nothing was signed into, submitted or changed.
          Anything behind a sign-in or a form wasn’t tested, so this isn’t a full check of the product.
        </p>
      )}

      {summary.toConfirm > 0 && (
        <p className="mb-8 max-w-prose rounded-md border-l-4 border-stamp bg-stamp-tint px-4 py-3">
          <strong>
            {summary.toConfirm} {summary.toConfirm === 1 ? 'check needs' : 'checks need'} your confirmation.
          </strong>{' '}
          The AI guessed how {summary.toConfirm === 1 ? 'it' : 'they'} should work and the site did something else. These
          aren’t counted as issues. The full report says what to confirm.
        </p>
      )}

      {summary.total > 0 && (
        <div className="grid max-w-4xl gap-10 md:grid-cols-[14rem_1fr]">
          <div>
            <h2 className="mb-3 font-bold">How serious</h2>
            <ul className="space-y-1">
              {summary.counts.map((c) => (
                <li key={c.severity} className={'font-bold ' + SEVERITY_TONE[c.severity]}>
                  {c.sentence}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-3 font-bold">{summary.total > summary.top.length ? 'The most important ones' : 'What was found'}</h2>
            <ol className="space-y-4">
              {summary.top.map((issue, i) => (
                <li key={i} className="border-l-4 border-rule pl-4">
                  <p className="font-bold">{issue.title}</p>
                  <p className="text-ink-soft">{issue.category}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <div className="mt-12 max-w-prose">
        <p className="mb-4 text-ink-soft">
          The full report lists every issue, where it happened and how to reproduce it. Pass it on to whoever builds the site.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" className="btn-primary" onClick={download} disabled={downloading}>
            {downloading ? <Spinner label="Downloading…" /> : 'Download the full report'}
          </button>
          <button type="button" className="btn-quiet" onClick={onCheckAnother}>
            Check something else
          </button>
        </div>
        {downloadError && <ErrorMessage>{downloadError}</ErrorMessage>}
      </div>
    </section>
  );
}
