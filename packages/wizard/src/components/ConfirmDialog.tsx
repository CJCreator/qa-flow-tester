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
    // Focus goes back to what opened the dialog when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // The safe choice has focus, so Enter on its own never throws anything away.
    cancelRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const cancelButton = (
    <button ref={cancelRef} type="button" className="btn-quiet" onClick={() => onClose('cancel')}>
      {options.cancelLabel ?? 'Cancel'}
    </button>
  );
  const confirmButton = (
    <button type="button" className={options.danger ? 'btn-danger' : 'btn-primary'} onClick={() => onClose('confirm')}>
      {options.confirmLabel}
    </button>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onCancel={(e) => {
        e.preventDefault();
        onClose('cancel');
      }}
      className="dialog-in w-[min(32rem,calc(100vw-2rem))] rounded-panel border border-rule bg-raised p-0 text-ink shadow-level-4 backdrop:bg-ink/40"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="text-xl font-bold">
          {options.title}
        </h2>
        <div id="confirm-body" className="mt-3 text-ink-soft">
          {options.body}
        </div>
        {/* Three choices stack at full width, the main one on top, in the order they are read and tabbed through:
            long labels never wrap into ragged rows. The second way is never a filled button, so the dialog has
            one loud choice. Two choices sit side by side from 640px, the safe one first. */}
        {options.altLabel ? (
          <div className="mt-6 flex flex-col gap-3">
            {confirmButton}
            <button
              type="button"
              className={options.altDanger ? 'btn-danger-quiet' : 'btn-quiet'}
              onClick={() => onClose('alt')}
            >
              {options.altLabel}
            </button>
            {cancelButton}
          </div>
        ) : (
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
            {cancelButton}
            {confirmButton}
          </div>
        )}
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
