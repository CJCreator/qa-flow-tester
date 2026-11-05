import { type ReactNode } from 'react';
import { Link } from '../lib/router';
import { FocusHeading, Notice } from './text';

/**
 * The building blocks every screen shares (DESIGN.md, Certificate). One screen = one Page with one PageHeader;
 * the screen's single primary action sits in the header's `actions`, at the end of the content, or in a
 * BottomActionBar.
 */

export type PageWidth = 'prose' | 'form' | 'workspace';

const WIDTHS: Record<PageWidth, string> = {
  prose: 'max-w-prose',
  form: 'max-w-form',
  workspace: 'max-w-workspace',
};

/** The column a screen lives in: one of three widths, the page gutter, and the mount fade. */
export function Page({ width = 'form', children, className = '' }: { width?: PageWidth; children: ReactNode; className?: string }) {
  return (
    <div className={`screen-in mx-auto w-full ${WIDTHS[width]} px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}

/**
 * A screen's title (an h1 that takes focus when the screen appears), an optional line under it, an optional
 * way back, and the screen's actions. On phones the actions sit under the title; from 640px, beside it.
 */
export function PageHeader({
  title,
  lede,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  /** A small line above the title, e.g. the site a screen is about. */
  meta?: ReactNode;
}) {
  return (
    <header className="mb-8 grid gap-4 sm:mb-10">
      {back && (
        <Link to={back.to} className="btn-link -my-2 w-fit text-sm">
          <span aria-hidden="true">←&nbsp;</span>
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid min-w-0 gap-2">
          {meta && <p className="text-sm text-ink-soft">{meta}</p>}
          <FocusHeading className="font-stamp text-3xl font-bold tracking-tight sm:text-4xl">{title}</FocusHeading>
          {lede && <div className="max-w-prose text-lg text-ink-soft">{lede}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled part of a screen. Flat: a heading and its content, with room above. */
export function Section({
  title,
  id,
  description,
  actions,
  children,
  className = '',
}: {
  title: ReactNode;
  id?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`mt-12 first:mt-0 ${className}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 id={headingId} className="text-xl font-bold">
            {title}
          </h2>
          {description && <div className="max-w-prose text-ink-soft">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export type Tone = 'neutral' | 'stamp' | 'pass' | 'warn' | 'fail';

const BADGE: Record<Tone, string> = {
  neutral: 'badge',
  stamp: 'badge-stamp',
  pass: 'badge-pass',
  warn: 'badge-warn',
  fail: 'badge-fail',
};

/** A short status in sentence case. The words carry the meaning; the colour only repeats it. */
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={BADGE[tone]} title={title}>
      {children}
    </span>
  );
}

/**
 * A disclosure: a summary row that opens to more. Closed unless `defaultOpen`. `hint` sits at the end of the
 * summary, e.g. the current values of the options inside.
 */
export function Disclosure({
  summary,
  hint,
  defaultOpen = false,
  children,
  className = '',
}: {
  summary: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`disclosure border-y border-rule ${className}`} open={defaultOpen || undefined}>
      {/* The summary's own children, so a heading passed as `summary` stays a heading (valid in <summary>). */}
      <summary className="flex-wrap py-1">
        {typeof summary === 'string' ? <span>{summary}</span> : summary}
        {hint && <span className="text-sm font-normal text-ink-soft">{hint}</span>}
      </summary>
      <div className="pb-6 pt-2">{children}</div>
    </details>
  );
}

/**
 * The bar for a screen's decision (approve, save): stuck to the bottom of the window, so the primary action
 * is always in reach. `summary` says what the action will do.
 */
export function BottomActionBar({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <div
      className="sticky bottom-0 z-sticky -mx-4 -mb-16 mt-10 border-t border-rule bg-raised/95 px-4 shadow-level-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex flex-col gap-3 pt-3 sm:flex-row sm:items-center sm:justify-between">
        {summary && <div className="min-w-0 text-sm text-ink-soft">{summary}</div>}
        <div className="flex flex-wrap items-center gap-3 sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">{children}</div>
      </div>
    </div>
  );
}

/** Nothing here yet: what will appear, and the action that adds the first one. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-edge bg-surface px-6 py-10 text-center">
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-prose text-ink-soft">{children}</div>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/** Something couldn't be loaded: what happened, and a Retry that asks again. */
export function LoadError({ title, children, onRetry }: { title: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <Notice
      title={title}
      actions={
        onRetry && (
          <button type="button" className="btn-quiet btn-sm" onClick={onRetry}>
            Try again
          </button>
        )
      }
    >
      {children}
    </Notice>
  );
}
