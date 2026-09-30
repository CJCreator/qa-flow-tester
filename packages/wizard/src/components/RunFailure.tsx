import type { ReactNode } from 'react';
import { Notice } from './text';

/**
 * A scan or test run that stopped: what happened, in plain words, and what to do next. The scan
 * screen and the testing screen both use it.
 */
export function RunFailure({ title, message, actions }: { title: string; message: string; actions: ReactNode }) {
  return (
    <Notice tone="fail" title={title} actions={actions}>
      {message}
    </Notice>
  );
}
