import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/** Panel dari kanan (720px, docs/06 §5). Fokus terkunci + Esc dari Radix Dialog. */
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Pemicu drawer ada di luar komponen ini (baris tabel / titik chart), jadi Radix tidak
  // punya `DialogTrigger` untuk dituju → simpan sendiri elemen yang fokus saat dibuka.
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) restoreRef.current = document.activeElement as HTMLElement | null;
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            const target = restoreRef.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className="fixed top-0 right-0 z-50 flex h-full w-[720px] max-w-full flex-col border-l border-border bg-surface shadow-float"
        >
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
            <DialogPrimitive.Title className="font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" className="ml-auto" aria-label="Tutup panel">
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </header>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
          {footer && <footer className="shrink-0 border-t border-border p-3">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
