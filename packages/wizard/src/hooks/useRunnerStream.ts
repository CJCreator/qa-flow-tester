import { useEffect, useRef, useState } from 'react';
import type { RunnerEvent } from '../lib/translate';

export type StreamConnection = 'connecting' | 'open' | 'reconnecting';

/** Waits before the 1st, 2nd and 3rd reconnect attempts in a row; every later attempt waits the last value. */
const RECONNECT_DELAYS_MS = [2000, 4000, 8000, 30000];

/** The wait before reconnect attempt `attempt` (0 for the first), counting failed attempts since the last open. */
export function reconnectDelayMs(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
}

/**
 * Keeps one EventSource open to the runner while `enabled`, reconnecting after drops with a growing
 * wait (2 s, 4 s, 8 s, then 30 s). After a reconnect, `onReconnected` fires so the caller can catch
 * up on anything it missed.
 */
export function useRunnerStream(
  url: string,
  enabled: boolean,
  onEvent: (event: RunnerEvent) => void,
  onReconnected: () => void
): StreamConnection {
  const [connection, setConnection] = useState<StreamConnection>('connecting');
  const handlers = useRef({ onEvent, onReconnected });
  handlers.current = { onEvent, onReconnected };

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let dropped = false;
    let attempt = 0;
    let opened = false;

    const connect = () => {
      // After the first open, a reconnect asks for the snapshot only (no replay of the run's events).
      source = new EventSource(opened ? `${url}?reconnect=1` : url);
      source.onmessage = (message) => {
        let event: RunnerEvent;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        if (event.type === 'connected') {
          attempt = 0;
          opened = true;
          setConnection('open');
          if (dropped) {
            dropped = false;
            handlers.current.onReconnected();
          }
        }
        handlers.current.onEvent(event);
      };
      source.onerror = () => {
        source?.close();
        if (disposed) return;
        dropped = true;
        setConnection('reconnecting');
        retry = setTimeout(connect, reconnectDelayMs(attempt++));
      };
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      clearTimeout(retry);
    };
  }, [url, enabled]);

  return connection;
}
