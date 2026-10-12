import { useCallback, useEffect, useState } from "react";

export interface ToastItem {
  id: number;
  tone: "ok" | "warn" | "info";
  text: string;
}

const TONE_DOT: Record<ToastItem["tone"], string> = {
  ok: "bg-accent",
  warn: "bg-warn",
  info: "bg-flat",
};

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem["tone"], text: string) => {
    setItems((list) => [...list, { id: Date.now() + Math.random(), tone, text }]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);
  return { items, push, dismiss };
}

export function ToastStack({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((t) => setTimeout(() => onDismiss(t.id), 8000));
    return () => timers.forEach(clearTimeout);
  }, [items, onDismiss]);

  if (items.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex w-[420px] flex-col gap-2"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 shadow-float"
        >
          <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[t.tone]}`} />
          <p className="flex-1 text-base text-fg">{t.text}</p>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="rounded-sm px-1 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            Tutup
          </button>
        </div>
      ))}
    </div>
  );
}
