import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Notice } from './text';

/** What a person sees when a page could not be drawn: what happened and the one thing to do. */
export function PageError() {
  return (
    <div className="mx-auto max-w-prose px-4 py-16 sm:px-6">
      <Notice
        title="This page couldn’t be shown"
        actions={
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        }
      >
        Something on this page went wrong. Reloading usually fixes it. If it happens again, open Release check-up from
        its home page.
      </Notice>
    </div>
  );
}

interface Props {
  children: ReactNode;
  /** When this changes (the address), a page that failed is tried again. */
  resetKey?: string;
}
interface State {
  error: unknown;
  key: string | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown render error') };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('A page could not be shown', error, info.componentStack);
  }

  render() {
    return this.state.error ? <PageError /> : this.props.children;
  }
}
