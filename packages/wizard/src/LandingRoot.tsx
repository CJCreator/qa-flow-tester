import { matchRoute } from './lib/router';
import { GetStartedScreen } from './screens/GetStartedScreen';
import { LandingScreen } from './screens/LandingScreen';

/** The landing page (or the get-started page) on its own, without the app around it. */
export default function LandingRoot() {
  if (matchRoute(window.location.pathname).name === 'get-started') return <GetStartedScreen />;
  return (
    <div className="min-h-screen bg-paper text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-dialog focus:inline-flex focus:min-h-[44px] focus:items-center rounded-control bg-stamp px-4 py-2 font-bold text-on-stamp"
      >
        Skip to the content
      </a>
      {/* The landing page brings its own header, main and footer landmarks. */}
      <LandingScreen />
    </div>
  );
}
