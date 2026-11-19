import { Page, PageHeader } from './ui';
import { Spinner } from './text';

/**
 * Shown on the hosted copy while the Check-up service starts after a quiet spell. It keeps asking in the
 * background (useRunnerConnection), so the page moves on by itself once the service answers.
 */
export function WakingScreen({ state }: { state: 'waking' | 'failed' }) {
  return (
    <Page width="prose">
      <PageHeader
        title="Waking up, this can take up to a minute"
        lede="Release check-up sleeps when nobody is using it, so the first visit after a quiet spell is slow. You do not need to do anything."
      />
      <p role="status" className="text-ink-soft">
        {state === 'waking' ? (
          <Spinner label="Getting Release check-up ready…" />
        ) : (
          'This is taking longer than usual. Keep this page open: it is still trying every few seconds. If nothing happens, try again in a few minutes.'
        )}
      </p>
    </Page>
  );
}
