import { Question } from '../components/text';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';

export function NotFoundScreen() {
  useDocumentTitle('Page not found');
  return (
    <div className="mx-auto max-w-prose px-4 py-12 sm:px-6">
      <Question>Page not found</Question>
      <p className="mb-6 text-ink-soft">
        There’s nothing at this address. It may be an old link, or it was typed with a mistake.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link to={PATHS.new} className="btn-primary">
          Start a new check-up
        </Link>
        <Link to={PATHS.reports} className="btn-quiet">
          Past check-ups
        </Link>
      </div>
    </div>
  );
}
