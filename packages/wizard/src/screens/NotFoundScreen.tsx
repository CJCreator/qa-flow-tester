import { EmptyState, Page, PageHeader } from '../components/ui';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';

/** An address the app doesn't know. The shared (beta) copy has no Website Audits, so no link to them. */
export function NotFoundScreen({ beta = false }: { beta?: boolean }) {
  useDocumentTitle('Page not found');
  return (
    <Page width="prose">
      <PageHeader title="Page not found" />
      <EmptyState
        title="There’s nothing at this address"
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link to={PATHS.new} className="btn-primary">
              New check-up
            </Link>
            <Link to={PATHS.reports} className="btn-quiet">
              Past check-ups
            </Link>
            {!beta && (
              <Link to={PATHS.audits} className="btn-quiet">
                Website Audits
              </Link>
            )}
          </div>
        }
      >
        It may be an old link, or the address was typed with a mistake.
      </EmptyState>
    </Page>
  );
}
