import { useEffect, useRef, useState } from 'react';
import type { RunnerEvent } from '../lib/translate';

export type StreamConnection = 'connecting' | 'open' | 'reconnecting';

const RECONNECT_DELAY_MS = 3000;

/**
 * The URL for a reconnect. A browser EventSource cannot set a Last-Event-ID header itself, so the id goes in
 * `lastEventId`; the runner reads either (LAT-10).
 */
export function resumeUrl(url: string, lastEventId: number | null): string {
  if (lastEventId === null) return url;
  return `${url}${url.includes('?') ? '&' : '?'}lastEventId=${lastEventId}`;
}

/**
 * Whether a `connected` event means the page must drop its feed. A fresh or non-resumable connection gets the whole
 * retained log again, so the feed is rebuilt from it; a resumed one carries only the gap, so the feed is kept.
 */
export function shouldResetFeed(event: Record<string, unknown>): boolean {
  return event.resumed !== true;
}

/**
 * Keeps one EventSource open to the runner while `enabled`, reconnecting after drops.
 * After a reconnect, `onReconnected` fires so the caller can catch up on anything it missed. The reconnect
 * asks only for the events after the last id seen (LAT-10).
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
    /** The newest event id this page has seen, kept across reconnects. */
    let lastId: number | null = null;

    const connect = () => {
      source = new EventSource(resumeUrl(url, lastId));
      source.onmessage = (message) => {
        if (message.lastEventId && /^\d+$/.test(message.lastEventId)) lastId = Number(message.lastEventId);
        let event: RunnerEvent;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        if (event.type === 'connected') {
          // A runner that restarted numbers its events again from 1: the page follows it down.
          if (typeof event.head === 'number' && lastId !== null && event.head < lastId) lastId = event.head;
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
        retry = setTimeout(connect, RECONNECT_DELAY_MS);
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
