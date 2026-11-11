import React, { useState } from 'react';
import { scrollBehavior } from '../../lib/format';
import { Badge as SharedBadge } from '../ui';

/** An element id for a Plan Item, so the approval summary can point at it. */
export function itemDomId(itemId: string): string {
  return `item-${itemId.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
}

/** Fired when a Plan Item is not on the page yet: the Plan opens every section, then the item is found. */
export const OPEN_ALL_EVENT = 'plan:open-all';

/** Decodes an address hash; null when it is not valid percent-encoding. */
export function safeDecodeHash(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function reveal(el: HTMLElement): void {
  // A collapsed section opens first so the item can be seen.
  let parent = el.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
}

/** Scrolls to a Plan Item. An item inside a closed section or past the first 35 is opened first. */
export function showItem(itemId: string): void {
  const el = document.getElementById(itemDomId(itemId));
  if (el) {
    reveal(el);
    return;
  }
  window.dispatchEvent(new Event(OPEN_ALL_EVENT));
  // Two frames: one for the Plan to open its sections, one for their children to render.
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const later = document.getElementById(itemDomId(itemId));
      if (later) reveal(later);
    })
  );
}

/** The plan's badge: the shared Badge, with the plan's older tone name 'quiet' for neutral. */
export function Badge({
  tone = 'quiet',
  children,
  title,
}: {
  tone?: 'quiet' | 'stamp' | 'pass' | 'warn' | 'fail';
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <SharedBadge tone={tone === 'quiet' ? 'neutral' : tone} title={title}>
      {children}
    </SharedBadge>
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

/** A Plan Item's on/off switch, with a 44px hit area. */
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
    <label className="-m-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-panel">
      <input
        type="checkbox"
        aria-label={label}
        title={on ? 'Included: uncheck to leave it out of the check-up' : 'Left out: check to include it'}
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 cursor-pointer accent-stamp"
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
        className="btn-link text-sm disabled:cursor-not-allowed disabled:text-ink-soft"
        aria-label={label}
      >
        Re-plan with the AI
      </button>
    );
  }
  return (
    <form
      className="mt-2 grid gap-2"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        onReplan(text);
        setOpen(false);
        setText('');
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="font-bold">What should change? (optional)</span>
        <input
          className="field py-2 text-sm"
          placeholder="For example: also try an empty form"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={disabled} className="btn-quiet btn-sm">
          Re-plan
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-link text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
