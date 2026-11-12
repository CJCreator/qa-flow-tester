/** Sent on `window` when a Google sign-in for a Helper or owner starts or ends: App reads the runner status again. */
export const SESSION_CHANGED_EVENT = 'qa:session-changed';

/** Tells the page that the sign-in changed. Does nothing where there is no window (tests, server rendering). */
export function announceSessionChange(
  target: Pick<EventTarget, 'dispatchEvent'> | undefined = typeof window === 'undefined' ? undefined : window
): void {
  target?.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}
