import { useEffect, useRef, type ReactNode } from 'react';

/** Large question heading used at the top of a step. Focused on mount so screen readers announce the new screen. */
export function Question({ children }: { children: ReactNode }) {
  return <FocusHeading className="mb-4 max-w-prose text-question font-bold">{children}</FocusHeading>;
}

/** An h1 that takes focus once when its screen appears, so keyboard and screen-reader users land on the new screen. */
export function FocusHeading({ children, className }: { children: ReactNode; className: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={`${className} outline-none`}>
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mb-8 max-w-prose text-ink-soft">{children}</p>;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-4 max-w-prose rounded-md border-l-4 border-fail bg-fail-tint px-4 py-3 text-fail">
      {children}
    </p>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <svg aria-hidden="true" className="h-5 w-5 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

/** A banner that says what happened and what to do next. `tone` fail for errors, warn for cautions, stamp for news. */
export function Notice({
  tone = 'fail',
  title,
  children,
  actions,
}: {
  tone?: 'fail' | 'warn' | 'stamp' | 'pass';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const tones = {
    fail: 'border-fail bg-fail-tint text-fail',
    warn: 'border-warn bg-warn-tint text-warn',
    stamp: 'border-stamp bg-stamp-tint text-stamp',
    pass: 'border-pass bg-pass-tint text-pass',
  };
  return (
    <div role={tone === 'fail' ? 'alert' : 'status'} className={`rounded-md border-l-4 px-4 py-3 ${tones[tone]}`}>
      <p className="font-bold">{title}</p>
      {children && <div className="mt-1 text-sm text-ink">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
