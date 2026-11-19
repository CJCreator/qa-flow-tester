import type { ReactNode } from 'react';

/**
 * The reason line for a disabled button (gap W20).
 *
 * Every disabled `<button>` points its `aria-describedby` at one of these, so the person
 * (and a screen reader) is told why it is off. Visible text only: nothing here is hidden.
 *
 * - A missing input or setup: `<DisabledReason id="x-reason" when={off}>Enter the address first</DisabledReason>`
 *   with `aria-describedby={reasonId('x-reason', off)}` on the button.
 * - A busy state: one shared "Working…" line per screen, see `WorkingLine`.
 */

/** The id of the shared "Working…" line. Mount one `WorkingLine` per screen. */
export const WORKING_ID = 'working-reason';

/** The id to put in `aria-describedby`, or undefined while the button is enabled. */
export function reasonId(id: string, off: boolean): string | undefined {
  return off ? id : undefined;
}

/** `aria-describedby` for a button that is disabled only while the screen is busy. */
export function workingId(busy: boolean, id: string = WORKING_ID): string | undefined {
  return busy ? id : undefined;
}

export function DisabledReason({
  id,
  when = true,
  className,
  children,
}: {
  id: string;
  /** Render the line only while the button is off. */
  when?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!when) return null;
  return (
    <p id={id} className={className ?? 'text-sm text-ink-soft'}>
      {children}
    </p>
  );
}

/**
 * The one shared busy line. It sits in a live region that is always mounted, so the
 * "Working…" text is announced when it appears. Buttons that are off only because the
 * screen is busy use `aria-describedby={workingId(busy)}`.
 */
/** Pass `id` when one screen has several busy lines at once (for example one per list row). */
export function WorkingLine({ busy, className, id = WORKING_ID }: { busy: boolean; className?: string; id?: string }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      {busy && (
        <p id={id} className="text-sm text-ink-soft">
          Working…
        </p>
      )}
    </div>
  );
}
