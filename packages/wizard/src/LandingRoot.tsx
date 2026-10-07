import { LandingScreen } from './screens/LandingScreen';

/** The landing page on its own, without the app around it. */
export default function LandingRoot() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-[60] focus:inline-flex focus:min-h-[44px] focus:items-center rounded bg-stamp px-4 py-2 font-bold text-surface"
      >
        Skip to the content
      </a>
      <main id="main">
        <LandingScreen />
      </main>
    </div>
  );
}
