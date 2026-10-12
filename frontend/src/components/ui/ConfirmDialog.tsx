import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/** Pakai elemen `<dialog>` native: fokus terkunci + Esc gratis (docs/06 §9). */
export function ConfirmDialog({
  open,
  title,
  confirmLabel = "Lanjutkan",
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  confirmLabel?: string;
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      onClose={onCancel}
      className="w-[440px] max-w-[90vw] rounded-md border border-border bg-surface p-4 text-fg backdrop:bg-black/50"
    >
      <h2 className="text-md font-semibold">{title}</h2>
      <div className="mt-2 text-base text-fg-muted">{children}</div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
        <Button variant="primary" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
