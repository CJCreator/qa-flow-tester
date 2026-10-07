import React, { useState } from 'react';
import { scrollBehavior } from '../../lib/format';

/** An element id for a Plan Item, so the approval summary can point at it. */
export function itemDomId(itemId: string): string {
  return `item-${itemId.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
}

/** Scrolls to a Plan Item and briefly marks it. */
export function showItem(itemId: string): void {
  const el = document.getElementById(itemDomId(itemId));
  if (!el) return;
  // A collapsed section opens first so the item can be seen.
  let parent = el.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  el.classList.add('ring-2', 'ring-stamp');
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-stamp'), 2500);
}

export function Badge({
  tone = 'quiet',
  children,
  title,
}: {
  tone?: 'quiet' | 'stamp' | 'pass' | 'warn' | 'fail';
  children: React.ReactNode;
  title?: string;
}) {
  const tones = {
    quiet: 'border-rule text-ink-soft',
    stamp: 'border-stamp/50 text-stamp',
    pass: 'border-pass/50 text-pass',
    warn: 'border-warn/50 text-warn',
    fail: 'border-fail/50 text-fail',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Who planned an item, when it wasn't the AI: the person reads it differently. */
export function SourceBadge({ source }: { source?: 'ai' | 'fallback' | 'person' | 'user' }) {
  if (source === 'fallback') {
    return (
      <Badge tone="warn" title="The AI couldn’t plan this, so fixed rules did. Re-plan it with the AI when you like.">
        Fixed rules
      </Badge>
    );
  }
  if (source === 'person' || source === 'user') return <Badge tone="stamp">Yours</Badge>;
  return null;
}

/** A Plan Item's on/off switch, with a hit area of at least 24 px (WCAG 2.5.8). */
export function ItemToggle({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="-m-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-panel">
      <input
        type="checkbox"
        aria-label={label}
        title={on ? 'Included: uncheck to leave it out of the run' : 'Left out: check to include it'}
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 cursor-pointer accent-[#6C9BF2]"
      />
    </label>
  );
}

/** "Re-plan with the AI", with an optional note about what to change. */
export function ReplanControl({
  label,
  disabled,
  onReplan,
}: {
  label: string;
  disabled?: boolean;
  onReplan: (instructions?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="min-h-[32px] text-sm font-bold text-stamp hover:underline disabled:opacity-50"
        aria-label={label}
      >
        Re-plan with the AI
      </button>
    );
  }
  return (
    <form
      className="mt-2 flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        onReplan(text);
        setOpen(false);
        setText('');
      }}
    >
      <input
        className="field flex-1 py-2 text-sm"
        placeholder="What should change? (optional)"
        aria-label={`What should change: ${label}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <button type="submit" disabled={disabled} className="btn-primary min-h-[44px] px-4 text-sm">
        Re-plan
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn-link text-sm">
        Cancel
      </button>
    </form>
  );
}
