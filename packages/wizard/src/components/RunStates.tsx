import { Link, PATHS } from '../lib/router';
import { Notice } from './text';
import { EmptyState, Page, PageHeader } from './ui';

/**
 * A scan or test run that stopped: what happened, in plain words, and what to do next. The scan
 * screen and the testing screen both use it, so a failure always reads the same way.
 */
export function RunFailure({
  title,
  message,
  planKept,
  onBackToPlan,
}: {
  title: string;
  message: string;
  /** The approved plan is waiting again, so it can be approved again once the site works. */
  planKept?: boolean;
  onBackToPlan?: () => void;
}) {
  return (
    <Notice
      tone="fail"
      title={title}
      actions={
        planKept && onBackToPlan ? (
          <button type="button" className="btn-primary" onClick={onBackToPlan}>
            Back to the plan
          </button>
        ) : (
          <Link to={PATHS.new} className="btn-primary">
            Start a new check-up
          </Link>
        )
      }
    >
      <p>{message}</p>
    </Notice>
  );
}

/** A check-up address opened when no check-up is at that step, e.g. from a bookmark. One next action: start one. */
export function NothingInProgress({ what, reportRunId }: { what: string; reportRunId?: string | null }) {
  return (
    <Page width="prose">
      <PageHeader title={what} />
      <EmptyState
        title="No check-up is at this step right now"
        action={
          <Link to={PATHS.new} className="btn-primary">
            Start a new check-up
          </Link>
        }
      >
        <p>
          {reportRunId ? (
            <>
              <Link to={PATHS.report(reportRunId)} className="btn-link">
                Open the last report
              </Link>{' '}
              or see{' '}
            </>
          ) : (
            'See '
          )}
          <Link to={PATHS.reports} className="btn-link">
            {reportRunId ? 'past check-ups' : 'Past check-ups'}
          </Link>
          .
        </p>
      </EmptyState>
    </Page>
  );
}
