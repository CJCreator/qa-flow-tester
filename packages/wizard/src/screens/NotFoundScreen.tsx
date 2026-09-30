import { Lead, Question } from '../components/text';
import { Link, PATHS, useTitle } from '../lib/router';

export function NotFoundScreen() {
  useTitle('Page not found');
  return (
    <div className="mx-auto w-full max-w-[680px] px-4 py-10 sm:px-6 sm:py-14">
      <Question>Page not found</Question>
      <Lead>There’s nothing at this address. It may be an old link, or it was typed with a mistake.</Lead>
      <div className="flex flex-wrap gap-4">
        <Link to={PATHS.new} className="btn-primary px-5">
          Start a new check-up
        </Link>
        <Link to={PATHS.reports} className="btn-quiet px-5">
          See past check-ups
        </Link>
      </div>
    </div>
  );
}
