import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  /** What will happen, including what will be lost. */
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** The confirm button is red: something is thrown away. */
  danger?: boolean;
}

/**
 * Asks before anything is stopped or thrown away. A native modal dialog: focus moves into it and
 * stays there, and Escape cancels.
 */
function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (confirmed: boolean) => void }) {
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
        onClose(false);
      }}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border-2 border-edge bg-surface p-0 text-ink shadow-2xl backdrop:bg-canvas/80"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="text-xl font-bold">
          {options.title}
        </h2>
        <div className="mt-3 text-ink-soft">{options.body}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button ref={cancelRef} type="button" className="btn-quiet" onClick={() => onClose(false)}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className={options.danger ? 'btn bg-fail text-surface hover:opacity-90' : 'btn-primary'}
            onClick={() => onClose(true)}
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
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    []
  );
  const dialog = pending ? (
    <ConfirmDialog
      options={pending.options}
      onClose={(ok) => {
        pending.resolve(ok);
        setPending(null);
      }}
    />
  ) : null;
  return { confirm, dialog };
}
