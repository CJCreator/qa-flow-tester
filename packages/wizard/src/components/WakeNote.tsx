import type { WakeState } from '../hooks/useWakeOnline';
import { Spinner } from './text';

/** Says whether the free online copy is awake yet. Nothing shows when there is nothing to wake. */
export function WakeNote({ state }: { state: WakeState }) {
  if (state === 'none') return null;
  return (
    <p role="status" className="mt-3 text-sm text-ink-soft">
      {state === 'waking' && <Spinner label="Getting the free online copy ready. It sleeps when idle." />}
      {state === 'ready' && (
        <span>
          <span className="font-bold text-pass">✓</span> The online copy is awake and ready.
        </span>
      )}
      {state === 'failed' && 'The online copy is slow to wake. It can take about a minute after you click.'}
    </p>
  );
}
