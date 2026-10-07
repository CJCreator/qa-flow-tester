import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  /** What will happen, including what will be lost. */
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** The confirm button is red: something is thrown away. */
  danger?: boolean;
  /** A second way to go ahead, e.g. "Stop and keep the plan" beside "Stop and make a report". */
  altLabel?: string;
  /** The second way throws something away: its button is red. */
  altDanger?: boolean;
}

/** What the person chose: the main action, the second one, or neither. */
export type Choice = 'confirm' | 'alt' | 'cancel';

/**
 * Asks before anything is stopped or thrown away. A native modal dialog: focus moves into it and
 * stays there, and Escape cancels.
 */
function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (choice: Choice) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // The safe choice has focus, so Enter on its own never throws anything away.
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose('cancel');
      }}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border-2 border-edge bg-surface p-0 text-ink shadow-2xl backdrop:bg-canvas/80"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="text-xl font-bold">
          {options.title}
        </h2>
        <div className="mt-3 text-ink-soft">{options.body}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button ref={cancelRef} type="button" className="btn-quiet" onClick={() => onClose('cancel')}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          {options.altLabel && (
            <button
              type="button"
              className={options.altDanger ? 'btn bg-fail text-surface hover:opacity-90' : 'btn-quiet'}
              onClick={() => onClose('alt')}
            >
              {options.altLabel}
            </button>
          )}
          <button
            type="button"
            className={options.danger ? 'btn bg-fail text-surface hover:opacity-90' : 'btn-primary'}
            onClick={() => onClose('confirm')}
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * `confirm(options)` shows the dialog and resolves true when the person confirms. Render `dialog`
 * once, anywhere in the screen.
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Like confirm, with `altLabel` for a second way to go ahead. */
  choose: (options: ConfirmOptions) => Promise<Choice>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (choice: Choice) => void } | null>(null);
  const choose = useCallback(
    (options: ConfirmOptions) => new Promise<Choice>((resolve) => setPending({ options, resolve })),
    []
  );
  const confirm = useCallback(async (options: ConfirmOptions) => (await choose(options)) === 'confirm', [choose]);
  const dialog = pending ? (
    <ConfirmDialog
      options={pending.options}
      onClose={(choice) => {
        pending.resolve(choice);
        setPending(null);
      }}
    />
  ) : null;
  return { confirm, choose, dialog };
}
